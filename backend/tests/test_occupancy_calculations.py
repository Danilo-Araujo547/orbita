from datetime import date
from decimal import Decimal
from pathlib import Path
import pytest
from operations.occupancy_calculations import (assert_capacity_environment, occupancy,
    selected_dates, series_averages)
from operations.report_engine import sql_contract


def test_sql_queries_are_readonly_bound_and_contain_no_patient_output():
    root = Path(__file__).resolve().parents[1] / "operations/report_sql/occupancy_indicators"
    schema = {"inicio": {"type": "date"}, "fim_exclusivo": {"type": "date"}}
    assert len(list(root.glob("*_days.sql"))) == 3
    for p in root.glob("*.sql"):
        assert sql_contract(p.read_text(), schema, "oracle") == set(schema)
    # Surgery IDs are used only inside DISTINCT, never exposed in the outer result.
    s = (root / "surgeries_days.sql").read_text()
    assert 'WHERE "Centro_Cirurgico" = 1' in s
    assert "select DISTINCT AVISO_CIRURGIA.CD_AVISO_CIRURGIA" in s


@pytest.mark.parametrize("patients,beds,expected", [(33,38,87),(12,15,80),(4,3,133)])
def test_occupancy_matches_documented_legacy_samples(patients, beds, expected):
    assert occupancy(patients, beds, 1, capacity_complete=True)["rate"] == expected


def test_round_daily_means_before_calculating_the_rate():
    r = occupancy(5, 7, 2, capacity_complete=True)
    assert r == {"patients": Decimal(3), "capacity": Decimal(4), "rate": Decimal(75), "status":"ok"}


@pytest.mark.parametrize("complete,beds,status", [(False, None, "capacity_missing"),
    (False, 100, "capacity_missing"), (True, 0, "capacity_zero")])
def test_missing_or_zero_capacity_is_not_presented_as_a_zero_percent(complete,beds,status):
    r = occupancy(34,beds,1,capacity_complete=complete)
    assert r["patients"] == 34 and r["rate"] is None and r["status"] == status


def test_legitimate_zero_occupancy_is_retained():
    assert occupancy(0,38,1,capacity_complete=True)["rate"] == 0


def test_surgery_rounds_to_one_decimal_and_total_sums_rounded_groups():
    r = series_averages({"SUS":1,"CONVENIO":1},3,kind="surgeries")
    assert r["values"] == [Decimal("0.3"),0,Decimal("0.3"),0,0]
    assert r["total"] == Decimal("0.6")


def test_attendances_preserve_exact_legacy_origin_list():
    r = series_averages({"RECEPCAO PS - SUS":5,"OTHER ORIGIN":100},2,kind="attendances")
    assert r["values"][1] == 3 and r["total"] == 3


def test_selected_windows_cross_years_and_exclude_reference_day():
    r = selected_dates(date(2026,1,1))
    assert len(r["months"]) == 13 and r["months"][0] == date(2025,1,1)
    assert r["months"][-1] == date(2026,1,1)
    assert r["days"][0] == date(2025,12,24) and r["days"][-1] == date(2025,12,31)
    assert r["end_exclusive"] == date(2026,1,1)


def test_different_environments_or_connections_are_rejected():
    with pytest.raises(ValueError):
        assert_capacity_environment(oracle_environment="homologation",capacity_environment="production",
            oracle_connection_id=19,capacity_connection_id=19)
    with pytest.raises(ValueError):
        assert_capacity_environment(oracle_environment="homologation",capacity_environment="homologation",
            oracle_connection_id=19,capacity_connection_id=10)
    assert_capacity_environment(oracle_environment="homologation",capacity_environment="homologation",
        oracle_connection_id=19,capacity_connection_id=19)
