import json
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import time
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connections
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from core.models import Membership, Unit
from operations.models import (
    ReportAutomation,
    ReportConnection,
    ReportDefinition,
    ReportExecution,
    ReportGrant,
    ReportRecipient,
)
from operations.report_engine import bound_sql, run_query, secret, sql_contract
from operations.reporting import execute_report, make_execution, readiness, tick_reports


def post(client, path, data, unit="ame"):
    return client.post(
        f"/api/v1/{path}/?unit={unit}",
        data,
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
    )


@pytest.fixture
def report_env(setup, tmp_path, settings):
    settings.REPORT_SQLITE_ROOT = str(tmp_path)
    settings.ORACLE_CREDENTIALS_KEY = Fernet.generate_key().decode()
    settings.ASYNC_TASKS = False
    db = tmp_path / "source.sqlite3"
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE totals (name TEXT, value INTEGER)")
    c.executemany("INSERT INTO totals VALUES (?,?)", [("A", 10), ("B", 20)])
    c.commit()
    c.close()
    conn = ReportConnection.objects.create(
        unit=setup["unit"],
        name="Fonte",
        engine="sqlite",
        database=str(db),
        enabled=True,
        validated=True,
        max_rows=100,
    )
    report = ReportDefinition.objects.create(
        unit=setup["unit"],
        code="sqltest",
        name="Totais",
        source="sql",
        connection=conn,
        reviewed=True,
        enabled=True,
        query_sql="SELECT name,value FROM totals WHERE value >= :minimo",
        parameter_schema={"minimo": {"type": "integer"}},
        output_format="csv",
    )
    recipient = ReportRecipient.objects.create(
        unit=setup["unit"],
        name="Equipe",
        address="5511999990001",
        active=True,
        verified_at=timezone.now(),
        user=setup["user"],
    )
    grant = ReportGrant.objects.create(
        unit=setup["unit"], report=report, recipient=recipient, active=True
    )
    return {
        **setup,
        "connection": conn,
        "report": report,
        "recipient": recipient,
        "grant": grant,
    }


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM totals",
        "SELECT 1; SELECT 2",
        "WITH x AS (DELETE FROM totals RETURNING *) SELECT * FROM x",
        "SELECT 1 INTO temporary_table",
        "SELECT * FROM totals FOR UPDATE",
        "SELECT load_extension('x')",
        "SELECT pg_sleep(10)",
    ],
)
def test_mutating_sql_is_rejected(sql):
    with pytest.raises(ValidationError):
        sql_contract(sql, {}, "postgres")


def test_readonly_query_parameters_and_literal_are_safe(report_env):
    e = report_env
    headers, rows = run_query(e["report"], {"minimo": "15"})
    assert headers == ["name", "value"] and rows == [["B", "20"]]
    assert sql_contract("SELECT ':unused' AS x", {}, "sqlite") == set()
    sql, values = bound_sql(
        "SELECT :name, ':literal', 1::integer",
        {"name": "'; DROP TABLE totals; --"},
        "postgres",
    )
    assert sql == "SELECT %s, ':literal', 1::integer" and values == (
        "'; DROP TABLE totals; --",
    )


def test_parameter_type_and_limit(report_env):
    e = report_env
    with pytest.raises(ValidationError):
        run_query(e["report"], {"minimo": "0 OR 1=1"})
    e["connection"].max_rows = 1
    e["connection"].save()
    with pytest.raises(ValidationError):
        run_query(e["report"], {"minimo": 0})


def test_no_files_outside_sqlite_root(report_env):
    e = report_env
    e["connection"].database = "/etc/passwd"
    e["connection"].save()
    with pytest.raises(ValidationError):
        run_query(e["report"], {"minimo": 0})


def test_generation_then_revocation_blocks_download(report_env):
    e = report_env
    job = make_execution(
        e["report"], {"minimo": 0}, user=e["user"], recipient=e["recipient"]
    )
    execute_report(job.pk)
    job.refresh_from_db()
    assert job.state == "ready" and job.row_count == 2
    assert job.delivery_state == "blocked_meta_configuration"
    e["grant"].active = False
    e["grant"].save()
    response = e["client"].get(f"/api/v1/report-executions/{job.pk}/download/?unit=ame")
    assert response.status_code == 403


def test_revoked_grant_blocks_waiting_execution(report_env):
    e = report_env
    job = make_execution(
        e["report"], {"minimo": 0}, user=e["user"], recipient=e["recipient"]
    )
    e["grant"].active = False
    e["grant"].save()
    execute_report(job.pk)
    job.refresh_from_db()
    assert job.state == "blocked" and not job.result


