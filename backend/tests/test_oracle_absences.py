from datetime import date, datetime, timedelta
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.models import Unit
from messaging.models import Message, Template
from operations.models import Campaign, Case, Contact, ImportLayout, SheetImport
from operations.oracle_absences import fetch_absences, generate_absences, mapped_row
from operations.sheets import preview_sheet

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def no_messages(monkeypatch):
    def denied(*args, **kwargs):
        pytest.fail("No real messages or HTTP calls are allowed")

    monkeypatch.setattr("requests.sessions.Session.request", denied)
    monkeypatch.setattr("messaging.transports.MetaTransport.send", denied)


def raw(item_type="A"):
    return {
        "CD_PACIENTE": 101,
        "CD_IT_AGENDA_CENTRAL": 777,
        "NM_PACIENTE": "PACIENTE FICTÍCIO",
        "TP_ITEM": item_type,
        "CD_ATENDIMENTO": None,
        "DT_AGENDA": datetime(2026, 10, 20, 15),
        "HR_AGENDA": datetime(2026, 10, 20, 10, 30),
        "DS_ITEM_AGENDAMENTO": "PROCEDIMENTO TESTE",
        "DS_CONSULTORIO": "SALA TESTE",
        "DT_NASCIMENTO": datetime(2000, 1, 2),
        "A_CELULAR": "999990001",
        "A_DDD_CELULAR": "17",
        "P_CELULAR": "17999990002",
        "A_FONE": "17999990001",
    }


def layout(setup):
    return ImportLayout.objects.create(
        unit=setup["unit"], name="Ausentes", format="absence_html", verified=True
    )


@pytest.mark.parametrize(
    "code,kind", [("A", "consultation"), ("I", "exam"), ("L", "lab")]
)
def test_query_read_only_date_range_and_type_bound(setup, monkeypatch, code, kind):
    row = raw(code)
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.description = [(key,) for key in row]
    cursor.fetchmany.return_value = [tuple(row.values())]
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.return_value = cursor
    monkeypatch.setattr(
        "operations.oracle_absences.connection_payload",
        lambda unit: {"timeout_ms": 10000},
    )
    monkeypatch.setattr(
        "operations.oracle_absences.connect", lambda payload: connection
    )
    rows = fetch_absences(setup["unit"], date(2026, 10, 20), code)
    calls = cursor.execute.call_args_list
    assert calls[0].args == ("SET TRANSACTION READ ONLY",)
    sql = calls[1].args[0]
    assert "a.CD_ATENDIMENTO IS NULL" in sql
    assert "ia.TP_ITEM = :item_type" in sql
    assert calls[1].kwargs == {
        "start_day": datetime(2026, 10, 20),
        "end_day": datetime(2026, 10, 21),
        "item_type": code,
    }
    connection.rollback.assert_called_once()
    assert rows[0]["appointment_kind"] == kind
    assert rows[0]["occurred_at"] == "2026-10-20T10:30:00"
    assert rows[0]["phone_numbers"] == ["5517999990001", "5517999990002"]


def test_generated_records_disabled_deduplicated_and_no_messages(setup, monkeypatch):
    model = layout(setup)
    monkeypatch.setattr(
        "operations.oracle_absences.fetch_absences", lambda *args: [mapped_row(raw())]
    )
    count = Message.objects.count()
    batch = generate_absences(
        setup["unit"], setup["user"], model, date(2026, 10, 20), "A"
    )
    assert batch.state == "confirmed" and not batch.errors
    assert batch.configuration["source"]["item_type"] == "A"
    assert batch.rows[0]["standardized"]["tipo2"] == "Consulta"
    assert batch.rows[0]["standardized"]["data_nascimento"] == "02/01/2000"
    case = Case.objects.get(purpose="absence")
    assert case.event.external_id == "oracle:777"
    assert Contact.objects.filter(event=case.event).count() == 2
    again = generate_absences(
        setup["unit"], setup["user"], model, date(2026, 10, 20), "A"
    )
    assert again.pk == batch.pk and SheetImport.objects.count() == 1
    assert Case.objects.filter(purpose="absence").count() == 1
    assert Message.objects.count() == count
    assert not Campaign.objects.filter(import_batch=batch).exists()
    response = setup["client"].get(
        "/api/v1/agenda-items/?unit=ame&kind=cross:absence:A"
    )
    assert response.status_code == 200 and response.data["count"] == 1
    assert (
        setup["client"]
        .get("/api/v1/agenda-items/?unit=ame&kind=cross:absence:I")
        .data["count"]
        == 0
    )


