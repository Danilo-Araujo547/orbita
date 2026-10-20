from dataclasses import replace
from datetime import datetime, timedelta
from unittest.mock import Mock
from zoneinfo import ZoneInfo

import pytest
from django.core.management import call_command

from messaging.models import Message
from scheduling.models import Appointment, ImportRun, Rule
from scheduling.services import import_rule

pytestmark = pytest.mark.send_regression


@pytest.mark.django_db
@pytest.mark.parametrize("kind", ["consultation", "exam", "lab"])
def test_five_days_repeated_refresh_finds_new_rows_without_duplicate_messages(setup, kind):
    rule = setup["rule"]
    rule.days_before, rule.kind = 5, kind
    rule.save()
    now = datetime(2026, 10, 12, 8, tzinfo=ZoneInfo("America/Sao_Paulo"))
    data = replace(
        setup["row"],
        external_id="IMPORTED-1",
        kind=kind,
        source="oracle",
        synthetic=False,
        scheduled_at=now + timedelta(days=5),
    )
    source = Mock()
    source.fetch.return_value = [data]
    run = import_rule(rule, source, now, refresh=True)
    assert run.status == "completed"
    assert source.fetch.call_args.args == (kind, now.date() + timedelta(days=5), rule.unit.timezone)
    import_rule(rule, source, now + timedelta(minutes=4), refresh=True)
    assert source.fetch.call_count == 1
    source.fetch.return_value = [data, replace(data, external_id="IMPORTED-2")]
    import_rule(rule, source, now + timedelta(minutes=5), refresh=True)
    assert source.fetch.call_count == 2
    assert Appointment.objects.filter(source="oracle").count() == 2
    assert Message.objects.filter(appointment__source="oracle", state="preview").count() == 2
    assert ImportRun.objects.filter(rule=rule).count() == 1
    import_rule(rule, source, now + timedelta(minutes=10), refresh=True)
    assert Message.objects.filter(appointment__source="oracle").count() == 2


@pytest.mark.django_db
def test_running_import_is_not_started_again_and_failure_respects_interval(setup):
    rule = setup["rule"]
    now = datetime(2026, 10, 12, 8, tzinfo=ZoneInfo("America/Sao_Paulo"))
    run = ImportRun.objects.create(unit=rule.unit, rule=rule, run_date=now.date(), status="running")
    source = Mock()
    import_rule(rule, source, now, retry=True, refresh=True)
    source.fetch.assert_not_called()
    run.status, run.completed_at = "failed", now
    run.save()
    import_rule(rule, source, now + timedelta(minutes=4), retry=True, refresh=True)
    source.fetch.assert_not_called()
    source.fetch.return_value = []
    import_rule(rule, source, now + timedelta(minutes=5), retry=True, refresh=True)
    assert source.fetch.call_count == 1


@pytest.mark.django_db
def test_configuration_is_editable_and_validated_per_unit(setup):
    rule = setup["rule"]
    client = setup["client"]
    path = f"/api/v1/rules/{rule.pk}/configure/?unit=ame"
    response = client.post(
        path, {"version": rule.version, "days_before": 5, "refresh_interval_minutes": 10}, format="json"
    )
    assert response.status_code == 200
    assert response.data["days_before"] == 5 and response.data["refresh_interval_minutes"] == 10
    assert client.post(path, {"refresh_interval_minutes": 0}, format="json").status_code == 400
    assert client.post(path, {"refresh_interval_minutes": 1441}, format="json").status_code == 400


@pytest.mark.django_db
def test_configure_replaces_old_offsets_without_sending(setup):
    old = setup["rule"]
    before = Message.objects.filter(attempt_count__gt=0).count()
    call_command("configure_appointment_reminders", unit="ame", days=5, refresh_minutes=5)
    active = Rule.objects.filter(unit=old.unit, enabled=True)
    assert active.count() == 3
    assert set(active.values_list("days_before", flat=True)) == {5}
    assert all(r.weekdays == list(range(7)) for r in active)
    old.refresh_from_db()
    assert not old.enabled
    assert Message.objects.filter(attempt_count__gt=0).count() == before
    assert not Message.objects.filter(snapshot__manual_group_real=True).exists()


@pytest.mark.django_db
def test_changed_rule_during_fetch_does_not_form_stale_queue(setup):
    rule = setup["rule"]
    now = datetime(2026, 10, 12, 8, tzinfo=ZoneInfo("America/Sao_Paulo"))
    source = Mock()

    def fetch(*args):
        Rule.objects.filter(pk=rule.pk).update(version=rule.version + 1)
        return [
            replace(
                setup["row"],
                source="oracle",
                synthetic=False,
                scheduled_at=now + timedelta(days=rule.days_before),
            )
        ]

    source.fetch.side_effect = fetch
    assert import_rule(rule, source, now, refresh=True).status == "failed"
    assert not Appointment.objects.filter(source="oracle").exists()