def test_unit_isolation_configuration_and_grants(report_env):
    e = report_env
    other = Unit.objects.create(slug="other", name="Outra")
    conn = ReportConnection.objects.create(unit=other, name="Privada", engine="oracle")
    response = post(
        e["client"],
        f"reports/{e['report'].pk}/configure",
        {"version": e["report"].version, "connection": conn.pk},
    )
    assert response.status_code == 400
    assert (
        e["client"].get(f"/api/v1/report-connections/{conn.pk}/?unit=ame").status_code
        == 404
    )


def test_connection_credentials_are_encrypted_and_never_returned(report_env):
    e = report_env
    response = post(
        e["client"],
        "report-connections",
        {
            "name": "Extra",
            "engine": "oracle",
            "host": "127.0.0.1",
            "database": "DB",
            "username": "reader",
            "password": "secret-value",
            "admin_password": "Test-Password-2026!",
        },
    )
    assert response.status_code == 200, response.data
    assert "password" not in response.data and "ciphertext" not in response.data
    conn = ReportConnection.objects.get(pk=response.data["id"])
    assert "secret-value" not in conn.ciphertext and secret(conn) == "secret-value"
    bad = post(
        e["client"],
        f"report-connections/{conn.pk}/configure",
        {"version": conn.version, "admin_password": "wrong", "host": "other"},
    )
    assert bad.status_code == 400


def test_enable_pending_report_and_stale_version(report_env):
    e = report_env
    r = e["report"]
    response = post(
        e["client"], f"reports/{r.pk}/configure", {"version": 999, "name": "Outro"}
    )
    assert response.status_code == 409
    response = post(
        e["client"],
        f"reports/{r.pk}/configure",
        {"version": r.version, "connection": None},
    )
    assert response.status_code == 400


def test_manual_requires_user_grant(report_env):
    e = report_env
    user = get_user_model().objects.create_user("operator", password="x")
    Membership.objects.create(unit=e["unit"], user=user, role="operator")
    with pytest.raises(PermissionDenied):
        make_execution(e["report"], {"minimo": 0}, user=user)
    e["recipient"].user = user
    e["recipient"].save()
    assert make_execution(e["report"], {"minimo": 0}, user=user).pk
    e["grant"].manual = False
    e["grant"].save()
    with pytest.raises(PermissionDenied):
        make_execution(e["report"], {"minimo": 0}, user=user)


def test_idempotent_api_request(report_env):
    e = report_env
    key = str(uuid.uuid4())
    body = {"report": e["report"].pk, "parameters": {"minimo": 0}}
    a = e["client"].post(
        "/api/v1/report-executions/?unit=ame",
        body,
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )
    b = e["client"].post(
        "/api/v1/report-executions/?unit=ame",
        body,
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )
    assert a.status_code == b.status_code == 200 and a.data["id"] == b.data["id"]
    assert ReportExecution.objects.count() == 1


def test_disabled_recipient_and_manual_mode(report_env):
    e = report_env
    e["recipient"].manual_enabled = False
    e["recipient"].save()
    with pytest.raises(PermissionDenied):
        make_execution(
            e["report"], {"minimo": 0}, user=e["user"], recipient=e["recipient"]
        )


@pytest.mark.django_db(transaction=True)
def test_concurrent_scheduler_once_per_day(report_env, settings):
    e = report_env
    settings.REPORT_BAILEYS_ALLOW_SENDS = True
    from operations.models import ReportWhatsAppConfiguration

    ReportWhatsAppConfiguration.objects.create(
        unit=e["unit"], sends_enabled=True, automatic_enabled=True
    )
    timezone.localtime()
    ReportAutomation.objects.create(
        unit=e["unit"],
        report=e["report"],
        recipient=e["recipient"],
        enabled=True,
        send_time=time(0, 0),
        weekdays=list(range(7)),
        parameters={"minimo": 0},
    )

    def tick():
        close_old_connections()
        try:
            tick_reports()
        finally:
            connections.close_all()

    with patch("operations.reporting.enqueue"):  # noqa: SIM117
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _: tick(), range(2)))
    assert ReportExecution.objects.count() == 1


def test_group_generation_keeps_transport_blocked(report_env):
    e = report_env
    e["recipient"].kind = "group"
    e["recipient"].address = "123456789@g.us"
    e["recipient"].save()
    job = make_execution(
        e["report"], {"minimo": 0}, user=e["user"], recipient=e["recipient"]
    )
    execute_report(job.pk)
    job.refresh_from_db()
    assert job.state == "ready" and job.delivery_state == "blocked_group_transport"


