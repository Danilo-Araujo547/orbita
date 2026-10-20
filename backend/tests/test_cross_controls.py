import csv
import io
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from django.db import close_old_connections, connections
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.models import Membership, Unit
from messaging.models import Attempt, Message, Template
from messaging.services import dispatch, send_guard
from messaging.transports import SimulatedTransport
from operations.cross_controls import (
    batch_rows,
    batch_status,
    set_batch_enabled,
    set_records_enabled,
)
from operations.models import Campaign, ImportLayout, SheetImport
from operations.services import Conflict
from operations.sheets import preview_sheet
from operations.standardization import STANDARD_FIELDS


@pytest.fixture(autouse=True)
def no_real_sends(monkeypatch):
    def denied(*args, **kwargs):
        pytest.fail("External network access is forbidden in CROSS control tests")

    monkeypatch.setattr("requests.sessions.Session.request", denied)
    monkeypatch.setattr("messaging.transports.MetaTransport.send", denied)


def sample(setup, name="Lista CROSS", code="001", phones=True, two=False):
    template = Template.objects.create(
        unit=setup["unit"],
        name="cross_" + uuid4().hex[:8],
        purpose="waitlist",
        body="Olá {{1}} · {{2}}",
        fields=["nome_completo", "tipo"],
        approved_for_test=True,
    )
    layout = ImportLayout.objects.create(
        unit=setup["unit"],
        name=name,
        verified=True,
        default_template=template,
        parameter_fields=["nome_completo", "tipo"],
        mapping={
            "external_id": "codigo",
            "patient": "nome_completo",
            "phone": "celular",
            "occurred_at": "data",
        },
    )
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=STANDARD_FIELDS, delimiter=";")
    writer.writeheader()
    row = {
        "codigo": code,
        "nome_completo": "PACIENTE FICTÍCIO",
        "data": "22/10/2026",
        "hora": "10:30",
        "celular": "11999990001",
        "celular2": "11999990002" if phones else "",
        "tipo": "PROCEDIMENTO TESTE",
    }
    writer.writerow(row)
    if two:
        writer.writerow(
            {**row, "codigo": "002", "nome_completo": "OUTRO PACIENTE FICTÍCIO"}
        )
    batch = preview_sheet(
        setup["unit"], layout, setup["user"], "teste.csv", output.getvalue().encode()
    )
    assert not batch.errors
    return batch


def messages(batch):
    return Message.objects.filter(snapshot__import_batch=str(batch.pk))


def activate(batch, setup, enabled=True, now=None):
    batch.refresh_from_db()
    return set_batch_enabled(batch, enabled, batch.version, setup["user"], now=now)


def record_switch(batch, setup, ids, enabled):
    batch.refresh_from_db()
    return set_records_enabled(batch, ids, enabled, batch.version, setup["user"])


@pytest.mark.django_db
def test_disabled_default_and_activation_queues_once_after_30_minutes(setup):
    batch = sample(setup)
    assert not batch_status(batch)["enabled"] and not messages(batch).exists()
    now = timezone.now()
    batch = activate(batch, setup, now=now)
    campaign = Campaign.objects.get(import_batch=batch)
    assert campaign.sends_enabled and campaign.scheduled_for == now + timedelta(
        minutes=30
    )
    assert campaign.cases.count() == 1 and messages(batch).count() == 2
    assert set(messages(batch).values_list("state", flat=True)) == {"queued"}
    assert all(m.scheduled_for == campaign.scheduled_for for m in messages(batch))
    assert not Attempt.objects.filter(message__in=messages(batch)).exists()
    activate(batch, setup, now=now + timedelta(minutes=1))
    assert messages(batch).count() == 2
    campaign.refresh_from_db()
    assert campaign.scheduled_for == now + timedelta(minutes=30)
    message = messages(batch).first()
    dispatch(message.pk, SimulatedTransport(), now=now)
    message.refresh_from_db()
    assert message.state == "queued" and message.attempt_count == 0


