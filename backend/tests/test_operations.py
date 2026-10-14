import base64
from datetime import timedelta
from uuid import uuid4

import pytest
from core.models import Membership, Unit
from django.contrib.auth import get_user_model
from django.utils import timezone
from messaging.models import Message
from operations.catalog import seed_catalog
from operations.models import Case, ImportLayout, ReportAccess, ReportDefinition, ReportRequest, SourceEvent
from operations.reports import generate
from operations.services import apply_outcome, contextual_classify
from responses.services import apply_reply, store_event


def post(setup, path, body, key=None):
    return setup["client"].post(
        f"/api/v1/{path}/?unit=ame", body, format="json", HTTP_IDEMPOTENCY_KEY=key or str(uuid4())
    )


def case_for(setup):
    return Case.objects.get(event__appointment=setup["appointment"])


@pytest.mark.django_db
def test_case_created_and_message_linked(setup):
    case = case_for(setup)
    assert setup["message"].case_id == case.pk
    assert case.event.synthetic
    assert case.interactions.count() == 1


@pytest.mark.django_db
def test_append_only_notes_idempotency_and_conflict(setup):
    case = case_for(setup)
    key = str(uuid4())
    body = {
        "version": case.version,
        "action": "note",
        "text": "Tentativa de contato registrada.",
        "call_result": "not_answered",
    }
    first = post(setup, f"cases/{case.pk}/act", body, key)
    assert first.status_code == 200, first.data
    assert post(setup, f"cases/{case.pk}/act", body, key).data == first.data
    assert case.interactions.filter(kind="note").count() == 1
    assert case.interactions.get(kind="note").outcome == ""
    assert post(setup, f"cases/{case.pk}/act", body).status_code == 409
    assert post(setup, f"cases/{case.pk}/act", {**body, "text": "Outro conteúdo"}, key).status_code == 409


@pytest.mark.django_db
def test_missing_idempotency_and_viewer_rejected(setup):
    case = case_for(setup)
    path = f"/api/v1/cases/{case.pk}/act/?unit=ame"
    body = {"version": case.version, "action": "note", "text": "Observação"}
    assert setup["client"].post(path, body, format="json").status_code == 400
    Membership.objects.filter(user=setup["user"]).update(role="viewer")
    assert post(setup, f"cases/{case.pk}/act", body).status_code == 403


@pytest.mark.django_db
def test_cross_unit_invisible_and_assignment_rejected(setup):
    other = Unit.objects.create(slug="other", name="Outra unidade")
    event = SourceEvent.objects.create(
        unit=other, source="test", external_id="2", kind="waitlist", occurred_at=timezone.now()
    )
    foreign = Case.objects.create(unit=other, event=event, purpose="waitlist")
    assert setup["client"].get(f"/api/v1/cases/{foreign.pk}/?unit=ame").status_code == 404
    user = get_user_model().objects.create_user("other-operator")
    Membership.objects.create(unit=other, user=user, role="operator")
    case = case_for(setup)
    assert (
        post(
            setup,
            f"cases/{case.pk}/act",
            {
                "version": case.version,
                "action": "assign",
                "assignee": user.pk,
                "text": "Transferência de caso",
            },
        ).status_code
        == 400
    )
    case.refresh_from_db()
    assert case.version == 1


@pytest.mark.django_db
def test_phone_call_requires_interlocutor(setup):
    case = case_for(setup)
    body = {
        "version": case.version,
        "action": "call",
        "call_result": "answered",
        "text": "Atendimento realizado",
    }
    assert post(setup, f"cases/{case.pk}/act", body).status_code == 400
    assert (
        post(setup, f"cases/{case.pk}/act", {**body, "interlocutor": "Responsável fictício"}).status_code
        == 200
    )


@pytest.mark.parametrize(
    "purpose,positive,negative",
    [
        ("appointment", "confirmed", "declined"),
        ("waitlist", "stay_waitlist", "leave_waitlist"),
        ("postoperative", "well", "needs_attention"),
    ],
)
def test_contextual_semantics(purpose, positive, negative):
    assert contextual_classify("SIM", purpose) == positive
    assert contextual_classify("NÃO", purpose) == negative
    assert contextual_classify("3", purpose) == "wrong_person"
    assert contextual_classify("parar", purpose) == "opt_out"
    assert contextual_classify("SIM", purpose, content_type="audio") == "review"