def test_composite_circular_and_missing_children(report_env):
    e = report_env
    r = e["report"]
    r.source = "composite"
    r.components = [{"code": r.code}]
    r.save()
    assert readiness(r)


def test_import_preserves_duplicates_and_orphan_permissions(setup, tmp_path):
    from django.core.management import call_command

    def query(rows):
        return {"rows": rows, "error": None}

    contact = lambda id, name: {
        "ID_ADM": id,
        "NOME_ADM": name,
        "CELULAR": "17999990000",
        "SITUACAO": "A",
        "SOMENTE_RECEBE_RELATORIO": "N",
        "ID_EMPRESA": "1",
    }
    definition = {
        "ID_RELATORIO": "1",
        "NOME_RELATORIO": "Teste",
        "DESCRICAO": "Teste",
        "ID_BASE": "3",
        "NOME_BASE": "G4",
        "PROCEDIMENTO": "PROC_EXAMPLE",
        "RETORNO_TEXTO": "N",
        "MULTIPLOS_RELATORIOS": "N",
        "NOME_PDF": "TESTE",
        "PROXIMA_ETAPA": "<NULL>",
        "ID_EMPRESA": "1",
    }
    grant = lambda id: {
        "ID_ADM": id,
        "ID_RELATORIO": "1",
        "PARAMETRO1": "",
        "ORDEM_MENU_INICIAL": "1",
    }
    a = [
        query([{"REPORTS": "1"}]),
        query([{"CONTACTS": "2"}]),
        query([{"PERMISSIONS": "3"}]),
        query([contact("1", "Pessoa A"), contact("2", "Pessoa B")]),
        query([grant("1"), grant("2"), grant("999")]),
        query([definition]),
        query([]),
        query([]),
        query([]),
    ]
    b = [
        query([{"ID_RELATORIO": "1", "COMANDO_VIEW": ""}]),
        query([{"PARAMETERS": "0"}]),
        query([]),
        query([]),
    ]
    for name, content in [
        ("all_permissions.json", a),
        ("all_definitions.json", b),
        ("all_parameters_page2.json", query([])),
    ]:
        (tmp_path / name).write_text(json.dumps(content), encoding="utf-8")
    call_command(
        "import_legacy_reports", directory=str(tmp_path), unit="ame", verbosity=0
    )
    call_command(
        "import_legacy_reports", directory=str(tmp_path), unit="ame", verbosity=0
    )
    assert ReportRecipient.objects.count() == 2
    assert ReportGrant.objects.count() == 2
    assert ReportDefinition.objects.count() == 1
    assert not ReportDefinition.objects.filter(enabled=True).exists()
    assert not ReportAutomation.objects.filter(enabled=True).exists()


def test_readonly_sqlite_transaction_prevents_mutation(report_env):
    from operations.report_engine import connect

    with connect(report_env["connection"]) as c:  # noqa: SIM117
        with pytest.raises(sqlite3.OperationalError):
            c.execute("INSERT INTO totals VALUES ('C',30)")


def test_readonly_role_cannot_edit_and_operator_cannot_list_connections(report_env):
    e = report_env
    operator = get_user_model().objects.create_user("reader", password="x")
    Membership.objects.create(
        unit=e["unit"], user=operator, role="operator", permissions={"reports": "read"}
    )
    e["client"].force_authenticate(operator)
    assert post(e["client"], "reports", {"code": "x", "name": "x"}).status_code == 403
    assert e["client"].get("/api/v1/report-connections/?unit=ame").status_code == 403


def test_recipient_users_endpoint_scoped(report_env):
    e = report_env
    response = e["client"].get("/api/v1/report-recipients/users/?unit=ame")
    assert response.status_code == 200 and response.data[0]["username"] == "admin"


def test_unreviewed_long_legacy_query_does_not_break_catalog(report_env):
    e = report_env
    r = e["report"]
    r.reviewed = False
    r.enabled = False
    r.query_sql = " UNION ALL ".join(["SELECT 1 AS total"] * 900)
    r.save()
    response = e["client"].get("/api/v1/reports/?unit=ame")
    assert response.status_code == 200
    assert response.data["results"][0]["pending_items"]


def test_bind_preserves_literal_percent_for_dbapi():
    sql, values = bound_sql(
        "SELECT DATE_FORMAT(data, '%Y') WHERE name = :name", {"name": "A"}, "mysql"
    )
    assert sql == "SELECT DATE_FORMAT(data, '%%Y') WHERE name = %s" and values == ("A",)


