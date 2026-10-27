import json
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.utils import timezone

from core.models import Membership, Unit
from messaging.meta_config import MetaReadError
from messaging.models import Message, MetaConfiguration

pytestmark = pytest.mark.django_db
PHONE = "5511999990001"


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    cache.clear()

    def denied(*args, **kwargs):
        pytest.fail("Cost tests must never contact Meta or send messages")

    monkeypatch.setattr("requests.get", denied)
    monkeypatch.setattr("messaging.transports.MetaTransport.send", denied)
    yield
    cache.clear()


def fixture(setup, monkeypatch, points=None):
    unit = setup["unit"]
    day = timezone.now().astimezone(ZoneInfo(unit.timezone)).date() - timedelta(days=1)
    stamp = int(
        datetime.combine(day, time.min, tzinfo=ZoneInfo(unit.timezone)).timestamp()
    )
    if points is None:
        points = [
            {
                "start": stamp,
                "end": stamp + 86400,
                "phone_number": PHONE,
                "pricing_category": "UTILITY",
                "pricing_type": "REGULAR",
                "volume": 2,
                "cost": 0.1,
            },
            {
                "start": stamp,
                "end": stamp + 86400,
                "phone_number": PHONE,
                "pricing_category": "MARKETING",
                "pricing_type": "REGULAR",
                "volume": 1,
                "cost": 0.2,
            },
            {
                "start": stamp,
                "end": stamp + 86400,
                "phone_number": PHONE,
                "pricing_category": "SERVICE",
                "pricing_type": "FREE_CUSTOMER_SERVICE",
                "volume": 4,
                "cost": 0,
            },
        ]
    config = MetaConfiguration.objects.create(
        unit=unit,
        waba_id="111",
        phone_number_id="222",
        token_ciphertext="encrypted-not-a-real-token",
    )
    calls = []

    class Reader:
        def __init__(self, config):
            self.config = config

        def get(self, path, **params):
            calls.append((self.config.unit_id, path, params))
            if params.get("fields") == "currency":
                return {"currency": "BRL"}
            if params.get("fields") == "display_phone_number":
                return {"display_phone_number": "+55 11 99999-0001"}
            return {"data": [{"data_points": points}]}

    monkeypatch.setattr("messaging.costs.MetaReader", Reader)
    url = f"/api/v1/meta-costs/?unit=ame&start={day}&end={day}"
    return config, calls, url, points


def test_exact_costs_include_free_volume_and_cache(setup, monkeypatch):
    config, calls, url, _points = fixture(setup, monkeypatch)
    before = Message.objects.count()
    response = setup["client"].get(url)
    assert response.status_code == 200, response.data
    assert response.data["status"] == "available"
    assert response.data["currency"] == "BRL" and response.data["total_cost"] == "0.3"
    assert response.data["total_volume"] == 7 and len(response.data["rows"]) == 3
    params = calls[-1][2]
    assert json.loads(params["phone_numbers"]) == [PHONE]
    assert json.loads(params["dimensions"]) == [
        "PHONE",
        "PRICING_CATEGORY",
        "PRICING_TYPE",
    ]
    assert setup["client"].get(url).data == response.data and len(calls) == 3
    setup["client"].get(url + "&refresh=true")
    assert len(calls) == 6
    config.version += 1
    config.save()
    setup["client"].get(url)
    assert len(calls) == 9
    assert Message.objects.count() == before
    assert "token" not in json.dumps(response.data)


@pytest.mark.parametrize("problem", ["foreign_phone", "missing_cost", "not_finite"])
def test_unusable_data_never_displays_zero_cost(setup, monkeypatch, problem):
    _config, _calls, url, points = fixture(setup, monkeypatch)
    if problem == "foreign_phone":
        points[0]["phone_number"] = "5511999999999"
    elif problem == "missing_cost":
        points[0].pop("cost")
    else:
        points[0]["cost"] = "NaN"
    response = setup["client"].get(url)
    assert response.data["status"] == "unavailable"
    assert response.data["total_cost"] is None and response.data["total_volume"] is None
    assert not response.data["rows"]


def test_permissions_unit_isolation_and_no_config(setup, monkeypatch):
    _config, calls, url, _ = fixture(setup, monkeypatch)
    other = Unit.objects.create(slug="other", name="Outra")
    assert setup["client"].get(url.replace("unit=ame", "unit=other")).status_code == 403
    assert not calls
    member = Membership.objects.get(user=setup["user"], unit=setup["unit"])
    member.role = "operator"
    member.save()
    assert setup["client"].get(url).status_code == 403
    member.permissions = {"costs": "read"}
    member.save()
    assert setup["client"].get(url).status_code == 200
    assert setup["client"].post(url, {}, format="json").status_code == 403
    Membership.objects.create(user=setup["user"], unit=other, role="admin")
    empty = setup["client"].get(url.replace("unit=ame", "unit=other"))
    assert empty.data["status"] == "not_configured" and empty.data["total_cost"] is None


def test_range_validation_and_provider_permission_error(setup, monkeypatch):
    _, calls, url, _ = fixture(setup, monkeypatch)
    assert (
        setup["client"]
        .get("/api/v1/meta-costs/?unit=ame&start=2026-01-01&end=2026-10-20")
        .status_code
        == 400
    )
    assert (
        setup["client"]
        .get("/api/v1/meta-costs/?unit=ame&start=invalid&end=2026-10-20")
        .status_code
        == 400
    )
    assert not calls

    class Denied:
        def __init__(self, config):
            raise MetaReadError("meta_200")

    monkeypatch.setattr("messaging.costs.MetaReader", Denied)
    response = setup["client"].get(url)
    assert (
        response.data["status"] == "unavailable" and response.data["code"] == "meta_200"
    )
    assert response.data["total_cost"] is None


def test_empty_result_is_a_real_zero(setup, monkeypatch):
    _, _calls, url, _ = fixture(setup, monkeypatch, points=[])
    response = setup["client"].get(url)
    assert response.data["status"] == "available"
    assert response.data["total_cost"] == "0" and response.data["total_volume"] == 0


def test_phone_scoped_pagination_never_follows_provider_url(setup, monkeypatch):
    _config, calls, url, points = fixture(setup, monkeypatch)

    class Reader:
        def __init__(self, config):
            pass

        def get(self, path, **params):
            if params.get("fields") == "currency":
                return {"currency": "BRL"}
            if params.get("fields") == "display_phone_number":
                return {"display_phone_number": PHONE}
            calls.append((path, params))
            assert path == "111/pricing_analytics"
            assert json.loads(params["phone_numbers"]) == [PHONE]
            if "after" not in params:
                return {
                    "data": [{"data_points": points[:1]}],
                    "paging": {
                        "next": "https://invalid.test/?access_token=never-use",
                        "cursors": {"after": "second"},
                    },
                }
            return {"data": [{"data_points": points[1:]}]}

    monkeypatch.setattr("messaging.costs.MetaReader", Reader)
    response = setup["client"].get(url)
    assert response.data["total_cost"] == "0.3" and response.data["total_volume"] == 7
    assert len(calls) == 2


def test_restricted_admin_requires_explicit_cost_grant(setup, monkeypatch):
    _, calls, url, _ = fixture(setup, monkeypatch)
    member = Membership.objects.get(user=setup["user"], unit=setup["unit"])
    member.permissions = {"appointments": "write", "settings": "none"}
    member.save()
    assert setup["client"].get(url).status_code == 403
    assert not calls
    member.permissions["costs"] = "read"
    member.save()
    assert setup["client"].get(url).status_code == 200