@pytest.mark.django_db
def test_late_postoperative_reply_and_priority(setup):
    message = setup["message"]
    case = case_for(setup)
    case.purpose = "postoperative"
    case.save()
    message.purpose, message.state, message.provider_id = "postoperative", "delivered", "test.postop"
    message.save()
    setup["appointment"].scheduled_at = timezone.now() - timedelta(days=7)
    setup["appointment"].save()
    event = store_event(
        "simulated",
        "reply-postop",
        "reply",
        int(timezone.now().timestamp()),
        {"sender": message.recipient, "text": "Não", "context_id": message.provider_id},
    )
    apply_reply(event, setup["unit"])
    case.refresh_from_db()
    assert case.outcome == "needs_attention"
    assert case.priority == "high"
    assert message.issues.filter(category="postoperative_attention").exists()


@pytest.mark.django_db
def test_manual_correction_preserves_history_and_late_event(setup):
    case = case_for(setup)
    apply_outcome(case, "confirmed", setup["user"], "Confirmado por telefone")
    apply_outcome(case, "declined", channel="whatsapp", occurred_at=timezone.now() - timedelta(days=1))
    case.refresh_from_db()
    assert case.outcome == "confirmed"
    assert case.interactions.filter(kind="classification").count() == 2


@pytest.mark.django_db
def test_preparation_versions(setup):
    body = {"procedure_code": "E1", "name": "Exame fictício", "text": "Preparo original"}
    assert post(setup, "preparations", body).status_code == 200
    result = post(setup, "preparations", {**body, "text": "Preparo revisado"})
    assert result.status_code == 200, result.data
    assert result.data["version"] == 2


@pytest.mark.django_db
def test_sheet_preview_confirmation_and_reimport(setup):
    layout = ImportLayout.objects.create(
        unit=setup["unit"],
        name="Teste",
        verified=True,
        evidence="Amostra fictícia",
        mapping={"external_id": "id", "patient": "nome", "phone": "fone", "occurred_at": "data"},
    )
    content = "id;nome;fone;data\n1;Paciente fictício;11999990001;2026-10-15\n1;Paciente fictício;11999990001;2026-10-15\n".encode()
    body = {"layout": layout.pk, "filename": "test.csv", "content_base64": base64.b64encode(content).decode()}
    result = post(setup, "sheet-imports", body)
    assert result.status_code == 200, result.data
    assert result.data["duplicates"] == 1
    batch = result.data["id"]
    assert post(setup, f"sheet-imports/{batch}/confirm", {"purpose": "waitlist"}).status_code == 200
    assert post(setup, "sheet-imports", body).data["id"] == batch
    assert Case.objects.filter(purpose="waitlist").count() == 1
    assert not Message.objects.filter(purpose="waitlist").exists()


@pytest.mark.django_db
def test_sheet_conflicting_contacts_blocks_confirmation(setup):
    layout = ImportLayout.objects.create(
        unit=setup["unit"],
        name="Teste",
        verified=True,
        evidence="Teste",
        mapping={"external_id": "id", "patient": "nome", "phone": "fone", "occurred_at": "data"},
    )
    content = (
        "id;nome;fone;data\n1;Fictício;11999990001;2026-10-15\n1;Fictício;11999990002;2026-10-15\n".encode()
    )
    result = post(
        setup,
        "sheet-imports",
        {"layout": layout.pk, "filename": "test.csv", "content_base64": base64.b64encode(content).decode()},
    )
    assert result.data["errors"]
    assert (
        post(setup, f"sheet-imports/{result.data['id']}/confirm", {"purpose": "waitlist"}).status_code == 400
    )


@pytest.mark.django_db
def test_movement_not_executed_until_confirmed(setup):
    case = case_for(setup)
    created = post(
        setup,
        "movements",
        {
            "case": str(case.pk),
            "case_version": case.version,
            "kind": "cancel",
            "requested": {"reason": "Teste"},
        },
    )
    assert created.status_code == 200, created.data
    setup["appointment"].refresh_from_db()
    assert setup["appointment"].status == "scheduled"
    confirmed = post(
        setup,
        f"movements/{created.data['id']}/confirm",
        {"version": 1, "evidence": "Cancelamento confirmado pela equipe", "final": {}},
    )
    assert confirmed.status_code == 200, confirmed.data
    setup["appointment"].refresh_from_db()
    assert setup["appointment"].status == "cancelled"
    setup["message"].refresh_from_db()
    assert setup["message"].state == "cancelled"