def test_per_recipient_scope_cannot_be_overridden(report_env):
    e = report_env
    operator = get_user_model().objects.create_user("scoped", password="x")
    Membership.objects.create(unit=e["unit"], user=operator, role="operator")
    e["recipient"].user = operator
    e["recipient"].save()
    e["grant"].parameters = {"minimo": 15}
    e["grant"].save()
    job = make_execution(e["report"], {"minimo": 0}, user=operator)
    assert job.recipient_id == e["recipient"].pk and job.parameters == {"minimo": 15}
    execute_report(job.pk)
    job.refresh_from_db()
    assert job.state == "ready" and job.row_count == 1


def test_legacy_restriction_requires_mapping(report_env):
    e = report_env
    e["grant"].legacy = {"record": {"PARAMETRO1": "SUS"}}
    e["grant"].save()
    with pytest.raises(PermissionDenied):
        make_execution(
            e["report"], {"minimo": 0}, user=e["user"], recipient=e["recipient"]
        )


def test_legacy_source_description_preserves_target_and_custom_name(report_env):
    from operations.legacy_sources import describe_sources

    e = report_env
    report = ReportDefinition.objects.create(
        unit=e["unit"],
        code="legacy123-99",
        name="Histórico",
        source="application_pending",
        legacy={"record": {"ID_BASE": "9", "PROCEDIMENTO": "PROC_GESTAO_MENSAGENS"}},
    )
    descriptions = [
        {
            "legacy_id": "9",
            "display_name": "Legado 9 · Firebird NAS/UBS",
            "source_description": "Firebird remoto NAS",
            "source_config": {
                "engine": "FIREBIRD",
                "host": "10.2.74.70",
                "port": "3050",
                "database": "C:/base.fdb",
            },
            "data_access_method": "Conexão Firebird remota pela aplicação",
            "dblink_status": "Não identificado",
            "procedures": ["PROC_GESTAO_MENSAGENS"],
            "report_count": 63,
        }
    ]
    describe_sources(e["unit"], descriptions)
    conn = ReportConnection.objects.get(unit=e["unit"], legacy__id="9")
    assert conn.engine == "oracle" and not conn.enabled and not conn.host
    assert conn.legacy["source_config"]["engine"] == "FIREBIRD"
    report.refresh_from_db()
    assert (
        "PROC_GESTAO_MENSAGENS" in report.legacy["source_path"]
        and "10.2.74.70" in report.legacy["source_path"]
    )
    conn.name = "Nome revisado pelo administrador"
    conn.save()
    describe_sources(e["unit"], descriptions)
    conn.refresh_from_db()
    assert conn.name == "Nome revisado pelo administrador"


def test_catalog_filters_sections_and_restore_preserve_relations(report_env):
    e = report_env
    report = e["report"]
    routine = ReportDefinition.objects.create(
        unit=e["unit"],
        code="routine",
        name="Limpar",
        source="legacy_pending",
        review_queue=True,
    )
    other = Unit.objects.create(slug="other-review", name="Outra")
    ReportDefinition.objects.create(
        unit=other, code="hidden", name="Outra rotina", review_queue=True
    )
    client = e["client"]
    response = client.get(
        "/api/v1/reports/?unit=ame&section=reports&source=sql&status=enabled&sql=yes&connection="
        + str(e["connection"].pk)
    )
    assert response.status_code == 200
    assert [x["id"] for x in response.data["results"]] == [report.pk]
    response = client.get(
        "/api/v1/reports/?unit=ame&section=review&status=disabled&sql=no"
    )
    assert [x["id"] for x in response.data["results"]] == [routine.pk]
    assert client.get("/api/v1/reports/inventory/?unit=ame").data["review_count"] == 1
    response = post(
        client,
        f"reports/{report.pk}/configure",
        {"version": report.version, "review_queue": True, "enabled": False},
    )
    assert response.status_code == 200
    assert ReportGrant.objects.get(pk=e["grant"].pk).report_id == report.pk
    report.refresh_from_db()
    assert "Rotina legada pendente de validação" in readiness(report)
    response = post(
        client,
        f"reports/{report.pk}/configure",
        {"version": report.version, "review_queue": False},
    )
    assert response.status_code == 200
    report.refresh_from_db()
    assert not report.review_queue and not report.enabled


def test_review_migration_moves_only_housekeeping_names(report_env):
    import importlib

    from django.apps import apps

    unit = report_env["unit"]
    names = [
        "00 - SINCRINIZAR COMPLETO PARTE 1",
        "00 - SINCRINIZAR COMPLETO PARTE 2",
        "52 - LIMPAR_CONSULTAS_MEDICAS_AME_VOTU",
        "Consultas médicas",
        "Busca ativa respostas",
    ]
    records = [
        ReportDefinition.objects.create(
            unit=unit, code=f"legacy123-test-{i}", name=name
        )
        for i, name in enumerate(names)
    ]
    importlib.import_module(
        "operations.migrations.0019_report_review_queue"
    ).move_routines(apps, None)
    for i, record in enumerate(records):
        record.refresh_from_db()
        assert record.review_queue == (i < 3)