def test_template_snapshot_and_disabled_campaign(setup, monkeypatch):
    template = Template.objects.create(
        unit=setup["unit"],
        name="ausente",
        purpose="absence",
        body="Olá {{1}}",
        fields=["nome_completo"],
    )
    model = layout(setup)
    monkeypatch.setattr(
        "operations.oracle_absences.fetch_absences", lambda *args: [mapped_row(raw())]
    )
    before = Message.objects.count()
    batch = generate_absences(
        setup["unit"], setup["user"], model, date(2026, 10, 20), "A", template.pk
    )
    assert not batch.campaign.sends_enabled
    assert batch.campaign.scheduled_for is None
    assert batch.configuration["template"]["name"] == "ausente"
    assert Message.objects.count() == before


def test_missing_contact_or_patient_remains_preview(setup, monkeypatch):
    bad = raw()
    bad.update(A_CELULAR=None, P_CELULAR=None, A_FONE=None)
    model = layout(setup)
    monkeypatch.setattr(
        "operations.oracle_absences.fetch_absences", lambda *args: [mapped_row(bad)]
    )
    batch = generate_absences(
        setup["unit"], setup["user"], model, date(2026, 10, 20), "A"
    )
    assert batch.errors and batch.state == "preview"
    assert not Case.objects.filter(purpose="absence").exists()
    bad = raw()
    bad["CD_PACIENTE"] = None
    monkeypatch.setattr(
        "operations.oracle_absences.fetch_absences", lambda *args: [mapped_row(bad)]
    )
    batch = generate_absences(
        setup["unit"], setup["user"], model, date(2026, 10, 20), "A"
    )
    assert batch.errors and batch.state == "preview"