@pytest.mark.django_db
@pytest.mark.parametrize("format", ["csv", "pdf", "text"])
def test_report_formats_and_scoped_download(setup, format):
    seed_catalog(setup["unit"])
    report = ReportDefinition.objects.get(unit=setup["unit"], code="contacts")
    result = post(setup, "report-requests", {"report": report.pk, "format": format})
    assert result.status_code == 200, result.data
    assert result.data["state"] == "ready", result.data
    download = setup["client"].get(f"/api/v1/report-requests/{result.data['id']}/download/?unit=ame")
    assert download.status_code == 200
    if format == "pdf":
        assert download.content.startswith(b"%PDF")
    else:
        assert b"PACIENTE" in download.content


@pytest.mark.django_db
def test_report_revoked_before_generation_and_download(setup):
    seed_catalog(setup["unit"])
    report = ReportDefinition.objects.get(unit=setup["unit"], code="contacts")
    access = ReportAccess.objects.create(
        unit=setup["unit"], user=setup["user"], phone="5511999990001", verified_at=timezone.now()
    )
    access.reports.add(report)
    job = ReportRequest.objects.create(
        unit=setup["unit"], report=report, requester=setup["user"], access=access, definition_version=1
    )
    access.active = False
    access.save()
    generate(job.pk)
    job.refresh_from_db()
    assert job.state == "blocked"
    assert not job.result


@pytest.mark.django_db
def test_cross_unit_campaign_and_external_report_rejected(setup):
    other = Unit.objects.create(slug="other", name="Outra")
    foreign = ReportDefinition.objects.create(unit=other, code="private", name="Privado", keyword="X")
    assert post(setup, "report-requests", {"report": foreign.pk}).status_code == 404
    result = post(
        setup,
        "reports",
        {
            "code": "sql",
            "name": "Não homologado",
            "keyword": "SQL",
            "source": "oracle",
            "handler": "arbitrary",
            "enabled": True,
        },
    )
    assert result.status_code == 400


@pytest.mark.django_db
def test_opt_out_suppresses_future_sends(setup):
    from messaging.services import send_guard

    case = case_for(setup)
    apply_outcome(case, "opt_out", setup["user"], "Paciente solicitou não receber mensagens.")
    setup["message"].refresh_from_db()
    assert setup["message"].state == "cancelled"
    assert send_guard(setup["message"]) in {"contact_opted_out", "case_not_eligible"}


@pytest.mark.django_db
def test_report_whatsapp_command_authorization_and_dedup(setup):
    seed_catalog(setup["unit"])
    report = ReportDefinition.objects.get(unit=setup["unit"], code="contacts")
    access = ReportAccess.objects.create(
        unit=setup["unit"], user=setup["user"], phone=setup["message"].recipient, verified_at=timezone.now()
    )
    access.reports.add(report)
    event = store_event(
        "simulated",
        "report-command",
        "reply",
        int(timezone.now().timestamp()),
        {"sender": access.phone, "text": "RELATORIO CONTACTS"},
    )
    apply_reply(event, setup["unit"])
    apply_reply(event, setup["unit"])
    assert ReportRequest.objects.filter(inbound_event=event).count() == 1
    assert ReportRequest.objects.get(inbound_event=event).state == "ready"
    unauthorized = store_event(
        "simulated",
        "report-unauthorized",
        "reply",
        int(timezone.now().timestamp()),
        {"sender": "5511999999999", "text": "RELATORIO CONTACTS"},
    )
    apply_reply(unauthorized, setup["unit"])
    assert not ReportRequest.objects.filter(inbound_event=unauthorized).exists()


@pytest.mark.django_db
def test_report_download_rechecks_revocation(setup):
    seed_catalog(setup["unit"])
    report = ReportDefinition.objects.get(unit=setup["unit"], code="contacts")
    access = ReportAccess.objects.create(
        unit=setup["unit"], user=setup["user"], phone="5511999990001", verified_at=timezone.now()
    )
    access.reports.add(report)
    job = ReportRequest.objects.create(
        unit=setup["unit"], report=report, requester=setup["user"], access=access, definition_version=1
    )
    generate(job.pk)
    access.active = False
    access.save()
    result = setup["client"].get(f"/api/v1/report-requests/{job.pk}/download/?unit=ame")
    assert result.status_code == 403