def test_parameter_audit_preserves_dates_masks_fragments_and_unmatched_bindings(
    report_env,
):
    from operations.report_parameters import parameter_audit

    report = report_env["report"]
    report.query_sql = "SELECT :inicio, :nao_cadastrado, ':ignorar' -- :comentario\n"
    report.parameter_schema = {
        "inicio": {"type": "date", "required": False, "default": "2026-10-01"}
    }
    report.legacy = {
        "original_sql": "SELECT WPA_DATA_FINAL FROM DUAL",
        "parameters": [
            {
                "NOME": "DATA FINAL",
                "TIPO": "DATA FINAL",
                "ORDEM": "2",
                "MASCARA": "MM/DD/YYYY HH:MM:SS",
                "CONTEUDO": "",
            },
            {
                "NOME": "CRITERIO",
                "TIPO": "CARACTER",
                "ORDEM": "1",
                "MASCARA": "",
                "CONTEUDO": "AND A.TIPO = 'X'",
            },
        ],
    }
    result = parameter_audit(report)["items"]
    by_name = {r["name"]: r for r in result}
    assert by_name["DATA FINAL"]["type"] == "Data e hora"
    assert by_name["DATA FINAL"]["status"] == "pending"
    assert by_name["CRITERIO"]["type"] == "Trecho de SQL"
    assert (
        by_name["inicio"]["status"] == "confirmed"
        and by_name["inicio"]["required"] is False
    )
    assert by_name["WPA_DATA_FINAL"]["configured"] is False
    assert (
        "nao_cadastrado" in by_name
        and "ignorar" not in by_name
        and "comentario" not in by_name
    )
    assert report.parameter_schema == {
        "inicio": {"type": "date", "required": False, "default": "2026-10-01"}
    }


def test_parameter_audit_components_are_unit_scoped_and_metadata_admin_only(report_env):
    from operations.report_parameters import parameter_audit

    e = report_env
    parent = ReportDefinition.objects.create(
        unit=e["unit"],
        code="parent-parameters",
        name="Composto",
        source="composite",
        components=[
            {"code": e["report"].code},
            {"code": "parent-parameters"},
            {"code": "missing"},
        ],
    )
    audit = parameter_audit(parent)
    assert len(audit["items"]) == 1
    assert audit["items"][0]["name"] == "minimo"
    assert audit["items"][0]["origin"].startswith("Componente")
    assert len(audit["component_issues"]) == 2
    response = e["client"].get(f"/api/v1/reports/{parent.pk}/?unit=ame")
    assert response.status_code == 200 and response.data["parameter_audit"]["items"]
    listing = e["client"].get("/api/v1/reports/?unit=ame")
    assert all(r["parameter_audit"] is None for r in listing.data["results"])
    operator = get_user_model().objects.create_user(
        "audit-operator", password="test-only"
    )
    Membership.objects.create(unit=e["unit"], user=operator, role="operator")
    e["recipient"].user = operator
    e["recipient"].save()
    e["client"].force_authenticate(operator)
    response = e["client"].get(f"/api/v1/reports/{e['report'].pk}/?unit=ame")
    assert response.status_code == 200 and "parameter_audit" not in response.data


def test_grant_filters_combine_search_scope_and_permission_flags(report_env):
    e = report_env
    report = e["report"]
    group = ReportRecipient.objects.create(
        unit=e["unit"], name="Diretoria", address="123456@g.us", kind="group"
    )
    g = ReportGrant.objects.create(
        unit=e["unit"],
        report=report,
        recipient=group,
        manual=False,
        automatic=True,
        active=False,
    )
    other = Unit.objects.create(slug="grant-other", name="Outra")
    rr = ReportDefinition.objects.create(unit=other, code="hidden", name="Totais")
    rc = ReportRecipient.objects.create(
        unit=other, name="Diretoria", address="999999@g.us", kind="group"
    )
    ReportGrant.objects.create(
        unit=other, report=rr, recipient=rc, active=False, manual=False, automatic=True
    )
    base = "/api/v1/report-grants/?unit=ame"
    result = e["client"].get(
        base
        + f"&search=Diretoria&status=inactive&permission=automatic&recipient_kind=group&report={report.pk}&recipient={group.pk}"
    )
    assert result.status_code == 200 and result.data["count"] == 1
    assert result.data["results"][0]["id"] == g.pk
    assert (
        e["client"]
        .get(base + "&permission=both&status=active&recipient_kind=phone")
        .data["count"]
        == 1
    )
    assert e["client"].get(base + "&search=999999").data["count"] == 0
    assert e["client"].get(base + "&report=invalid").status_code == 400
    assert e["client"].get(base + "&permission=neither").data["count"] == 0