@pytest.mark.django_db
def test_disable_record_cancels_all_numbers_and_reactivation_preserves_sent(setup):
    batch = sample(setup, two=True)
    batch = activate(batch, setup)
    batch = record_switch(batch, setup, ["001"], False)
    assert set(
        messages(batch)
        .filter(case__event__external_id="001")
        .values_list("state", flat=True)
    ) == {"cancelled"}
    assert (
        messages(batch).filter(case__event__external_id="002", state="queued").count()
        == 2
    )
    batch = record_switch(batch, setup, ["001"], True)
    sent = messages(batch).filter(case__event__external_id="001").first()
    sent.state, sent.attempt_count, sent.provider_id = "delivered", 1, "wamid.history"
    sent.save()
    batch = activate(batch, setup, False)
    assert messages(batch).exclude(pk=sent.pk).filter(state="queued").count() == 0
    batch = activate(batch, setup)
    sent.refresh_from_db()
    assert sent.state == "delivered" and sent.attempt_count == 1
    assert (
        messages(batch).count() == 4
        and messages(batch).filter(state="queued").count() == 3
    )


@pytest.mark.django_db
def test_record_can_be_disabled_before_activation_and_no_duplicate_patient(setup):
    batch = sample(setup, two=True)
    batch = record_switch(batch, setup, ["001"], False)
    assert not messages(batch).exists()
    batch = activate(batch, setup)
    campaign = Campaign.objects.get(import_batch=batch)
    assert campaign.cases.count() == 2
    assert messages(batch).filter(state="queued").count() == 2
    assert batch_status(batch)["enabled_count"] == 1
    assert not batch_rows(batch)[0]["enabled"]


@pytest.mark.django_db
def test_pause_guard_and_no_automatic_resend_of_failures_or_uncertain_results(setup):
    batch = activate(sample(setup, two=True), setup)
    rows = list(messages(batch))
    for message, state in zip(rows, ["accepted", "failed", "uncertain", "sending"]):
        message.state, message.attempt_count = state, 1
        message.save()
    batch = activate(batch, setup, False)
    assert send_guard(rows[0]) == "cross_import_disabled"
    batch = activate(batch, setup)
    assert sorted(messages(batch).values_list("state", flat=True)) == [
        "accepted",
        "failed",
        "sending",
        "uncertain",
    ]
    setup["unit"].paused = True
    setup["unit"].save()
    batch.refresh_from_db()
    assert batch_status(batch)["unit_paused"]


@pytest.mark.django_db
def test_recent_warning_is_same_unit_category_identity_and_actual_api_send(setup):
    original = activate(sample(setup), setup)
    stamp = timezone.now() - timedelta(days=2)
    m = messages(original).first()
    m.state, m.provider_id, m.last_attempt_at, m.channel_id = (
        "sent",
        "wamid.recent",
        stamp,
        "meta",
    )
    m.save()
    # A newer layout revision/category with the same record still sees the history.
    revision = activate(sample(setup), setup)
    row = batch_rows(revision)[0]
    assert row["recent_send_count"] == 1 and row["last_sent_at"] == stamp.isoformat()
    assert (
        batch_rows(sample(setup, name="Outra categoria"))[0]["recent_send_count"] == 0
    )
    # Same telephone and name never establishes identity for another record.
    assert batch_rows(sample(setup, code="OTHER"))[0]["recent_send_count"] == 0
    m.last_attempt_at = timezone.now() - timedelta(days=31)
    m.delivered_at = timezone.now()
    m.save()
    assert batch_rows(revision)[0]["recent_send_count"] == 0
    for state, provider in [
        ("failed", "wamid.failed"),
        ("uncertain", "wamid.uncertain"),
        ("accepted", "sim.example"),
        ("queued", "wamid.not_sent"),
    ]:
        m.state, m.provider_id, m.last_attempt_at = state, provider, stamp
        m.save()
        assert batch_rows(revision)[0]["recent_send_count"] == 0


