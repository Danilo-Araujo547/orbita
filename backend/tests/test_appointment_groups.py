from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

import pytest
from core.models import Membership, Unit
from django.db import connection
from messaging.models import AppointmentGroup, Attempt
from messaging.services import dispatch
from scheduling.services import queue_appointment, upsert_appointment


def second(s, phone="5511999990002", external_id="SECOND"):
    a = upsert_appointment(s["unit"], replace(s["row"], external_id=external_id, phone=phone))
    return queue_appointment(a, s["rule"], s["now"], s["now"])


def schedule(s, group, key=None, **values):
    return s["client"].post(
        f"/api/v1/appointment-groups/{group.pk}/schedule/?unit=ame",
        {
            "version": 1,
            "scheduled_for": (s["now"] + timedelta(hours=2)).isoformat(),
            "delay_seconds": 12,
            **values,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=key or str(uuid4()),
    )


def test_unique_appointments_counts_and_group_filter(setup):
    s = setup
    a = upsert_appointment(s["unit"], replace(s["row"], phone_numbers=(s["row"].phone, "5511999990002")))
    queue_appointment(a, s["rule"], s["now"], s["now"])
    g = AppointmentGroup.objects.get()
    data = s["client"].get("/api/v1/appointment-groups/?unit=ame").data["results"][0]
    assert data["appointments_total"] == 1 and data["messages_total"] == 2
    assert s["client"].get(f"/api/v1/appointments/?unit=ame&group={g.pk}").data["count"] == 1
    m = second(s, phone="5511999990003")
    assert m.group_id == g.pk
    m.state = "accepted"
    m.save()
    data = s["client"].get(f"/api/v1/appointment-groups/{g.pk}/?unit=ame").data
    assert data["appointments_total"] == 2 and data["appointments_sent"] == 1
    assert data["messages_total"] == 3 and data["messages_sent"] == 1


def test_schedule_preserves_sent_messages_new_members_and_conflict(setup):
    pending = second(setup)
    sent = setup["message"]
    sent.state = "delivered"
    sent.save()
    stamp = sent.scheduled_for
    g = sent.group
    key = str(uuid4())
    response = schedule(setup, g, key=key)
    assert response.status_code == 200, response.data
    assert schedule(setup, g, key=key).data == response.data
    g.refresh_from_db()
    pending.refresh_from_db()
    sent.refresh_from_db()
    assert g.delay_seconds == 12 and g.version == 2
    assert pending.scheduled_for == g.scheduled_for and sent.scheduled_for == stamp
    assert second(setup, external_id="THIRD").scheduled_for == g.scheduled_for
    assert schedule(setup, g).status_code == 409


def test_different_rules_are_separate_and_communications_stay_in_group(setup):
    from scheduling.models import Rule

    original = setup["message"].group
    rule = Rule.objects.get(pk=setup["rule"].pk)
    rule.pk = None
    rule.code = "second-reminder"
    rule.days_before = 3
    rule.save()
    other = queue_appointment(setup["appointment"], rule, setup["now"], setup["now"])
    assert other.group_id != original.pk
    url = f"/api/v1/appointments/{setup['appointment'].pk}/communications/?unit=ame&group={original.pk}"
    result = setup["client"].get(url)
    assert result.status_code == 200 and result.data["count"] == 1
    assert str(result.data["results"][0]["id"]) == str(setup["message"].pk)


def test_schedule_validation_and_unit_permissions(setup):
    g = setup["message"].group
    for value in (
        {"delay_seconds": -1},
        {"delay_seconds": 3601},
        {"scheduled_for": setup["now"].isoformat()},
        {"scheduled_for": (setup["row"].scheduled_at + timedelta(hours=1)).isoformat()},
    ):
        assert schedule(setup, g, **value).status_code == 400
    other = Unit.objects.create(slug="other", name="Outra")
    Membership.objects.create(unit=other, user=setup["user"], role="viewer")
    assert setup["client"].get(f"/api/v1/appointment-groups/{g.pk}/?unit=other").status_code == 404
    assert setup["client"].get(f"/api/v1/appointments/?unit=other&group={g.pk}").status_code == 404
    Membership.objects.filter(unit=setup["unit"], user=setup["user"]).update(role="operator")
    assert schedule(setup, g).status_code == 403


def test_dispatch_reconciles_concurrently_inserted_member_with_edited_schedule(setup):
    s = setup
    s["template"].approved_for_test = True
    s["template"].save()
    message = s["message"]
    group = message.group
    group.schedule_overridden = True
    group.scheduled_for = s["now"] - timedelta(minutes=1)
    group.save()
    message.scheduled_for = s["now"] + timedelta(days=1)
    message.expires_at = s["now"] - timedelta(seconds=10)
    message.save()
    result = dispatch(message.pk, now=s["now"])
    assert result.state == "accepted"
    assert result.scheduled_for == group.scheduled_for and result.expires_at > s["now"]


def test_dispatch_interval(setup, settings):
    settings.TEST_RECIPIENTS = (setup["row"].phone, "5511999990002")
    setup["template"].approved_for_test = True
    setup["template"].save()
    m = second(setup)
    g = m.group
    g.delay_seconds = 10
    g.save()
    dispatch(setup["message"].pk, now=setup["now"])
    dispatch(m.pk, now=setup["now"] + timedelta(seconds=9))
    assert Attempt.objects.count() == 1
    dispatch(m.pk, now=setup["now"] + timedelta(seconds=10))
    assert Attempt.objects.count() == 2


@pytest.mark.django_db(transaction=True)
def test_group_interval_with_two_postgres_workers(setup, settings):
    if connection.vendor != "postgresql":
        pytest.skip("Requires PostgreSQL")
    from concurrent.futures import ThreadPoolExecutor

    from django.db import connections

    settings.TEST_RECIPIENTS = (setup["row"].phone, "5511999990002")
    setup["template"].approved_for_test = True
    setup["template"].save()
    m = second(setup)

    def run(pk):
        try:
            dispatch(pk, now=setup["now"])
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(run, [setup["message"].pk, m.pk]))
    assert Attempt.objects.count() == 1
