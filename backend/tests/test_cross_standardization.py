import base64
import csv
import io
from datetime import timedelta

import pytest
from django.utils import timezone
from operations.standardization import (
    STANDARD_FIELDS,
    csv_standard_rows,
    template_bindings,
)
from rest_framework.exceptions import ValidationError

from core.models import Unit
from messaging.models import Message, Template
from operations.models import Campaign, ImportLayout
from operations.services import preview_campaign
from operations.sheets import confirm_sheet, preview_sheet


def payload(**changes):
    values = {
        "nome_completo": "PACIENTE FICTÍCIO",
        "data": "22/10/2026",
        "hora": "10:30",
        "celular": "11999990001",
        "celular2": "11999990002",
        "tipo": "EXAME TESTE",
        "horario_chegada": "10:00",
        "data_nascimento": "02/01/1980",
        "codigo": "000123",
        "local": "UNIDADE TESTE",
        "tipo2": "Primeira vez",
        "obs": "OBSERVAÇÃO ORIGINAL",
    }
    values.update(changes)
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(STANDARD_FIELDS), delimiter=";")
    writer.writeheader()
    writer.writerow(values)
    return out.getvalue().encode("utf-8-sig")


def config(setup, fields=None):
    template = Template.objects.create(
        unit=setup["unit"],
        name="cross_standard",
        purpose="waitlist",
        body="Olá {{1}}: {{2}}",
        fields=["patient", "procedure"],
        approved_for_test=True,
    )
    layout = ImportLayout.objects.create(
        unit=setup["unit"],
        name="Padrão 12",
        verified=True,
        mapping={
            "external_id": "codigo",
            "patient": "nome_completo",
            "phone": "celular",
            "occurred_at": "data",
        },
        default_template=template,
        parameter_fields=fields or ["nome_completo", "tipo"],
    )
    return layout, template


@pytest.mark.django_db
def test_standard_table_and_template_are_frozen_per_import(setup):
    layout, _template = config(setup)
    batch = preview_sheet(setup["unit"], layout, setup["user"], "padrao.csv", payload())
    assert not batch.errors
    row = batch.rows[0]
    assert tuple(row["standardized"]) == STANDARD_FIELDS
    assert row["nome_completo"] == "PACIENTE FICTÍCIO"
    assert row["codigo"] == "000123"
    assert row["data"] == "22/10/2026" and row["hora"] == "10:30"
    assert row["data_nascimento"] == "02/01/1980"
    assert row["phone_numbers"] == ["5511999990001", "5511999990002"]
    assert row["occurred_at"] == "2026-10-22T10:30:00-03:00"
    layout.parameter_fields = ["nome_completo", "local"]
    layout.save()
    ids = confirm_sheet(batch, "waitlist")
    campaign = Campaign.objects.get(import_batch=batch)
    assert not campaign.sends_enabled and campaign.state == "draft"
    assert (
        campaign.cases.count() == 1
        and Message.objects.filter(snapshot__campaign=campaign.pk).count() == 0
    )
    campaign.scheduled_for = timezone.now() + timedelta(days=1)
    campaign.save()
    generated = preview_campaign(campaign)
    assert len(generated) == 2
    for msg in Message.objects.filter(pk__in=generated):
        assert msg.parameters == ["PACIENTE FICTÍCIO", "EXAME TESTE"]
        assert msg.snapshot["fields"] == ["nome_completo", "tipo"]
        assert msg.snapshot["import_batch"] == str(batch.pk)
        assert msg.body == "Olá PACIENTE FICTÍCIO: EXAME TESTE"
        assert msg.state == "preview"
    assert len(ids) == 1


@pytest.mark.django_db
def test_missing_required_template_value_blocks_confirmation(setup):
    layout, _ = config(setup, fields=["nome_completo", "data_nascimento"])
    batch = preview_sheet(
        setup["unit"], layout, setup["user"], "padrao.csv", payload(data_nascimento="")
    )
    assert any(e["code"] == "missing_template_parameter" for e in batch.errors)
    with pytest.raises(ValidationError):
        confirm_sheet(batch, "waitlist")
    assert not Campaign.objects.filter(import_batch=batch).exists()


