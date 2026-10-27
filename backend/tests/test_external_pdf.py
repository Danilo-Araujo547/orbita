import base64
import io
import os
import uuid
from unittest.mock import patch

import pytest
from django.utils import timezone
from pypdf import PdfWriter
from rest_framework.exceptions import PermissionDenied, ValidationError

from operations.external_pdf import FILES, HANDLER, MAX_BYTES, load_source
from operations.models import (ReportDefinition, ReportExecution, ReportGrant,
                               ReportRecipient, ReportWhatsAppConfiguration)
from operations.reporting import execute_report, execution_access, make_execution, readiness
from operations.report_whatsapp import handle_inbound, deliver_report


def pdf_bytes(*, width=100, encrypted=False, pages=1):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=width, height=100)
    if encrypted:
        writer.encrypt("synthetic-test-password")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


@pytest.fixture(params=sorted(code for unit, code in FILES if unit == "scv"))
def local_pdf(setup, tmp_path, settings, request):
    setup["unit"].slug = "scv"
    setup["unit"].save(update_fields=["slug"])
    settings.REPORT_FILES_ROOT = str(tmp_path)
    settings.ASYNC_TASKS = True
    source = tmp_path / FILES[("scv", request.param)]
    source.parent.mkdir(parents=True)
    content = pdf_bytes()
    source.write_bytes(content)
    report = ReportDefinition.objects.create(unit=setup["unit"], code=request.param,
        name="Painel Leitos", source="external_file", handler=HANDLER,
        enabled=True, reviewed=True, output_format="pdf")
    return {**setup, "report": report, "source": source, "content": content}


def test_original_bytes_pipeline_and_authorized_download(local_pdf):
    e = local_pdf
    assert not readiness(e["report"])
    job = make_execution(e["report"], {}, user=e["user"])
    assert job.connection_version is None
    assert job.snapshot["external_pdf"]["pages"] == 1
    with patch("operations.report_whatsapp.enqueue_delivery"):
        execute_report(job.pk)
    job.refresh_from_db()
    assert job.state == "ready" and job.row_count == 1
    assert job.delivery_state == "not_requested" and not job.snapshot.get("no_data")
    assert base64.b64decode(job.result) == e["content"]
    response = e["client"].get(f"/api/v1/report-executions/{job.pk}/download/?unit=scv")
    assert response.status_code == 200 and response.content == e["content"]
    assert response["Content-Type"] == "application/pdf"
    # Replacing/removing the published source preserves the protected execution copy.
    e["source"].write_bytes(pdf_bytes(width=200))
    execution_access(job, for_download=True)
    e["source"].unlink()
    execution_access(job, for_download=True)
    assert readiness(e["report"])
    job.result = base64.b64encode(b"tampered").decode()
    with pytest.raises(PermissionDenied):
        execution_access(job, for_download=True)


@pytest.mark.parametrize("bad", [b"", b"not a PDF", b"%PDF-1.4 incomplete", pdf_bytes(encrypted=True), pdf_bytes(pages=0), pdf_bytes(pages=201)])
def test_invalid_sources_block_before_execution(local_pdf, bad):
    e = local_pdf
    e["source"].write_bytes(bad)
    assert readiness(e["report"])
    with pytest.raises((ValidationError, PermissionDenied)):
        make_execution(e["report"], {}, user=e["user"])
    assert not ReportExecution.objects.exists()


def test_missing_oversized_symlink_and_fifo_are_rejected(local_pdf, tmp_path):
    e = local_pdf
    e["source"].unlink()
    with pytest.raises(ValidationError): load_source(e["report"])
    with e["source"].open("wb") as stream: stream.truncate(MAX_BYTES + 1)
    with pytest.raises(ValidationError): load_source(e["report"])
    e["source"].unlink()
    other = tmp_path / "other.pdf"; other.write_bytes(e["content"])
    e["source"].symlink_to(other)
    with pytest.raises(ValidationError): load_source(e["report"])
    e["source"].unlink()
    os.mkfifo(e["source"])
    with pytest.raises(ValidationError): load_source(e["report"])


def test_pending_snapshot_rejects_replacement_and_future_request_uses_new_pdf(local_pdf):
    e = local_pdf
    old = make_execution(e["report"], {}, user=e["user"])
    new_content = pdf_bytes(width=200)
    e["source"].write_bytes(new_content)
    with patch("operations.report_whatsapp.enqueue_delivery"):
        execute_report(old.pk)
    old.refresh_from_db()
    assert old.state == "blocked" and not old.result
    new = make_execution(e["report"], {}, user=e["user"])
    assert new.snapshot["external_pdf"]["sha256"] != old.snapshot["external_pdf"]["sha256"]
    with patch("operations.report_whatsapp.enqueue_delivery"):
        execute_report(new.pk)
    new.refresh_from_db()
    assert new.state == "ready" and base64.b64decode(new.result) == new_content


@pytest.mark.parametrize("field,value", [("code", "other"), ("output_format", "csv"),
    ("handler", "unknown"), ("parameter_schema", {"path": {"type": "string"}}),
    ("query_sql", "SELECT 1"), ("components", [{"code": "other"}])])