@pytest.mark.django_db
def test_api_permissions_conflicts_idempotency_filters_and_legacy_bypass(setup):
    batch = sample(setup)
    client = setup["client"]
    url = f"/api/v1/sheet-imports/{batch.pk}/activation/?unit=ame"
    data = {"version": batch.version, "enabled": True}
    first = client.post(
        url, data, format="json", HTTP_IDEMPOTENCY_KEY="cross-activate-01"
    )
    assert first.status_code == 200, first.data
    duplicate = client.post(
        url, data, format="json", HTTP_IDEMPOTENCY_KEY="cross-activate-01"
    )
    assert duplicate.data == first.data
    stale = client.post(
        url,
        {**data, "enabled": False},
        format="json",
        HTTP_IDEMPOTENCY_KEY="cross-stale-01",
    )
    assert stale.status_code == 409
    batch.refresh_from_db()
    invalid = client.post(
        f"/api/v1/sheet-imports/{batch.pk}/record-activation/?unit=ame",
        {"version": batch.version, "enabled": False, "records": ["FOREIGN"]},
        format="json",
        HTTP_IDEMPOTENCY_KEY="cross-foreign-record",
    )
    assert invalid.status_code == 400
    records = client.get(
        f"/api/v1/sheet-imports/{batch.pk}/records/?unit=ame&search=FICTÍCIO"
    )
    assert records.status_code == 200 and records.data["count"] == 1
    assert (
        client.get(
            f"/api/v1/sheet-imports/{batch.pk}/records/?unit=ame&recent_only=true"
        ).data["count"]
        == 0
    )
    campaign = Campaign.objects.get(import_batch=batch)
    for action in ["sending", "release"]:
        response = client.post(
            f"/api/v1/campaigns/{campaign.pk}/{action}/?unit=ame",
            {"version": campaign.version, "enabled": True},
            format="json",
            HTTP_IDEMPOTENCY_KEY=f"cross-bypass-{action}",
        )
        assert response.status_code == 400
    member = Membership.objects.get(user=setup["user"], unit=setup["unit"])
    member.role = "viewer"
    member.save()
    denied = client.post(
        url,
        {"version": batch.version, "enabled": False},
        format="json",
        HTTP_IDEMPOTENCY_KEY="cross-viewer-denied",
    )
    assert denied.status_code == 403
    Unit.objects.create(slug="other", name="Other")
    assert client.get(
        f"/api/v1/sheet-imports/{batch.pk}/records/?unit=other"
    ).status_code in [403, 404]


@pytest.mark.django_db
def test_validation_empty_selection_no_template_and_changed_template(setup):
    batch = sample(setup)
    with pytest.raises(ValidationError):
        set_records_enabled(batch, [], False, batch.version, setup["user"])
    batch = record_switch(batch, setup, ["001"], False)
    with pytest.raises(ValidationError):
        activate(batch, setup)
    batch = record_switch(batch, setup, ["001"], True)
    batch = activate(batch, setup)
    message = messages(batch).first()
    batch.template.version += 1
    batch.template.save()
    message.template.refresh_from_db()
    assert send_guard(message) == "cross_template_changed"


@pytest.mark.django_db(transaction=True)
def test_two_operators_cannot_overwrite_activation(setup):
    batch = sample(setup)
    batch_id, version, user = batch.pk, batch.version, setup["user"]

    def change(_):
        close_old_connections()
        try:
            b = SheetImport.objects.get(pk=batch_id)
            try:
                set_batch_enabled(b, True, version, user)
                return "ok"
            except Conflict:
                return "conflict"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, range(2)))
    assert sorted(results) == ["conflict", "ok"]
    assert messages(batch).count() == 2