@pytest.mark.django_db
def test_import_identity_includes_template_binding_configuration(setup):
    layout, _ = config(setup)
    first = preview_sheet(setup["unit"], layout, setup["user"], "padrao.csv", payload())
    same = preview_sheet(setup["unit"], layout, setup["user"], "padrao.csv", payload())
    different = preview_sheet(
        setup["unit"],
        layout,
        setup["user"],
        "padrao.csv",
        payload(),
        parameter_fields=["nome_completo", "local"],
    )
    assert first.pk == same.pk and first.pk != different.pk


@pytest.mark.django_db
def test_changed_template_and_wrong_unit_cannot_use_import(setup):
    layout, template = config(setup)
    batch = preview_sheet(setup["unit"], layout, setup["user"], "padrao.csv", payload())
    template.version += 1
    template.save()
    with pytest.raises(ValidationError):
        confirm_sheet(batch, "waitlist")
    other = Unit.objects.create(slug="other", name="OTHER")
    foreign = Template.objects.create(
        unit=other, name="foreign", purpose="waitlist", body="{{1}}", fields=["patient"]
    )
    with pytest.raises(ValidationError):
        preview_sheet(
            setup["unit"],
            layout,
            setup["user"],
            "padrao.csv",
            payload(),
            template_id=foreign.pk,
        )


@pytest.mark.django_db
def test_export_and_schema_are_unit_scoped_and_csv_is_safe(setup):
    layout, _ = config(setup)
    batch = preview_sheet(
        setup["unit"], layout, setup["user"], "padrao.csv", payload(obs="=1+1")
    )
    response = setup["client"].get(f"/api/v1/sheet-imports/{batch.pk}/export/?unit=ame")
    assert response.status_code == 200
    rows = list(
        csv.reader(io.StringIO(response.content.decode("utf-8-sig")), delimiter=";")
    )
    assert rows[0] == list(STANDARD_FIELDS) and rows[1][11] == "'=1+1"
    assert response["Cache-Control"] == "no-store"
    schema = setup["client"].get("/api/v1/sheet-imports/schema/?unit=ame")
    assert schema.data["fields"] == list(STANDARD_FIELDS)
    Unit.objects.create(slug="other", name="OTHER")
    assert setup["client"].get(
        f"/api/v1/sheet-imports/{batch.pk}/export/?unit=other"
    ).status_code in [403, 404]