def test_only_allowlisted_definition_is_supported(local_pdf, field, value):
    setattr(local_pdf["report"], field, value)
    assert readiness(local_pdf["report"])


def test_unit_and_permission_and_definition_revocation(local_pdf):
    e = local_pdf
    e["unit"].slug = "other"
    with pytest.raises(ValidationError): load_source(e["report"])
    e["unit"].slug = "scv"
    recipient = ReportRecipient.objects.create(unit=e["unit"], name="Synthetic",
        address="5511999990001", active=True, verified_at=timezone.now())
    with pytest.raises(PermissionDenied):
        make_execution(e["report"], {}, recipient=recipient, origin="whatsapp", transport="baileys")
    job = make_execution(e["report"], {}, user=e["user"])
    with patch("operations.report_whatsapp.enqueue_delivery"):
        execute_report(job.pk)
    job.refresh_from_db()
    e["report"].version += 1; e["report"].save()
    job.report = e["report"]
    with pytest.raises(PermissionDenied): execution_access(job)


def test_whatsapp_menu_selection_deduplication_and_mock_delivery(local_pdf, settings):
    e = local_pdf
    settings.REPORT_BAILEYS_ALLOW_SENDS = True
    settings.REPORT_BAILEYS_TOKEN = "synthetic-no-network"
    ReportWhatsAppConfiguration.objects.create(unit=e["unit"], sends_enabled=True,
        manual_enabled=True, automatic_enabled=False)
    recipient = ReportRecipient.objects.create(unit=e["unit"], name="Synthetic",
        address="5511999990001", active=True, verified_at=timezone.now())
    grant = ReportGrant.objects.create(unit=e["unit"], report=e["report"], recipient=recipient,
        active=True, manual=True)
    def event(text):
        return {"unit_id": e["unit"].pk, "message_id": uuid.uuid4().hex,
            "address": recipient.address, "is_group": False, "text": text,
            "timestamp": int(timezone.now().timestamp())}
    with patch("operations.report_whatsapp.service") as transport:
        menu = handle_inbound(event("menu"))
        assert "Painel Leitos" in str(menu)
        from operations.models import ReportConversation
        convo = ReportConversation.objects.get(unit=e["unit"], address=recipient.address)
        selection = event(next(iter(convo.data["choices"])))
        with patch("operations.reporting.enqueue"):
            response = handle_inbound(selection)
            assert handle_inbound(selection) == response
        assert ReportExecution.objects.count() == 1
        job = ReportExecution.objects.get()
        assert job.parameters == {} and job.recipient_id == recipient.pk
        with patch("operations.report_whatsapp.enqueue_delivery"):
            execute_report(job.pk)
        job.refresh_from_db()
        assert job.state == "ready" and job.row_count == 1
        transport.assert_not_called()
    # The dispatcher sees the normal PDF payload; only a mock accepts it.
    with patch("operations.report_whatsapp.service", return_value={"state": "sent"}) as send:
        deliver_report(job.pk)
    assert send.call_count == 2
    payload = send.call_args_list[0].args[2]
    assert send.call_args_list[1].args[2]["kind"] == "buttons"
    assert payload["kind"] == "document" and payload["mime"] == "application/pdf"
    assert base64.b64decode(payload["content"]) == e["content"]
    job.refresh_from_db()
    grant.manual = False; grant.save()
    with pytest.raises(PermissionDenied): execution_access(job)


def test_configuration_preserves_grants_and_rejects_conflicts_and_enabled_schedules(local_pdf):
    from datetime import time
    from django.core.management import call_command
    from django.core.management.base import CommandError
    from operations.models import ReportAutomation
    e = local_pdf
    recipient = ReportRecipient.objects.create(unit=e["unit"], name="Synthetic",
        address="5511999990001", active=False)
    grant = ReportGrant.objects.create(unit=e["unit"], recipient=recipient,
        report=e["report"], active=False, manual=False, automatic=True,
        parameters={"restricted": "preserved"})
    with pytest.raises(CommandError):
        call_command("configure_local_bed_panel", expected_version=99, code=e["report"].code, stdout=io.StringIO())
    auto = ReportAutomation.objects.create(unit=e["unit"], report=e["report"],
        recipient=recipient, enabled=True, send_time=time(8, 0))
    with pytest.raises(CommandError):
        call_command("configure_local_bed_panel", expected_version=1, code=e["report"].code, stdout=io.StringIO())
    auto.enabled = False; auto.save()
    e["source"].unlink()
    call_command("configure_local_bed_panel", expected_version=1, code=e["report"].code, stdout=io.StringIO())
    e["report"].refresh_from_db(); grant.refresh_from_db(); auto.refresh_from_db()
    assert e["report"].version == 2 and e["report"].enabled
    assert readiness(e["report"])  # Missing PDF stays unavailable in the menu.
    assert not grant.active and not grant.manual and grant.automatic
    assert grant.parameters == {"restricted": "preserved"} and not auto.enabled