def test_automation_filters_weekday_time_search_scope_and_invalid_ranges(report_env):
    e = report_env
    job = ReportAutomation.objects.create(
        unit=e["unit"],
        report=e["report"],
        recipient=e["recipient"],
        weekdays=[0, 4],
        send_time=time(9, 30),
        enabled=False,
    )
    ReportAutomation.objects.create(
        unit=e["unit"],
        report=e["report"],
        recipient=e["recipient"],
        weekdays=[6],
        send_time=time(18),
        enabled=False,
    )
    other = Unit.objects.create(slug="automation-other", name="Outra")
    rr = ReportDefinition.objects.create(unit=other, code="hidden", name="Totais")
    rc = ReportRecipient.objects.create(
        unit=other, name="Equipe", address="5511999991234"
    )
    ReportAutomation.objects.create(
        unit=other, report=rr, recipient=rc, weekdays=[0], send_time=time(9, 30)
    )
    base = "/api/v1/report-automations/?unit=ame"
    result = e["client"].get(
        base
        + f"&search=Totais&report={e['report'].pk}&recipient={e['recipient'].pk}&status=inactive&weekday=0&time_from=09:30&time_to=09:30&recipient_kind=phone"
    )
    assert (
        result.status_code == 200
        and result.data["count"] == 1
        and result.data["results"][0]["id"] == job.pk
    )
    assert e["client"].get(base + "&weekday=6").data["count"] == 1
    assert e["client"].get(base + "&recipient_kind=group").data["count"] == 0
    for suffix in [
        "&weekday=7",
        "&weekday=abc",
        "&time_from=25:00",
        "&time_from=abc",
        "&time_from=18:00&time_to=09:00",
    ]:
        assert e["client"].get(base + suffix).status_code == 400


def test_create_report_recipient_without_linked_user(report_env):
    e = report_env
    response = post(
        e["client"],
        "report-recipients",
        {
            "name": "Novo contato fictício",
            "address": "11999990002",
            "kind": "phone",
            "user": None,
            "active": False,
            "manual_enabled": True,
        },
    )
    assert response.status_code == 200, response.data
    assert response.data["address"] == "5511999990002"
    assert response.data["verified_at"] is None
    assert not response.data["active"]


def test_recipient_activation_requires_verification(report_env):
    e = report_env
    data = {
        "name": "Contato fictício",
        "address": "11999990003",
        "kind": "phone",
        "user": None,
        "active": True,
        "manual_enabled": True,
    }
    response = post(e["client"], "report-recipients", data)
    assert response.status_code == 400
    assert not ReportRecipient.objects.filter(address="5511999990003").exists()
    data["active"] = False
    response = post(e["client"], "report-recipients", data)
    assert response.status_code == 200, response.data
    pk = response.data["id"]
    response = post(
        e["client"],
        f"report-recipients/{pk}/verify",
        {"version": 1, "evidence": "Contato conferido pelo administrador"},
    )
    assert response.status_code == 200, response.data
    response = post(
        e["client"],
        f"report-recipients/{pk}/configure",
        {"version": response.data["version"], "active": True},
    )
    assert response.status_code == 200, response.data
    assert response.data["active"]


def test_shorthand_report_parameters_support_detail_and_edit(report_env):
    e = report_env
    report = e["report"]
    report.parameter_schema = {"start": "date", "end": "date"}
    report.query_sql = "SELECT :start, :end"
    report.save()
    response = e["client"].get(f"/api/v1/reports/{report.pk}/?unit=ame")
    assert response.status_code == 200, response.data
    assert response.data["parameter_schema"] == {
        "start": {"type": "date"},
        "end": {"type": "date"},
    }
    assert {p["type"] for p in response.data["parameter_audit"]["items"]} == {"Data"}
    report.refresh_from_db()
    assert report.parameter_schema == {"start": "date", "end": "date"}
    response = post(
        e["client"],
        f"reports/{report.pk}/configure",
        {
            "version": report.version,
            "name": "Renomeado",
            "parameter_schema": report.parameter_schema,
        },
    )
    assert response.status_code == 200, response.data
    assert response.data["name"] == "Renomeado"


