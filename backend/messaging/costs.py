"""Read-only, unit/phone-scoped Meta pricing analytics."""

import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import get_unit
from messaging.meta_config import MetaReader, MetaReadError
from messaging.models import MetaConfiguration


class CostQuery(serializers.Serializer):
    start = serializers.DateField()
    end = serializers.DateField()
    refresh = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if attrs["end"] < attrs["start"] or (attrs["end"] - attrs["start"]).days > 92:
            raise serializers.ValidationError("Selecione um período de até 93 dias.")
        today = self.context["today"]
        if attrs["end"] > today or attrs["start"] < today - timedelta(days=365):
            raise serializers.ValidationError(
                "Selecione datas dentro dos últimos 12 meses, até hoje."
            )
        return attrs


class CostRow(serializers.Serializer):
    day = serializers.DateField()
    category = serializers.CharField()
    pricing_type = serializers.CharField()
    volume = serializers.IntegerField()
    cost = serializers.CharField()


class CostOutput(serializers.Serializer):
    status = serializers.CharField()
    code = serializers.CharField(allow_blank=True)
    start = serializers.DateField()
    end = serializers.DateField()
    currency = serializers.CharField(allow_null=True)
    phone_number = serializers.CharField(allow_blank=True)
    total_cost = serializers.CharField(allow_null=True)
    total_volume = serializers.IntegerField(allow_null=True)
    rows = CostRow(many=True)
    checked_at = serializers.DateTimeField()


def read_costs(config, start, end, tz):
    reader = MetaReader(config)
    currency = reader.get(config.waba_id, fields="currency").get("currency")
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        raise MetaReadError("currency_unavailable")
    phone_data = reader.get(config.phone_number_id, fields="display_phone_number")
    phone = re.sub(r"\D", "", str(phone_data.get("display_phone_number", "")))
    if not 8 <= len(phone) <= 15:
        raise MetaReadError("phone_unavailable")
    start_ts = int(datetime.combine(start, time.min, tzinfo=tz).timestamp())
    end_ts = min(
        int(datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz).timestamp()),
        int(timezone.now().timestamp()),
    )
    params = {
        "start": start_ts,
        "end": end_ts,
        "granularity": "DAILY",
        "dimensions": json.dumps(["PHONE", "PRICING_CATEGORY", "PRICING_TYPE"]),
        "metric_types": json.dumps(["COST", "VOLUME"]),
        "phone_numbers": json.dumps([phone]),
    }
    totals = defaultdict(lambda: [0, Decimal(0)])
    after, seen, count = None, set(), 0
    for _ in range(20):
        data = reader.get(
            config.waba_id + "/pricing_analytics",
            **params,
            **({"after": after} if after else {}),
        )
        groups = data.get("data")
        if not isinstance(groups, list):
            raise MetaReadError("invalid_provider_response")
        for group in groups:
            points = group.get("data_points") if isinstance(group, dict) else None
            if not isinstance(points, list):
                raise MetaReadError("invalid_provider_response")
            for point in points:
                count += 1
                if count > 10000 or not isinstance(point, dict):
                    raise MetaReadError("analytics_limit_exceeded")
                if re.sub(r"\D", "", str(point.get("phone_number", ""))) != phone:
                    raise MetaReadError("analytics_scope_mismatch")
                try:
                    cost = Decimal(str(point["cost"]))
                    volume = int(point["volume"])
                    stamp = int(point["start"])
                    if (
                        not cost.is_finite()
                        or volume < 0
                        or isinstance(point["volume"], bool)
                    ):
                        raise ValueError
                    day = datetime.fromtimestamp(stamp, tz).date()
                    if not start <= day <= end:
                        raise ValueError
                    category, pricing = point["pricing_category"], point["pricing_type"]
                    if not isinstance(category, str) or not isinstance(pricing, str):
                        raise TypeError
                except (
                    KeyError,
                    ValueError,
                    TypeError,
                    InvalidOperation,
                    OverflowError,
                ):
                    raise MetaReadError("invalid_provider_response") from None
                key = day.isoformat(), category, pricing
                totals[key][0] += volume
                totals[key][1] += cost
        paging = data.get("paging", {})
        if not paging.get("next"):
            break
        after = paging.get("cursors", {}).get("after")
        if (
            not isinstance(after, str)
            or not after
            or len(after) > 4096
            or after in seen
        ):
            raise MetaReadError("invalid_pagination")
        seen.add(after)
    else:
        raise MetaReadError("analytics_limit_exceeded")
    rows = [
        {
            "day": key[0],
            "category": key[1],
            "pricing_type": key[2],
            "volume": value[0],
            "cost": str(value[1]),
        }
        for key, value in sorted(totals.items())
    ]
    return {
        "status": "available",
        "code": "",
        "currency": currency,
        "phone_number": phone,
        "total_cost": str(sum((v[1] for v in totals.values()), Decimal(0))),
        "total_volume": sum(v[0] for v in totals.values()),
        "rows": rows,
    }


class MetaCostView(APIView):
    @extend_schema(
        parameters=[
            OpenApiParameter("unit", OpenApiTypes.STR),
            OpenApiParameter("start", OpenApiTypes.DATE),
            OpenApiParameter("end", OpenApiTypes.DATE),
            OpenApiParameter("refresh", OpenApiTypes.BOOL),
        ],
        responses=CostOutput,
    )
    def get(self, request):
        unit = get_unit(request)
        tz = ZoneInfo(unit.timezone)
        today = timezone.now().astimezone(tz).date()
        values = CostQuery(
            data={
                "start": request.query_params.get("start") or today.replace(day=1),
                "end": request.query_params.get("end") or today,
                "refresh": request.query_params.get("refresh", False),
            },
            context={"today": today},
        )
        values.is_valid(raise_exception=True)
        start, end = values.validated_data["start"], values.validated_data["end"]
        config = MetaConfiguration.objects.filter(unit=unit).first()
        base = {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "checked_at": timezone.now().isoformat(),
        }
        empty = {
            "currency": None,
            "phone_number": "",
            "total_cost": None,
            "total_volume": None,
            "rows": [],
        }
        if not config or not all(
            [config.waba_id, config.phone_number_id, config.token_ciphertext]
        ):
            return Response(
                {
                    **base,
                    **empty,
                    "status": "not_configured",
                    "code": "meta_not_configured",
                }
            )
        identity = f"{unit.pk}:{config.version}:{config.waba_id}:{config.phone_number_id}:{start}:{end}"
        key = "meta-costs:" + hashlib.sha256(identity.encode()).hexdigest()
        cached = cache.get(key)
        if cached and not values.validated_data["refresh"]:
            return Response(cached)
        try:
            result = {**base, **read_costs(config, start, end, tz)}
        except MetaReadError as exc:
            result = {**base, **empty, "status": "unavailable", "code": exc.code}
        except serializers.ValidationError:
            result = {
                **base,
                **empty,
                "status": "unavailable",
                "code": "credentials_unreadable",
            }
        cache.set(key, result, 300 if result["status"] == "available" else 30)
        return Response(result)