@pytest.mark.django_db
def test_record_disable_is_checked_before_worker_claim_and_does_not_send(setup):
    batch = activate(
        sample(setup, phones=False), setup, now=timezone.now() - timedelta(hours=1)
    )
    message = messages(batch).first()
    batch = record_switch(batch, setup, ["001"], False)
    assert send_guard(message) == "cross_record_disabled"
    dispatch(message.pk, SimulatedTransport())
    message.refresh_from_db()
    assert message.attempt_count == 0 and message.state == "cancelled"


@pytest.mark.django_db
def test_real_transport_guard_keeps_unit_allowlist_and_requires_approved_catalog(
    setup, settings
):
    from messaging.models import MetaConfiguration
    from operations.cross_controls import transport_guard

    batch = activate(sample(setup), setup)
    message = messages(batch).get(recipient="5511999990001")
    settings.SEND_MODE, settings.META_REAL_ENABLED, settings.META_UNIT_SLUG = (
        "meta_test",
        True,
        "ame",
    )
    message.snapshot["components"] = [{"type": "BODY", "text": message.template.body}]
    message.save(update_fields=["snapshot"])
    assert transport_guard(message) == "meta_not_validated"
    config = MetaConfiguration.objects.create(
        unit=setup["unit"],
        validation_state="valid",
        checked_at=timezone.now(),
        templates=[
            {
                "name": message.template_name,
                "language": "pt_BR",
                "status": "APPROVED",
                "components": [{"type": "BODY", "text": message.template.body}],
            }
        ],
    )
    assert transport_guard(message) == ""
    other = messages(batch).get(recipient="5511999990002")
    assert transport_guard(other) == "recipient_not_allowed"
    config.templates[0]["status"] = "REJECTED"
    config.save()
    assert transport_guard(message) == "cross_template_not_validated"


@pytest.mark.django_db
def test_paused_unit_keeps_cross_queue_untouched_even_without_meta_configuration(
    setup, settings
):
    batch = activate(
        sample(setup, phones=False), setup, now=timezone.now() - timedelta(hours=1)
    )
    setup["unit"].paused = True
    setup["unit"].save()
    message = messages(batch).first()
    message.unit.refresh_from_db()
    settings.SEND_MODE = "meta_test"
    assert send_guard(message) == "paused"


@pytest.mark.django_db
def test_disabling_patient_cancels_a_known_retry_without_erasing_attempts(setup):
    batch = activate(sample(setup, phones=False), setup)
    message = messages(batch).first()
    message.attempt_count = 1
    message.save()
    Attempt.objects.create(
        message=message, number=1, outcome="failed", error_code="transient_test"
    )
    record_switch(batch, setup, ["001"], False)
    message.refresh_from_db()
    assert message.state == "cancelled"
    assert message.attempt_count == 1 and message.attempts.count() == 1


@pytest.mark.django_db
def test_preexisting_cross_history_without_batch_snapshot_is_highlighted(setup):
    original = activate(sample(setup), setup)
    message = messages(original).first()
    message.snapshot.pop("import_batch")
    message.state, message.provider_id, message.last_attempt_at = (
        "sent",
        "wamid.legacy-history",
        timezone.now() - timedelta(days=1),
    )
    message.save()
    revision = sample(setup)
    assert batch_rows(revision)[0]["recent_send_count"] == 1


@pytest.mark.django_db
def test_worker_selects_only_activated_due_cross_queue_in_meta_test_mode(
    setup, settings, monkeypatch
):
    from messaging.tasks import dispatch_manual_due

    due = activate(
        sample(setup, phones=False), setup, now=timezone.now() - timedelta(hours=1)
    )
    activate(
        sample(setup, phones=False), setup
    )  # Future schedule must remain untouched.
    settings.SEND_MODE = "meta_test"
    settings.META_REAL_ENABLED = True
    claimed = []
    monkeypatch.setattr(
        "messaging.tasks.dispatch", lambda message_id: claimed.append(message_id)
    )
    dispatch_manual_due()
    assert set(claimed) == set(messages(due).values_list("pk", flat=True))
    claimed.clear()
    activate(due, setup, enabled=False)
    dispatch_manual_due()
    assert not claimed