def test_api_validation_scope_idempotency_and_filters(setup, monkeypatch):
    model = layout(setup)
    fetch = MagicMock(return_value=[mapped_row(raw())])
    monkeypatch.setattr("operations.oracle_absences.fetch_absences", fetch)
    url = "/api/v1/sheet-imports/oracle-absences/?unit=ame"
    body = {"layout": model.pk, "absence_date": "2026-10-20", "item_type": "A"}
    key = str(uuid4())
    response = setup["client"].post(url, body, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert response.status_code == 200, response.data
    assert response.data["control_status"]["enabled"] is False
    again = setup["client"].post(url, body, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert again.data["id"] == response.data["id"] and fetch.call_count == 1

    def post(data):
        return setup["client"].post(
            url, data, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4())
        )

    assert post({**body, "item_type": "X"}).status_code == 400
    assert (
        post(
            {
                **body,
                "absence_date": (timezone.localdate() + timedelta(days=1)).isoformat(),
            }
        ).status_code
        == 400
    )
    other = Unit.objects.create(slug="other", name="Outra")
    foreign = ImportLayout.objects.create(
        unit=other, name="Ausentes", format="absence_html", verified=True
    )
    assert post({**body, "layout": foreign.pk}).status_code == 404
    assert fetch.call_count == 1
    assert (
        setup["client"]
        .get("/api/v1/sheet-imports/?unit=ame&origin=oracle&item_type=A")
        .data["count"]
        == 1
    )
    assert (
        setup["client"].get("/api/v1/sheet-imports/?unit=ame&item_type=I").data["count"]
        == 0
    )
    from tests.test_absence_import import sheet

    preview_sheet(setup["unit"], model, setup["user"], "ausentes.xls", sheet())
    assert (
        setup["client"]
        .get("/api/v1/sheet-imports/?unit=ame&origin=sheet")
        .data["count"]
        == 1
    )


def test_connection_error_is_sanitized_and_rolled_back(setup, monkeypatch):
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.side_effect = RuntimeError("secret username/password")
    monkeypatch.setattr(
        "operations.oracle_absences.connection_payload", lambda unit: {}
    )
    # A configured payload must be truthy.
    monkeypatch.setattr(
        "operations.oracle_absences.connection_payload",
        lambda unit: {"timeout_ms": 10000},
    )
    monkeypatch.setattr(
        "operations.oracle_absences.connect", lambda payload: connection
    )
    with pytest.raises(ValidationError) as exc:
        fetch_absences(setup["unit"], date(2026, 10, 20), "A")
    assert "secret" not in str(exc.value)
    connection.rollback.assert_called_once()


def test_all_types_keeps_distinct_appointments_and_all_contacts(setup, monkeypatch):
    model = layout(setup)
    source_rows = []
    for index, code in enumerate(("A", "I", "L")):
        row = raw(code)
        row.update(CD_IT_AGENDA_CENTRAL=880 + index,
                   P_FONE="17999990003", P_DDD_FONE="17")
        source_rows.append(mapped_row(row))
    monkeypatch.setattr("operations.oracle_absences.fetch_absences", lambda *args: source_rows)
    before = Message.objects.count()
    batch = generate_absences(setup["unit"], setup["user"], model,
                              date(2026, 10, 20), "ALL")
    assert batch.state == "confirmed" and not batch.errors
    assert batch.configuration["source"]["item_type"] == "ALL"
    assert {r["appointment_kind"] for r in batch.rows} == {"consultation", "exam", "lab"}
    cases = Case.objects.filter(purpose="absence")
    assert cases.count() == 3
    assert all(Contact.objects.filter(event=c.event).count() == 3 for c in cases)
    assert {c.event.data["patient_external_id"] for c in cases} == {"101"}
    from scheduling.models import Patient
    assert Patient.objects.filter(unit=setup["unit"], external_id="101").count() == 1
    again = generate_absences(setup["unit"], setup["user"], model,
                              date(2026, 10, 20), "ALL")
    assert again.pk == batch.pk
    assert Case.objects.filter(purpose="absence").count() == 3
    assert Message.objects.count() == before


def test_all_type_selection_uses_bound_parameter(setup, monkeypatch):
    row = raw("L")
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.description = [(key,) for key in row]
    cursor.fetchmany.return_value = [tuple(row.values())]
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.return_value = cursor
    monkeypatch.setattr("operations.oracle_absences.connection_payload", lambda unit: {"timeout_ms": 10000})
    monkeypatch.setattr("operations.oracle_absences.connect", lambda payload: connection)
    rows = fetch_absences(setup["unit"], date(2026, 10, 20), "ALL")
    query = cursor.execute.call_args_list[1]
    assert query.kwargs["item_type"] == "ALL"
    assert "ia.TP_ITEM IN ('A', 'I', 'L')" in query.args[0]
    assert rows[0]["appointment_kind"] == "lab"
    connection.rollback.assert_called_once()


def test_oracle_uses_layout_parameter_mapping(setup, monkeypatch):
    model = layout(setup)
    model.standard_mapping = {"tipo2": "tp_item"}
    model.save()
    monkeypatch.setattr("operations.oracle_absences.fetch_absences", lambda *args: [mapped_row(raw("I"))])
    batch = generate_absences(setup["unit"], setup["user"], model,
                              date(2026, 10, 20), "ALL")
    assert batch.rows[0]["standardized"]["tipo2"] == "I"


def test_api_accepts_all_absence_types():
    from operations.serializers import OracleAbsenceInput
    values = OracleAbsenceInput(data={"layout": 1, "absence_date": "2026-10-20", "item_type": "ALL"})
    assert values.is_valid(), values.errors
    assert values.validated_data["item_type"] == "ALL"
