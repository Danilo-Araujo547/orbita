import csv
import io
from uuid import uuid4

import pytest

from core.models import Membership, Unit
from operations.models import Campaign, Case, Contact, Interaction, SourceEvent

pytestmark = pytest.mark.django_db


def cross(setup, purpose="absence", unit=None):
    unit = unit or setup["unit"]
    event = SourceEvent.objects.create(
        unit=unit,
        source="cross:test",
        external_id=str(uuid4()),
        kind=purpose,
        patient="Paciente CROSS fictício",
        phone="5511999990001",
        occurred_at=setup["now"],
        synthetic=True,
        data={"procedure": "Consulta fictícia", "patient_external_id": "CROSS-P-1"},
    )
    case = Case.objects.create(unit=unit, event=event, purpose=purpose)
    Contact.objects.create(unit=unit, event=event, phone=event.phone)
    return case


def test_agenda_combines_records_without_copying_or_duplicate_contacts(setup):
    case = cross(setup)
    Contact.objects.create(unit=setup["unit"], event=case.event, phone="5511999990002")
    for index in range(2):
        campaign = Campaign.objects.create(
            unit=setup["unit"], name=f"Campanha {index}", purpose="absence"
        )
        campaign.cases.add(case)
    result = setup["client"].get("/api/v1/agenda-items/?unit=ame")
    assert result.status_code == 200, result.data
    assert result.data["count"] == 2
    imported = next(
        row for row in result.data["results"] if row["record_type"] == "cross"
    )
    assert len(imported["tracking"]["contacts"]) == 2
    assert imported["tracking"]["id"] == str(case.pk)
    assert imported["id"] == f"cross-{case.pk}"
    assert setup["client"].get("/api/v1/appointments/?unit=ame").data["count"] == 1
    assert setup["appointment"].__class__.objects.count() == 1


def test_agenda_types_and_filters_are_unit_scoped(setup):
    case = cross(setup)
    other = Unit.objects.create(slug="other", name="Other")
    cross(setup, "postoperative", other)
    types = setup["client"].get("/api/v1/agenda-items/types/?unit=ame").data
    assert {item["value"] for item in types} == {
        "consultation",
        "exam",
        "lab",
        "postprocedure",
        "cross:absence",
    }
    client = setup["client"]
    selected = client.get("/api/v1/agenda-items/?unit=ame&kind=cross:absence").data
    assert selected["count"] == 1
    assert selected["results"][0]["tracking"]["id"] == str(case.pk)
    assert (
        client.get("/api/v1/agenda-items/?unit=ame&kind=consultation").data["count"]
        == 1
    )
    assert client.get("/api/v1/agenda-items/?unit=ame&kind=invalid").status_code == 400
    assert client.get("/api/v1/agenda-items/?unit=other").status_code == 403


def test_agenda_communications_and_manual_history(setup):
    case = cross(setup)
    original = setup["message"]
    original.pk = uuid4()
    original.notification_key = None
    original.notification = None
    original.group = None
    original.appointment = None
    original.case = case
    original.purpose = "absence"
    original.snapshot = {}
    original.save()
    Interaction.objects.create(
        case=case,
        occurred_at=setup["now"],
        actor=setup["user"],
        kind="classification",
        outcome="reason_received",
        text="Motivo registrado",
    )
    response = setup["client"].get(
        f"/api/v1/agenda-items/cross-{case.pk}/communications/?unit=ame"
    )
    assert response.status_code == 200, response.data
    assert response.data["count"] == 1
    assert response.data["results"][0]["id"] == str(original.pk)
    assert response.data["manual_responses"][0]["outcome"] == "reason_received"
    other = Unit.objects.create(slug="other", name="Other")
    foreign = cross(setup, unit=other)
    assert (
        setup["client"]
        .get(f"/api/v1/agenda-items/cross-{foreign.pk}/communications/?unit=ame")
        .status_code
        == 404
    )


def test_agenda_filters_notes_search_dates_and_export(setup):
    case = cross(setup)
    Interaction.objects.create(
        case=case,
        occurred_at=setup["now"],
        actor=setup["user"],
        kind="note",
        text="Observação fictícia",
    )
    client = setup["client"]
    assert (
        client.get("/api/v1/agenda-items/?unit=ame&observations=true").data["count"]
        == 1
    )
    assert (
        client.get("/api/v1/agenda-items/?unit=ame&observations=false").data["count"]
        == 1
    )
    assert (
        client.get("/api/v1/agenda-items/?unit=ame&search=CROSS-P-1").data["count"] == 1
    )
    assert (
        client.get("/api/v1/agenda-items/?unit=ame&end=2000-01-01").data["count"] == 0
    )
    assert client.get("/api/v1/agenda-items/?unit=ame&start=invalid").status_code == 400
    response = client.get("/api/v1/agenda-items/export/?unit=ame&kind=cross:absence")
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert len(rows) == 2 and rows[1][1] == case.event.patient
    assert case.event.external_id in rows[1]


def test_appointments_only_user_can_view_cross_but_not_reports_or_edit(setup):
    case = cross(setup, "waitlist")
    report = cross(setup, "report")
    member = Membership.objects.get(user=setup["user"], unit=setup["unit"])
    member.role = "viewer"
    member.permissions = {
        "appointments": "read",
        "campaigns": "none",
        "reports": "none",
    }
    member.save()
    client = setup["client"]
    assert client.get("/api/v1/agenda-items/?unit=ame").data["count"] == 2
    assert client.get(f"/api/v1/cases/{case.pk}/?unit=ame").status_code == 200
    assert client.get(f"/api/v1/cases/{report.pk}/?unit=ame").status_code == 404
    assert (
        client.post(
            f"/api/v1/cases/{case.pk}/act/?unit=ame",
            {"action": "note", "text": "Unauthorized"},
            format="json",
        ).status_code
        == 403
    )
    member.permissions = {
        "appointments": "none",
        "campaigns": "read",
        "reports": "none",
    }
    member.save()
    assert client.get("/api/v1/agenda-items/?unit=ame").status_code == 403


def test_agenda_pending_preserves_confirmations_and_includes_postoperative_attention(
    setup,
):
    case = cross(setup, "postoperative")
    case.outcome = "needs_attention"
    case.save()
    assert (
        setup["client"]
        .get("/api/v1/agenda-items/?unit=ame&operational_pending=true")
        .data["count"]
        == 1
    )
    case.outcome = "confirmed"
    case.save()
    assert (
        setup["client"]
        .get("/api/v1/agenda-items/?unit=ame&operational_pending=true")
        .data["count"]
        == 0
    )


def test_group_filter_and_paginated_cross_records(setup):
    group_id = setup["message"].group_id
    cross(setup)
    client = setup["client"]
    assert (
        client.get(f"/api/v1/agenda-items/?unit=ame&group={group_id}").data["count"]
        == 1
    )
    assert client.get("/api/v1/agenda-items/?unit=ame&group=invalid").status_code == 400
    for _ in range(51):
        cross(setup)
    first = client.get("/api/v1/agenda-items/?unit=ame&kind=cross:absence").data
    second = client.get("/api/v1/agenda-items/?unit=ame&kind=cross:absence&page=2").data
    assert (
        first["count"] == 52
        and len(first["results"]) == 50
        and len(second["results"]) == 2
    )
    assert not (
        {row["id"] for row in first["results"]}
        & {row["id"] for row in second["results"]}
    )