@pytest.mark.django_db
def test_api_creates_bound_import_and_draft_without_notifications(setup):
    layout, template = config(setup)
    response = setup["client"].post(
        "/api/v1/sheet-imports/?unit=ame",
        {
            "layout": layout.pk,
            "template": template.pk,
            "parameter_fields": ["nome_completo", "tipo"],
            "filename": "padrao.csv",
            "content_base64": base64.b64encode(payload()).decode(),
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="standard-import",
    )
    assert response.status_code == 200 and response.data["template"] == template.pk
    before = Message.objects.count()
    batch_id = response.data["id"]
    confirmed = setup["client"].post(
        f"/api/v1/sheet-imports/{batch_id}/confirm/?unit=ame",
        {"purpose": "waitlist"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="standard-confirm",
    )
    assert confirmed.status_code == 200
    campaign = Campaign.objects.get(import_batch_id=batch_id)
    assert Message.objects.count() == before
    schedule = setup["client"].post(
        f"/api/v1/campaigns/{campaign.pk}/schedule/?unit=ame",
        {
            "version": campaign.version,
            "scheduled_for": (timezone.now() + timedelta(days=1)).isoformat(),
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="standard-schedule",
    )
    assert schedule.status_code == 200
    stale = setup["client"].post(
        f"/api/v1/campaigns/{campaign.pk}/schedule/?unit=ame",
        {"version": 1, "scheduled_for": timezone.now().isoformat()},
        format="json",
        HTTP_IDEMPOTENCY_KEY="stale-standard-schedule",
    )
    assert stale.status_code == 409


def test_binding_validation_and_formula_safe_export():
    class Sample:
        body = "{{1}} {{2}}"
        fields = ["patient", "procedure"]

    assert template_bindings(Sample()) == ["nome_completo", "tipo"]
    with pytest.raises(ValidationError):
        template_bindings(Sample(), ["nome_completo", "inventado"])
    assert "'=1+1" in csv_standard_rows([{"standardized": {"obs": "=1+1"}}])


@pytest.mark.django_db
def test_mapping_override_uses_current_file_columns(setup):
    layout, _ = config(setup)
    content = (
        payload().decode("utf-8-sig").replace("nome_completo;", "Nome da origem;", 1)
    )
    mapping = {field: field for field in STANDARD_FIELDS}
    mapping["nome_completo"] = "Nome da origem"
    batch = preview_sheet(
        setup["unit"],
        layout,
        setup["user"],
        "custom.csv",
        content.encode(),
        standard_mapping=mapping,
    )
    assert not batch.errors and batch.rows[0]["nome_completo"] == "PACIENTE FICTÍCIO"


@pytest.mark.django_db
def test_admin_configuration_schema_does_not_grant_import_data_access(setup):
    from core.models import Membership

    layout, _ = config(setup)
    batch = preview_sheet(setup["unit"], layout, setup["user"], "padrao.csv", payload())
    membership = Membership.objects.get(user=setup["user"], unit=setup["unit"])
    membership.permissions = {
        "operationsAdmin": "read",
        "campaigns": "none",
        "settings": "none",
    }
    membership.save()
    assert (
        setup["client"].get("/api/v1/sheet-imports/schema/?unit=ame").status_code == 200
    )
    assert (
        setup["client"]
        .get(f"/api/v1/sheet-imports/{batch.pk}/export/?unit=ame")
        .status_code
        == 403
    )


@pytest.mark.django_db
def test_demand_entry_date_is_not_used_as_appointment_parameter(setup):
    from operations.demand_csv import HEADERS

    cells = [""] * 31
    for i, value in {
        0: "001",
        1: "PACIENTE TESTE",
        2: "(11)999990001 () ()",
        4: "RECURSO TESTE",
        13: "2026-10-13 10:30:00",
        14: "Qualificação Pendente",
    }.items():
        cells[i] = value
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";")
    writer.writerow(HEADERS)
    writer.writerow(cells)
    template = Template.objects.create(
        unit=setup["unit"],
        name="date_required",
        purpose="waitlist",
        body="{{1}}",
        fields=["date"],
    )
    layout = ImportLayout.objects.create(
        unit=setup["unit"],
        name="Demanda",
        format="cross_demand_csv",
        verified=True,
        default_template=template,
        parameter_fields=["data"],
    )
    batch = preview_sheet(
        setup["unit"],
        layout,
        setup["user"],
        "demanda.csv",
        out.getvalue().encode("utf-8"),
    )
    assert any(e["code"] == "missing_template_parameter" for e in batch.errors)


@pytest.mark.django_db
def test_changed_standard_values_cannot_reuse_an_older_event_silently(setup):
    layout, _ = config(setup)
    first = preview_sheet(
        setup["unit"], layout, setup["user"], "original.csv", payload()
    )
    confirm_sheet(first, "waitlist")
    changed = preview_sheet(
        setup["unit"],
        layout,
        setup["user"],
        "changed.csv",
        payload(local="OUTRA UNIDADE"),
    )
    with pytest.raises(ValidationError):
        confirm_sheet(changed, "waitlist")
    assert Campaign.objects.filter(import_batch__in=[first, changed]).count() == 1


@pytest.mark.django_db
def test_legacy_preview_stays_readable_without_rewriting_history(setup):
    from operations.models import SheetImport

    layout = ImportLayout.objects.create(
        unit=setup["unit"], name="Legado", verified=True
    )
    original = {
        "external_id": "OLD-001",
        "patient": "PACIENTE ANTIGO FICTÍCIO",
        "phone": "5511999990001",
        "occurred_at": "2026-10-13T10:30:00-03:00",
    }
    batch = SheetImport.objects.create(
        unit=setup["unit"],
        layout=layout,
        digest="legacy-test",
        rows=[original],
        created_by=setup["user"],
    )
    response = setup["client"].get(f"/api/v1/sheet-imports/{batch.pk}/rows/?unit=ame")
    assert response.status_code == 200
    assert response.data["results"][0]["nome_completo"] == original["patient"]
    assert response.data["results"][0]["codigo"] == "OLD-001"
    assert response.data["results"][0]["data"] == ""
    batch.refresh_from_db()
    assert batch.rows == [original]
