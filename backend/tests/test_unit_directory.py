import pytest
from core.models import Audit, Membership, Unit


@pytest.mark.django_db(transaction=True)
def test_unit_creation_is_atomic_and_idempotent(setup):
    client = setup["client"]
    body = {"slug": "new-unit", "name": "Nova unidade", "timezone": "America/Sao_Paulo"}
    for _ in range(2):
        result = client.post("/api/v1/units/?unit=ame", body, format="json", HTTP_IDEMPOTENCY_KEY="new-unit-directory")
        assert result.status_code == 200, result.data
    created = Unit.objects.get(slug="new-unit")
    assert created.paused
    assert Membership.objects.filter(unit=created, user=setup["user"], role="admin").exists()
    assert Audit.objects.filter(action="unit.created", object_id=str(created.pk)).count() == 1
    listed = client.get("/api/v1/units/?unit=ame").json()
    assert {row["slug"] for row in listed["results"]} == {"ame", "new-unit"}


def test_directory_respects_permissions_and_unit_scope(setup):
    Unit.objects.create(slug="private", name="Private")
    member = Membership.objects.get(user=setup["user"], unit=setup["unit"])
    member.permissions = {"settings": "write", "operationsAdmin": "none", "users": "none"}
    member.save()
    result = setup["client"].get("/api/v1/units/?unit=ame")
    assert result.status_code == 200
    assert [row["slug"] for row in result.json()["results"]] == ["ame"]
    member.role = "viewer"
    member.save()
    result = setup["client"].post("/api/v1/units/?unit=ame", {"slug": "denied", "name": "Denied"}, format="json", HTTP_IDEMPOTENCY_KEY="denied-unit-directory")
    assert result.status_code == 403
    assert not Unit.objects.filter(slug="denied").exists()