@pytest.mark.django_db
def test_multiple_messages_one_case_fallback_and_unknown_context(setup):
    message = setup["message"]
    message.state, message.provider_id, message.response_state = "delivered", "first-message", "pending"
    message.save()
    original_id = message.pk
    message.pk = uuid4()
    message.rule_version += 1
    message.provider_id = "second-message"
    message.notification = None
    message.save(force_insert=True)
    event = store_event(
        "simulated",
        "same-case-reply",
        "reply",
        int(timezone.now().timestamp()),
        {"sender": message.recipient, "text": "Sim"},
    )
    apply_reply(event, setup["unit"])
    from responses.models import Reply

    assert Reply.objects.get(event=event).message_id in {original_id, message.pk}
    wrong = store_event(
        "simulated",
        "unknown-context",
        "reply",
        int(timezone.now().timestamp()),
        {"sender": message.recipient, "text": "Sim", "context_id": "unknown"},
    )
    apply_reply(wrong, setup["unit"])
    assert Reply.objects.get(event=wrong).message_id is None


@pytest.mark.django_db
def test_generic_campaign_preview_keeps_real_data_blocked(setup):
    from messaging.models import Template
    from messaging.services import send_guard
    from operations.models import Campaign
    from operations.services import preview_campaign

    event = SourceEvent.objects.create(
        unit=setup["unit"],
        source="cross",
        kind="waitlist",
        external_id="cross-1",
        patient="Fictício",
        phone="5511999990001",
        occurred_at=timezone.now(),
    )
    case = Case.objects.create(unit=setup["unit"], event=event, purpose="waitlist")
    template = Template.objects.create(
        unit=setup["unit"], name="fila_test", body="Olá {{1}}", fields=["patient"], purpose="waitlist"
    )
    campaign = Campaign.objects.create(
        unit=setup["unit"], name="Teste", purpose="waitlist", template=template, scheduled_for=timezone.now()
    )
    campaign.cases.add(case)
    ids = preview_campaign(campaign)
    message = Message.objects.get(pk=ids[0])
    assert message.appointment_id is None
    assert message.state == "preview"
    assert send_guard(message) == "real_event_blocked"
    result = setup["client"].get(f"/api/v1/messages/{message.pk}/?unit=ame")
    assert result.status_code == 200
    assert result.data["patient"] == "Fictício"
    assert result.data["kind"] == "waitlist"


@pytest.mark.django_db
def test_create_unit_is_paused_and_isolated(setup):
    result = post(setup, "units", {"slug": "second", "name": "Segunda unidade"})
    assert result.status_code == 200, result.data
    unit = Unit.objects.get(slug="second")
    assert unit.paused
    assert not unit.rule_set.exists()
    assert Membership.objects.filter(unit=unit, user=setup["user"], role="admin").exists()


@pytest.mark.django_db
def test_non_ame_connection_never_falls_back(setup, settings, monkeypatch):
    from scheduling.connectors import OracleSource

    unit = Unit.objects.create(slug="other", name="Outra")
    settings.ORACLE_PASSWORD = "not-a-real-password"
    settings.ORACLE_DSN = "ame-only"
    for key in ["DSN", "USER", "PASSWORD"]:
        monkeypatch.delenv("ORACLE_OTHER_" + key, raising=False)
    assert OracleSource(unit).credentials() == ("", "", "")


@pytest.mark.django_db
def test_broken_xlsx_is_validation_error(setup):
    layout = ImportLayout.objects.create(
        unit=setup["unit"],
        name="Teste",
        verified=True,
        evidence="Teste",
        mapping={"external_id": "id", "patient": "nome", "phone": "fone", "occurred_at": "data"},
    )
    result = post(
        setup,
        "sheet-imports",
        {
            "layout": layout.pk,
            "filename": "broken.xlsx",
            "content_base64": base64.b64encode(b"not-a-zip").decode(),
        },
    )
    assert result.status_code == 400


