"""Validated calculation primitives for Informative Indicators; not a live handler.

No source selection or delivery is enabled here. Capacities must be dated and
approved in the same environment before integration into the report executor.
"""
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

SURGERY_GROUPS = ("SUS", "SANSAUDE", "CONVENIO", "PARTICULAR", "IAMSPE")
ATTENDANCE_ORIGINS = (
    "RECEPCAO PS - CONVENIO", "RECEPCAO PS - SUS", "RECEPCAO PA - G.O.",
    "RECEPCAO PA - PEDIATRIA", "RECEPCAO PS - ISOLAMENTO",
)


def legacy_round(value, places=0):
    return Decimal(str(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def occupancy(patient_total, capacity_total, days, *, capacity_complete):
    if days <= 0:
        raise ValueError("A positive day count is required")
    patients = legacy_round(Decimal(str(patient_total)) / days)
    if not capacity_complete or capacity_total is None:
        return {"patients": patients, "capacity": None, "rate": None,
                "status": "capacity_missing"}
    if Decimal(str(capacity_total)) < 0:
        raise ValueError("Capacity cannot be negative")
    beds = legacy_round(Decimal(str(capacity_total)) / days)
    return {"patients": patients, "capacity": beds,
            "rate": legacy_round(100 * patients / beds) if beds > 0 else None,
            "status": "ok" if beds > 0 else "capacity_zero"}


def series_averages(totals, days, *, kind):
    if days <= 0 or kind not in {"attendances", "surgeries"}:
        raise ValueError("Invalid series or day count")
    groups = SURGERY_GROUPS if kind == "surgeries" else ATTENDANCE_ORIGINS
    scale = 1 if kind == "surgeries" else 0
    values = [legacy_round(Decimal(str(totals.get(g, 0))) / days, scale) for g in groups]
    # BLR sums the rounded series, rather than rounding a grand total again.
    return {"groups": groups, "values": values, "total": sum(values, Decimal(0))}


def selected_dates(reference):
    if not isinstance(reference, date):
        raise ValueError("A reference date is required")
    month_index = reference.year * 12 + reference.month - 1
    months = [date(i // 12, i % 12 + 1, 1) for i in range(month_index - 12, month_index + 1)]
    return {"start": date(reference.year - 1, 1, 1), "end_exclusive": reference,
            "annual_years": [reference.year - 1, reference.year],
            "months": months, "days": [reference - timedelta(days=i) for i in range(8, 0, -1)]}


def assert_capacity_environment(*, oracle_environment, capacity_environment,
                                oracle_connection_id, capacity_connection_id):
    if (not oracle_environment or oracle_environment != capacity_environment
            or oracle_connection_id != capacity_connection_id):
        raise ValueError("Oracle and capacity must have the same approved source")
