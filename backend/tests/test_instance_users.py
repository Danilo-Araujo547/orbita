from uuid import uuid4

import pytest
from core.models import Membership, Unit
from django.contrib.auth import get_user_model
from django.utils import timezone
from messaging.models import Message
from operations.models import ReportAccess


def post(setup, path, data):
    return setup["client"].post(
        f"/api/v1/{path}/?unit=ame", data, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4())
    )


@pytest.mark.django_db
def test_instance_user_selected_tabs_read_only_and_unit_revocation(setup):
    other = Unit.objects.create(slug="second", name="Second")
    Membership.objects.create(unit=other, user=setup["user"], role="admin")
    body = {
        "version": 0,
        "username": "restricted",
        "password": "Different-test-password-2026!",
        "grants": [
            {"unit": "ame", "role": "operator", "permissions": {"appointments": "write", "groups": "read"}},
            {"unit": "second", "role": "viewer", "permissions": {"appointments": "read"}},
        ],
    }
    result = post(setup, "users", body)
    assert result.status_code == 200, result.data
    user = get_user_model().objects.get(username="restricted")
    setup["client"].force_authenticate(user)
    session = setup["client"].get("/api/v1/auth/session/").data
    assert set(u["slug"] for u in session["units"]) == {"ame", "second"}
    assert session["permissions"]["ame"]["appointments"] == "write"
    assert session["permissions"]["ame"]["messages"] == "none"
    assert setup["client"].get("/api/v1/messages/?unit=ame").status_code == 403
    assert setup["client"].get("/api/v1/appointments/?unit=ame").status_code == 200
    assert (
        setup["client"]
        .post(f"/api/v1/appointment-groups/{setup['message'].group_id}/schedule/?unit=ame", {}, format="json")
        .status_code
        == 403
    )
    setup["client"].force_authenticate(setup["user"])
    result = post(setup, f"users/{user.pk}/configure", {"version": 1, "grants": []})
    assert result.status_code == 200, result.data
    setup["client"].force_authenticate(user)
    assert setup["client"].get("/api/v1/auth/session/").data["units"] == []
    assert setup["client"].get("/api/v1/appointments/?unit=ame").status_code == 403


@pytest.mark.django_db
def test_unit_configuration_version_and_other_unit_protection(setup):
    unit = setup["unit"]
    result = post(
        setup,
        f"units/{unit.pk}/configure",
        {"version": 1, "name": "Edited", "timezone": "America/Sao_Paulo", "response_hours": 48},
    )
    assert result.status_code == 200, result.data
    assert result.data["name"] == "Edited" and result.data["version"] == 2
    assert post(setup, f"units/{unit.pk}/configure", {"version": 1, "name": "Stale"}).status_code == 409
    other = Unit.objects.create(slug="private", name="Private")
    assert post(setup, f"units/{other.pk}/configure", {"version": 1, "name": "Denied"}).status_code == 404


@pytest.mark.django_db
def test_recipient_edit_resets_verification_and_preserves_history(setup):
    access = ReportAccess.objects.create(
        unit=setup["unit"], user=setup["user"], phone="5511999990001", verified_at=timezone.now()
    )
    count = Message.objects.count()
    result = post(
        setup,
        f"report-access/{access.pk}/configure",
        {"version": 1, "phone": "5511999990002", "active": False},
    )
    assert result.status_code == 200, result.data
    access.refresh_from_db()
    assert access.verified_at is None and not access.active and access.version == 2
    assert Message.objects.count() == count


@pytest.mark.django_db
def test_operator_cannot_escalate_or_create_users(setup):
    Membership.objects.filter(user=setup["user"]).update(role="operator")
    assert post(setup, "users", {"version": 0, "grants": []}).status_code == 403
    assert setup["client"].get("/api/v1/users/options/?unit=ame").status_code == 403


@pytest.mark.django_db
def test_user_manager_cannot_delegate_sections_outside_own_permissions(setup):
    Membership.objects.filter(user=setup["user"]).update(permissions={"settings": "none", "users": "write"})
    result = post(
        setup,
        "users",
        {
            "version": 0,
            "username": "escalation",
            "password": "Safe-test-password-2026!",
            "grants": [{"unit": "ame", "role": "admin", "permissions": {"settings": "write"}}],
        },
    )
    assert result.status_code == 400
    assert not get_user_model().objects.filter(username="escalation").exists()


@pytest.mark.django_db
def test_authorized_test_recipients_edit_and_empty_list_revokes(setup, settings):
    from messaging.pilot import authorized_recipients

    settings.TEST_RECIPIENTS = ("5511999990001",)
    unit = setup["unit"]
    assert authorized_recipients(unit) == settings.TEST_RECIPIENTS
    result = post(
        setup,
        f"units/{unit.pk}/configure",
        {"version": 1, "authorized_recipients": ["(17) 99999-0001", "5517999990001"]},
    )
    assert result.status_code == 200, result.data
    unit.refresh_from_db()
    assert authorized_recipients(unit) == ("5517999990001",)
    assert (
        post(
            setup, f"units/{unit.pk}/configure", {"version": 2, "authorized_recipients": ["invalid"]}
        ).status_code
        == 400
    )
    assert (
        post(setup, f"units/{unit.pk}/configure", {"version": 2, "authorized_recipients": []}).status_code
        == 200
    )
    unit.refresh_from_db()
    assert authorized_recipients(unit) == ()
