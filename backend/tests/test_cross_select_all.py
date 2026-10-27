from uuid import uuid4

import pytest

from messaging.models import Message
from operations.models import SheetImport
from tests.test_cross_controls import sample

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def no_sends(monkeypatch):
    def denied(*args, **kwargs):
        pytest.fail("Bulk selection must not send messages")

    monkeypatch.setattr("requests.sessions.Session.request", denied)
    monkeypatch.setattr("messaging.transports.MetaTransport.send", denied)


def post(setup, batch, data):
    return setup["client"].post(
        f"/api/v1/sheet-imports/{batch.pk}/record-activation/?unit=ame",
        data,
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid4()),
    )


def test_all_pages_exclusions_and_stale_version(setup):
    batch = sample(setup)
    row = batch.rows[0]
    batch.rows = [{**row, "external_id": str(i)} for i in range(1105)]
    batch.save()
    initial = Message.objects.count()
    response = post(
        setup,
        batch,
        {
            "version": batch.version,
            "enabled": False,
            "all_matching": True,
            "excluded_records": ["1001"],
        },
    )
    assert response.status_code == 200, response.data
    batch.refresh_from_db()
    assert len(batch.disabled_records) == 1104 and "1001" not in batch.disabled_records
    assert "1104" in batch.disabled_records
    assert not response.data["control_status"]["enabled"]
    assert Message.objects.count() == initial
    stale = post(setup, batch, {"version": 1, "enabled": True, "all_matching": True})
    assert stale.status_code == 409
    assert (
        post(
            setup,
            batch,
            {
                "version": batch.version,
                "enabled": True,
                "records": ["1"],
                "all_matching": True,
            },
        ).status_code
        == 400
    )


def test_all_matching_respects_filters_and_rejects_unknown_exclusion(
    setup, monkeypatch
):
    batch = sample(setup)
    base = batch.rows[0]
    batch.rows = [{**base, "external_id": str(i)} for i in range(4)]
    batch.save()
    rows = [
        {
            "record_id": str(i),
            "nome_completo": "ALVO" if i < 3 else "OUTRO",
            "recent_send_count": 1 if i == 1 else 0,
            "enabled": True,
        }
        for i in range(4)
    ]
    monkeypatch.setattr(
        "operations.cross_controls.batch_rows", lambda *args, **kwargs: rows
    )
    response = post(
        setup,
        batch,
        {
            "version": batch.version,
            "enabled": False,
            "all_matching": True,
            "search": "alvo",
            "recent_only": True,
        },
    )
    assert response.status_code == 200, response.data
    batch.refresh_from_db()
    assert batch.disabled_records == ["1"]
    response = post(
        setup,
        batch,
        {
            "version": batch.version,
            "enabled": False,
            "all_matching": True,
            "search": "ALVO",
            "excluded_records": ["3"],
        },
    )
    assert response.status_code == 400
    assert (
        post(
            setup,
            batch,
            {
                "version": batch.version,
                "enabled": False,
                "all_matching": True,
                "search": "does not exist",
            },
        ).status_code
        == 400
    )


def test_bulk_scope_cannot_access_another_unit(setup):
    from core.models import Unit

    batch = sample(setup)
    foreign = Unit.objects.create(slug="foreign", name="Outra")
    SheetImport.objects.filter(pk=batch.pk).update(unit=foreign)
    response = post(
        setup, batch, {"version": batch.version, "enabled": False, "all_matching": True}
    )
    assert response.status_code == 404
