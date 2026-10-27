import pytest
from datetime import time
from core.models import Unit
from operations.models import ReportDefinition,ReportRecipient,ReportAutomation

@pytest.mark.parametrize("section,kind",[("reports","report"),("components","component")])
def test_report_pages_have_25_items_and_preserve_scope_and_filters(setup,section,kind):
    unit=setup["unit"]
    ReportDefinition.objects.bulk_create([ReportDefinition(unit=unit,code=f"page25_{i:02d}",name=f"PAGE25 {i:02d}",catalog_kind=kind,source="legacy_pending") for i in range(26)])
    other=Unit.objects.create(slug="other25",name="Other")
    ReportDefinition.objects.create(unit=other,code="outside",name="PAGE25 outside",catalog_kind=kind,source="legacy_pending")
    url=f"/api/v1/reports/?unit={unit.slug}&section={section}&search=PAGE25"
    first=setup["client"].get(url);second=setup["client"].get(url+"&page=2")
    assert first.status_code==second.status_code==200
    assert first.data["count"]==second.data["count"]==26
    assert len(first.data["results"])==25 and len(second.data["results"])==1
    assert first.data["next"] and second.data["previous"] and second.data["next"] is None
    assert len({r["id"] for page in [first,second] for r in page.data["results"]})==26
    assert all(r["unit"]==unit.pk for page in [first,second] for r in page.data["results"])


def test_automation_list_uses_25_item_pages(setup):
    unit=setup["unit"]
    report=ReportDefinition.objects.create(unit=unit,code="page25",name="Page25",source="legacy_pending")
    recipient=ReportRecipient.objects.create(unit=unit,name="Synthetic",address="5511999990001")
    ReportAutomation.objects.bulk_create([ReportAutomation(unit=unit,report=report,recipient=recipient,send_time=time(8),weekdays=[0]) for _ in range(26)])
    url=f"/api/v1/report-automations/?unit={unit.slug}"
    first=setup["client"].get(url);second=setup["client"].get(url+"&page=2")
    assert first.status_code==second.status_code==200
    assert first.data["count"]==26 and len(first.data["results"])==25
    assert second.data["next"] is None and len(second.data["results"])==1
    assert len({r["id"] for page in [first,second] for r in page.data["results"]})==26