def test_create_new_report_returns_json_with_parameters(report_env):
    e = report_env
    response = post(
        e["client"],
        "reports",
        {
            "name": "Novo relatório fictício",
            "code": "new-json-report",
            "source": "sql",
            "connection": e["report"].connection_id,
            "query_sql": "SELECT :start",
            "output_format": "pdf",
            "enabled": False,
            "reviewed": False,
            "manual_enabled": True,
            "parameter_schema": {"start": {"type": "date", "prompt": "Informe a data"}},
            "components": [],
            "keywords": [],
            "keyword": "",
            "request_message": "Informe os parâmetros",
        },
    )
    assert response.status_code == 200, response.data
    assert response.data["parameter_audit"]["items"][0]["type"] == "Data"
    assert (
        e["client"].get(f"/api/v1/reports/{response.data['id']}/?unit=ame").status_code
        == 200
    )


def test_components_are_separate_and_keep_readonly_preview(report_env):
    e=report_env;report=e["report"]
    report.catalog_kind="component";report.save()
    listing=e["client"].get("/api/v1/reports/?unit=ame")
    assert listing.status_code==200 and listing.data["count"]==0
    listing=e["client"].get("/api/v1/reports/?unit=ame&section=components")
    assert listing.status_code==200 and listing.data["count"]==1
    assert listing.data["results"][0]["catalog_kind"]=="component"
    preview=post(e["client"],f"reports/{report.pk}/preview",{"parameters":{"minimo":0}})
    assert preview.status_code==200 and preview.data["total"]==2
    with pytest.raises(ValidationError):make_execution(report,{"minimo":0},user=e["user"])
    with pytest.raises(PermissionDenied):
        from operations.reporting import grant_for
        grant_for(report,e["recipient"],"manual")


def test_parent_can_generate_with_internal_components(report_env):
    e=report_env;child=e["report"]
    child.catalog_kind="component";child.manual_enabled=False;child.save()
    parent=ReportDefinition.objects.create(unit=e["unit"],code="final-report",name="Documento final",source="composite",components=[{"code":child.code,"parameters":{"minimo":0}}],enabled=True,reviewed=True,output_format="pdf")
    job=make_execution(parent,{},user=e["user"])
    execute_report(job.pk);job.refresh_from_db()
    assert job.state=="ready" and job.row_count==2
    result=e["client"].get(f"/api/v1/reports/?unit=ame&section=components")
    assert result.data["results"][0]["used_by"]==[{"id":parent.pk,"name":parent.name,"code":parent.code,"legacy":False}]


def test_component_is_hidden_from_operators_even_with_legacy_grant(report_env):
    e=report_env;report=e["report"]
    report.catalog_kind="component";report.save()
    operator=get_user_model().objects.create_user("component-operator",password="test-only")
    Membership.objects.create(unit=e["unit"],user=operator,role="operator")
    e["recipient"].user=operator;e["recipient"].save()
    e["client"].force_authenticate(operator)
    assert e["client"].get("/api/v1/reports/?unit=ame&section=all").data["count"]==0
    assert e["client"].get("/api/v1/reports/?unit=ame&section=components").status_code==403
    assert e["client"].get(f"/api/v1/reports/{report.pk}/?unit=ame").status_code==404


def test_moving_to_components_preserves_enabled_state_and_queries(report_env):
    e=report_env;report=e["report"]
    scheduled=ReportAutomation.objects.create(unit=e["unit"],report=report,recipient=e["recipient"],send_time=time(9),weekdays=[0],enabled=True)
    response=post(e["client"],f"reports/{report.pk}/configure",{"version":report.version,"catalog_kind":"component"})
    assert response.status_code==200,response.data
    report.refresh_from_db()
    assert report.enabled and report.query_sql and report.catalog_kind=="component"
    response=e["client"].get("/api/v1/reports/inventory/?unit=ame")
    assert response.data["reports"]==0 and response.data["components"]==1
    scheduled.refresh_from_db();assert not scheduled.enabled
    response=post(e["client"],f"reports/{report.pk}/configure",{"version":report.version,"catalog_kind":"report"})
    assert response.status_code==200
    scheduled.refresh_from_db();assert not scheduled.enabled



def test_component_grant_and_schedule_cannot_be_created(report_env):
    e=report_env;r=e["report"];r.catalog_kind="component";r.save()
    response=post(e["client"],"report-automations",{"report":r.pk,"recipient":e["recipient"].pk,"send_time":"09:00","weekdays":[0],"parameters":{"minimo":0},"enabled":False})
    assert response.status_code==400
    e["grant"].delete()
    response=post(e["client"],"report-grants",{"report":r.pk,"recipient":e["recipient"].pk,"manual":True,"automatic":False,"active":True,"parameters":{}})
    assert response.status_code==400


