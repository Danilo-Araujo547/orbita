import sqlite3
from dataclasses import replace
from datetime import date, timedelta
from uuid import uuid4

import pytest
from core.models import Membership, Unit
from messaging.models import Attempt, Message
from messaging.services import dispatch, send_guard
from messaging.tasks import dispatch_manual_due
from scheduling.connectors import appointment_source
from scheduling.models import Appointment
from scheduling.services import queue_appointment, upsert_appointment
from scheduling.simulated import SQLiteSource, create_source, import_simulated


def release(s, group=None, key=None, **data):
    group = group or s["message"].group
    return s["client"].post(
        f"/api/v1/appointment-groups/{group.pk}/dispatch-now/?unit=ame",
        {"version": 1, "delay_seconds": 30, **data},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key or str(uuid4()),
    )


def test_source_readonly_distribution_and_unit_isolation(setup, tmp_path, settings):
    path = create_source(tmp_path / "source.sqlite3", setup["unit"], date(2026, 10, 1))
    settings.SIMULATED_SQLITE_PATH = str(path)
    source = appointment_source(setup["unit"])
    assert isinstance(source, SQLiteSource)
    with source.connect() as connection:
        assert [
            tuple(row)
            for row in connection.execute(
                "SELECT substr(DTA_AGENDA,1,7),count(*) FROM VW_AGENDAMENTOS_SIMULADOS GROUP BY 1"
            )
        ] == [("2026-10", 10), ("2026-11", 10), ("2026-12", 10)]
        with pytest.raises(sqlite3.OperationalError):
            connection.execute("DELETE FROM atendimentos")
    other = Unit.objects.create(slug="other", name="Other")
    assert SQLiteSource(other, path).batches() == []
    assert not isinstance(appointment_source(other), SQLiteSource)
    for kind in ["exam", "lab"]:
        rule = setup["rule"]
        type(rule).objects.create(
            unit=setup["unit"],
            code=kind,
            name=kind,
            kind=kind,
            days_before=7,
            send_time=rule.send_time,
            template=setup["template"],
        )
    assert import_simulated(setup["unit"])["imported"] == 30
    count = Message.objects.count()
    assert import_simulated(setup["unit"])["imported"] == 30
    assert Appointment.objects.filter(source="sqlite_simulated").count() == 30
    assert Message.objects.count() == count == 37
    assert sum(len(a.phone_numbers) == 2 for a in Appointment.objects.filter(source="sqlite_simulated")) == 6


def test_manual_release_idempotent_scoped_and_delay(setup):
    s = setup
    second = upsert_appointment(s["unit"], replace(s["row"], external_id="SECOND", phone="5511999990002"))
    queue_appointment(second, s["rule"], s["now"], s["now"])
    later = upsert_appointment(
        s["unit"],
        replace(s["row"], external_id="LATER", scheduled_at=s["row"].scheduled_at + timedelta(days=1)),
    )
    untouched = queue_appointment(later, s["rule"], s["now"], s["now"])
    s["unit"].paused = True
    s["unit"].save()
    s["rule"].enabled = False
    s["rule"].save()
    s["template"].approved_for_test = False
    s["template"].save()
    key = str(uuid4())
    result = release(s, key=key)
    assert result.status_code == 200, result.data
    assert release(s, key=key).data == result.data
    assert release(s).status_code == 409
    untouched.refresh_from_db()
    assert "manual_group_simulation" not in untouched.snapshot
    dispatch_manual_due()
    assert Message.objects.filter(group=s["message"].group, state="accepted").count() == 1
    dispatch_manual_due()
    assert Attempt.objects.count() == 1
    queued = Message.objects.get(group=s["message"].group, state="queued")
    dispatch(queued.pk, now=queued.group.next_send_at + timedelta(seconds=1))
    assert Attempt.objects.count() == 2
    assert Message.objects.filter(group=s["message"].group, provider_id__startswith="sim.").count() == 2
    s["unit"].refresh_from_db()
    s["rule"].refresh_from_db()
    assert s["unit"].paused and not s["rule"].enabled


def test_real_and_non_simulated_dispatch_blocked(setup, settings):
    s = setup
    s["appointment"].synthetic = False
    s["appointment"].source = "oracle"
    s["appointment"].save()
    assert release(s).status_code == 400
    s["message"].refresh_from_db()
    assert not s["message"].snapshot.get("manual_group_simulation")
    settings.SEND_MODE = "meta_test"
    assert release(s).status_code == 400
    assert Attempt.objects.count() == 0


def test_manual_cannot_use_external_transport_or_ignore_opt_out(setup):
    from messaging.transports import MetaTransport
    from operations.models import Contact

    s = setup
    assert release(s).status_code == 200
    with pytest.raises(ValueError, match="simulation_transport_required"):
        dispatch(s["message"].pk, transport=MetaTransport())
    assert Attempt.objects.count() == 0
    Contact.objects.filter(event=s["message"].case.event, phone=s["message"].recipient).update(opted_out=True)
    s["message"].refresh_from_db()
    assert send_guard(s["message"]) == "contact_opted_out"


def test_release_permissions_and_pending_only(setup):
    s = setup
    Membership.objects.filter(user=s["user"]).update(role="viewer")
    assert release(s).status_code == 403
    Membership.objects.filter(user=s["user"]).update(role="admin")
    s["message"].state = "uncertain"
    s["message"].save()
    assert release(s).status_code == 400
