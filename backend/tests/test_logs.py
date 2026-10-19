import pytest
from core.models import Audit, Membership, Unit
from django.utils import timezone
from messaging.models import Attempt, ProviderEvent
from scheduling.models import ImportRun


@pytest.mark.django_db
def test_logs_union_filters_and_safe_projection(setup):
    unit, client = setup["unit"], setup["client"]
    Audit.objects.create(
        unit=unit, actor=setup["user"], action="meta.configured", details={"token": "SECRET-DO-NOT-RETURN"}
    )
    ImportRun.objects.create(
        unit=unit,
        rule=setup["rule"],
        run_date=timezone.localdate(),
        status="failed",
        error="source_unavailable",
    )
    Attempt.objects.create(message=setup["message"], number=1, outcome="failed", error_code="transport_error")
    setup["message"].provider_id = "provider-1"
    setup["message"].save()
    ProviderEvent.objects.create(
        key="a" * 64,
        channel_id=setup["message"].channel_id,
        provider_id="provider-1",
        event_type="delivered",
        occurred_at=timezone.now(),
        data={"secret": "SECRET-DO-NOT-RETURN"},
    )
    ProviderEvent.objects.create(
        key="b" * 64,
        channel_id="wrong-channel",
        provider_id="provider-1",
        event_type="read",
        occurred_at=timezone.now(),
    )
    other = Unit.objects.create(slug="other", name="Other")
    Audit.objects.create(unit=other, action="not-visible")
    response = client.get("/api/v1/logs/?unit=ame")
    assert response.status_code == 200, response.data
    assert {row["category"] for row in response.data["results"]} >= {
        "audit",
        "imports",
        "attempts",
        "messages",
        "events",
    }
    assert "SECRET-DO-NOT-RETURN" not in str(response.data)
    assert "not-visible" not in str(response.data)
    events = client.get("/api/v1/logs/?unit=ame&category=events").data
    assert events["count"] == 1
    assert events["results"][0]["status"] == "delivered"
    filtered = client.get(
        "/api/v1/logs/?unit=ame&category=attempts&status=failed&search=transport_error"
    ).data
    assert filtered["count"] == 1
    assert client.get("/api/v1/logs/?unit=ame&start=bad").status_code == 400
    assert client.get("/api/v1/logs/?unit=ame&start=2026-10-02&end=2026-10-01").status_code == 400
    assert client.get("/api/v1/logs/?unit=ame&category=invalid").status_code == 400
    assert client.post("/api/v1/logs/?unit=ame", {}).status_code == 405


@pytest.mark.django_db
def test_logs_permission_pagination_and_date_boundaries(setup):
    client = setup["client"]
    for i in range(55):
        Audit.objects.create(unit=setup["unit"], action=f"action-{i}")
    first = client.get("/api/v1/logs/?unit=ame&category=audit").data
    assert first["count"] == 55 and len(first["results"]) == 50 and first["next"]
    second = client.get("/api/v1/logs/?unit=ame&category=audit&page=2").data
    assert len(second["results"]) == 5
    assert not ({r["id"] for r in first["results"]} & {r["id"] for r in second["results"]})
    assert client.get("/api/v1/logs/?unit=ame&end=2000-01-01").data["count"] == 0
    member = Membership.objects.get(unit=setup["unit"], user=setup["user"])
    member.permissions = {"settings": "none"}
    member.save()
    assert client.get("/api/v1/logs/?unit=ame").status_code == 403
    assert client.get("/api/v1/logs/?unit=unknown").status_code == 400