def test_catalog_migration_distinguishes_sync_from_final_report(report_env):
    import importlib
    from django.apps import apps
    e=report_env
    child=ReportDefinition.objects.create(unit=e["unit"],code="sync-test",name="Synchronizer",source="sql",legacy={"record":{"RETORNO_TEXTO":"S"}})
    ReportGrant.objects.create(unit=e["unit"],report=child,recipient=e["recipient"],manual=True,automatic=True)
    final=ReportDefinition.objects.create(unit=e["unit"],code="final-test",name="PDF",source="composite",legacy={"record":{"RETORNO_TEXTO":"N"}},components=[{"code":child.code}])
    ReportGrant.objects.create(unit=e["unit"],report=final,recipient=e["recipient"],manual=True,automatic=False)
    orphan=ReportDefinition.objects.create(unit=e["unit"],code="old-part",name="Old chart",source="sql",legacy={"record":{"RETORNO_TEXTO":"N"}})
    migration=importlib.import_module("operations.migrations.0021_report_catalog_kind")
    migration.classify_catalog(apps,None)
    child.refresh_from_db();final.refresh_from_db();orphan.refresh_from_db()
    assert child.catalog_kind==orphan.catalog_kind=="component" and final.catalog_kind=="report"


def test_receiving_permission_defines_report_without_enabling_execution(report_env):
    import importlib
    from django.apps import apps
    e=report_env
    technical=ReportDefinition.objects.create(unit=e["unit"],code="permitted-legacy",name="Legacy routine",source="legacy_pending",review_queue=True,catalog_kind="component",enabled=False,reviewed=False)
    ReportGrant.objects.create(unit=e["unit"],report=technical,recipient=e["recipient"],manual=True,automatic=True,active=False)
    helper=ReportDefinition.objects.create(unit=e["unit"],code="no-permission-helper",name="Chart helper",catalog_kind="component")
    migration=importlib.import_module("operations.migrations.0022_report_receiving_permissions")
    migration.promote_receivable_reports(apps,None)
    technical.refresh_from_db();helper.refresh_from_db()
    assert technical.catalog_kind=="report" and helper.catalog_kind=="component"
    assert not technical.enabled and not technical.reviewed and technical.review_queue
    listing=e["client"].get("/api/v1/reports/?unit=ame&section=reports&search=permitted-legacy")
    assert listing.status_code==200 and listing.data["count"]==1
    with pytest.raises(PermissionDenied):make_execution(technical,{},user=e["user"])


def test_report_filename_preserves_actual_name_and_blocks_paths_and_controls():
    from operations.report_engine import report_filename
    assert report_filename("Indicadores Médicos","pdf")=="Indicadores Médicos.pdf"
    assert report_filename("Indicadores Médicos.pdf","pdf")=="Indicadores Médicos.pdf"
    assert report_filename(' ../Teste/"x"\r\n',"csv")=="Teste x.csv"
    assert report_filename("Resumo","text")=="Resumo.txt"


def test_automation_readiness_reused_only_inside_one_response():
    from types import SimpleNamespace
    from operations.report_api import AutomationSerializer
    report=SimpleNamespace(unit_id=1,version=1)
    item=SimpleNamespace(report=report,report_id=5,legacy={},recipient=SimpleNamespace(active=True,verified_at=True,kind="phone"))
    serializer=AutomationSerializer(context={})
    with patch("operations.report_api.readiness",return_value=["first"] ) as ready,patch("operations.report_api.grant_for"):
        first=serializer.get_pending_items(item)
        first.append("local mutation")
        assert "local mutation" not in serializer.get_pending_items(item)
        assert ready.call_count==1
        ready.return_value=["changed"]
        assert "changed" in AutomationSerializer(context={}).get_pending_items(item)
        assert ready.call_count==2


def test_sql_parser_cache_never_reuses_parameter_contract_or_mutable_results():
    from operations.report_engine import _sql_structure
    _sql_structure.cache_clear()
    sql="SELECT :day FROM DUAL"
    schema={"day":{"type":"date"}}
    result=sql_contract(sql,schema,"oracle")
    result.add("caller_mutation")
    assert sql_contract(sql,schema,"oracle")=={"day"}
    assert _sql_structure.cache_info().hits==1
    with pytest.raises(ValidationError):sql_contract(sql,{},"oracle")
    with pytest.raises(ValidationError):sql_contract(sql,{"day":{"type":"unsafe"}},"oracle")
    with pytest.raises(ValidationError):sql_contract("DELETE FROM DUAL",schema,"oracle")
    with pytest.raises(ValidationError):sql_contract([],schema,"oracle")
    assert sql_contract("SELECT 1 FROM DUAL",{},"oracle")==set()
