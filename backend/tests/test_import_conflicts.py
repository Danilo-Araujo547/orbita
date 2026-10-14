from dataclasses import replace

from scheduling.connectors import consolidate_rows
from scheduling.services import queue_appointment, upsert_appointment


def test_multiple_contacts_share_appointment_and_notification(setup):
    s = setup
    rows = consolidate_rows([s["row"], replace(s["row"], phone="5511999990002")])
    assert len(rows) == 1
    assert len(rows[0].phone_numbers) == 2 and rows[0].data_issue == ""
    appointment = upsert_appointment(s["unit"], rows[0])
    message = queue_appointment(appointment, s["rule"], s["now"])
    assert message.state == "queued" and message.error_code == ""
    deliveries = appointment.messages.filter(appointment_revision=appointment.revision)
    assert deliveries.count() == 2
    assert len(set(deliveries.values_list("notification_id", flat=True))) == 1
    assert appointment.sourceevent.cases.count() == 1


def test_identical_view_rows_collapse_without_blocking(setup):
    rows = consolidate_rows([setup["row"], setup["row"]])
    assert len(rows) == 1 and rows[0].data_issue == ""


def test_conflicting_clinical_fields_become_issue(setup):
    rows = consolidate_rows([setup["row"], replace(setup["row"], procedure="OUTRO EXAME")])
    assert len(rows) == 1 and rows[0].data_issue == "ambiguous_source_record"


def test_consolidation_stable_across_row_order(setup):
    rows = [setup["row"], replace(setup["row"], phone="5511999990002")]
    assert consolidate_rows(rows) == consolidate_rows(list(reversed(rows)))


def test_invalid_uuid_is_client_error(setup):
    result = setup["client"].post("/api/v1/tests/process/", {"message_id": "invalid"}, format="json")
    assert result.status_code == 400