@pytest.mark.django_db
def test_postoperative_flow_is_idempotent_and_analysis_only(setup):
    from zoneinfo import ZoneInfo

    from messaging.models import Template
    from operations.connectors import run_flow
    from operations.models import FlowRule, FlowRun, SourceConfiguration

    local = timezone.localtime(timezone.now(), ZoneInfo(setup["unit"].timezone))
    source = SourceConfiguration.objects.create(
        unit=setup["unit"],
        kind="postoperative",
        view_name="DBASISTEMAS.VDIC_BUSCA_ATIVA_ENVIO_MSG",
        verified=True,
        evidence="Fonte fictícia de teste",
    )
    template = Template.objects.create(
        unit=setup["unit"], name="postop", purpose="postoperative", body="Olá {{1}}", fields=["patient"]
    )
    rule = FlowRule.objects.create(
        unit=setup["unit"],
        code="postop-test",
        name="Pós teste",
        source=source,
        template=template,
        purpose="postoperative",
        send_time=local.time().replace(tzinfo=None),
        weekdays=[local.weekday()],
        enabled=True,
        evidence="Regra fictícia",
    )
    row = (
        "PROC1",
        123,
        "Paciente fictício",
        "5511999990001",
        "Procedimento fictício",
        (local.date() - timedelta(days=7)).strftime("%d/%m/%Y"),
        "Profissional fictício",
    )
    result = run_flow(rule, now=timezone.now() + timedelta(seconds=1), fetcher=lambda *_: [row])
    assert result.state == "completed"
    run_flow(rule, now=timezone.now() + timedelta(seconds=1), fetcher=lambda *_: [row])
    assert FlowRun.objects.count() == 1
    assert Message.objects.filter(purpose="postoperative", state="preview").count() == 1


@pytest.mark.django_db
def test_report_delivery_preview_does_not_send(setup):
    from operations.reports import prepare_delivery

    seed_catalog(setup["unit"])
    report = ReportDefinition.objects.get(unit=setup["unit"], code="contacts")
    access = ReportAccess.objects.create(
        unit=setup["unit"], user=setup["user"], phone=setup["message"].recipient, verified_at=timezone.now()
    )
    access.reports.add(report)
    job = ReportRequest.objects.create(
        unit=setup["unit"],
        report=report,
        requester=setup["user"],
        access=access,
        definition_version=1,
        format="pdf",
    )
    generate(job.pk)
    job.refresh_from_db()
    message = prepare_delivery(job)
    assert message.state == "preview"
    assert message.appointment_id is None
    assert message.report_request.pk == job.pk
    assert not message.attempts.exists()


@pytest.mark.django_db(transaction=True)
def test_postgres_concurrent_appointment_notes(setup):
    from concurrent.futures import ThreadPoolExecutor

    from django.db import close_old_connections, connection, connections
    from rest_framework.test import APIClient

    if connection.vendor != "postgresql":
        pytest.skip("Exige PostgreSQL para verificar bloqueio entre conexões reais.")
    case = case_for(setup)
    actor_id = setup["user"].pk

    def claim(_):
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(get_user_model().objects.get(pk=actor_id))
            return client.post(
                f"/api/v1/cases/{case.pk}/act/?unit=ame",
                {"version": case.version, "action": "note", "text": "Observação concorrente"},
                format="json",
                HTTP_IDEMPOTENCY_KEY=str(uuid4()),
            ).status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(claim, range(2))) == [200, 409]


@pytest.mark.django_db
def test_reply_for_previous_revision_cannot_confirm_new_date(setup):
    message = setup["message"]
    message.state, message.provider_id = "delivered", "old-revision"
    message.save()
    from dataclasses import replace

    from scheduling.services import upsert_appointment

    upsert_appointment(
        setup["unit"], replace(setup["row"], scheduled_at=setup["row"].scheduled_at + timedelta(days=1))
    )
    event = store_event(
        "simulated",
        "old-revision-reply",
        "reply",
        int(timezone.now().timestamp()),
        {"sender": message.recipient, "text": "Sim", "context_id": message.provider_id},
    )
    apply_reply(event, setup["unit"])
    case = case_for(setup)
    assert case.outcome == ""
    assert message.issues.filter(category="stale_reply").exists()


@pytest.mark.django_db
def test_movement_creates_only_preview_after_confirmation(setup):
    seed_catalog(setup["unit"])
    case = case_for(setup)
    created = post(
        setup,
        "movements",
        {
            "case": str(case.pk),
            "case_version": case.version,
            "kind": "cancel",
            "requested": {"reason": "Teste"},
        },
    )
    assert not Message.objects.filter(purpose="movement").exists()
    result = post(
        setup,
        f"movements/{created.data['id']}/confirm",
        {"version": 1, "evidence": "Cancelamento conferido no hospitalar", "final": {}},
    )
    assert result.status_code == 200, result.data
    message = Message.objects.get(purpose="movement")
    assert message.state == "preview"
    assert "cancelamento" in message.body
