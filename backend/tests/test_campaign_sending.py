from uuid import uuid4

import pytest
from core.models import Membership
from messaging.models import Message
from operations.models import Campaign


def post(setup, campaign, action, data):
    return setup["client"].post(
        f"/api/v1/campaigns/{campaign.pk}/{action}/?unit=ame",
        data,
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid4()),
    )


@pytest.mark.django_db
def test_toggle_requires_admin_version_and_does_not_send(setup, monkeypatch):
    monkeypatch.setattr("messaging.pilot.configuration", lambda unit: object())
    monkeypatch.setattr("messaging.pilot.catalog_template", lambda config, name: ({}, "body"))
    template = setup["template"]
    template.name = "confirmacao_consulta_sqlite_v1"
    template.save()
    campaign = Campaign.objects.create(
        unit=setup["unit"],
        name="Test",
        purpose="absence",
        response_policy="confirmation_test",
        template=template,
    )
    count = Message.objects.count()
    result = post(setup, campaign, "sending", {"version": 1, "enabled": True})
    assert result.status_code == 200, result.data
    campaign.refresh_from_db()
    assert campaign.sends_enabled
    assert Message.objects.count() == count
    assert post(setup, campaign, "sending", {"version": 1, "enabled": False}).status_code == 409
    Membership.objects.filter(user=setup["user"]).update(role="operator")
    assert post(setup, campaign, "sending", {"version": 2, "enabled": False}).status_code == 403
    Membership.objects.filter(user=setup["user"]).update(role="admin")
    assert post(setup, campaign, "sending", {"version": 2, "enabled": False}).status_code == 200
    campaign.refresh_from_db()
    assert not campaign.sends_enabled


@pytest.mark.django_db
def test_worker_filters_disabled_campaign_and_guard_preserves_global_blocks(setup, settings, monkeypatch):
    from messaging.pilot import guard
    from messaging.tasks import dispatch_manual_due

    settings.SEND_MODE = "meta_test"
    settings.META_REAL_ENABLED = True
    settings.META_UNIT_SLUG = setup["unit"].slug
    campaign = Campaign.objects.create(unit=setup["unit"], name="Test", purpose="absence")
    message = setup["message"]
    message.snapshot.update(campaign=campaign.pk, manual_campaign_real=True)
    message.save()
    sent = []
    monkeypatch.setattr("messaging.tasks.dispatch", lambda pk: sent.append(pk))
    dispatch_manual_due()
    assert not sent
    assert guard(message) == "campaign_sending_disabled"
    campaign.sends_enabled = True
    campaign.save()
    dispatch_manual_due()
    assert sent == [message.pk]
    assert guard(message) == "campaign_not_authorized"


@pytest.mark.django_db
def test_release_requires_explicit_enable(setup):
    campaign = Campaign.objects.create(unit=setup["unit"], name="Test", purpose="absence")
    assert post(setup, campaign, "release", {"version": 1}).status_code == 400


@pytest.mark.django_db
def test_release_creates_only_campaign_messages_and_cannot_repeat(setup, monkeypatch):
    template = setup["template"]
    template.name = "confirmacao_consulta_sqlite_v1"
    template.fields = []
    template.save()
    case = setup["message"].case
    case.purpose = "absence"
    case.save()
    campaign = Campaign.objects.create(
        unit=setup["unit"],
        name="Test",
        purpose="absence",
        response_policy="confirmation_test",
        template=template,
        sends_enabled=True,
    )
    campaign.cases.add(case)
    monkeypatch.setattr("messaging.pilot.prepare", lambda message, name: None)
    result = post(setup, campaign, "release", {"version": 1})
    assert result.status_code == 200, result.data
    assert result.data["messages"] == 1
    outgoing = Message.objects.get(purpose="absence")
    assert outgoing.state == "queued"
    assert outgoing.snapshot["manual_campaign_real"]
    assert outgoing.snapshot["response_policy"] == "confirmation_test"
    assert outgoing.attempt_count == 0
    assert post(setup, campaign, "release", {"version": 2}).status_code == 400
