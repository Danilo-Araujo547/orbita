import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import time
from unittest.mock import patch

import pytest
from django.db import close_old_connections, connections
from django.utils import timezone

from core.models import Membership, Unit
from operations.models import (
    ReportAutomation,
    ReportConnection,
    ReportConversation,
    ReportDefinition,
    ReportExecution,
    ReportGrant,
    ReportRecipient,
    ReportWhatsAppConfiguration,
)
from operations.report_whatsapp import deliver_report, handle_inbound
from operations.reporting import make_execution, tick_reports


@pytest.fixture
def channel(setup, settings):
    settings.REPORT_BAILEYS_ALLOW_SENDS = True
    settings.REPORT_BAILEYS_TOKEN = "test-token-not-used-on-network"
    settings.ASYNC_TASKS = True
    unit = setup["unit"]
    config = ReportWhatsAppConfiguration.objects.create(
        unit=unit, sends_enabled=True, manual_enabled=True, automatic_enabled=True
    )
    conn = ReportConnection.objects.create(
        unit=unit,
        name="Synthetic",
        engine="sqlite",
        database="/synthetic.sqlite3",
        enabled=True,
        validated=True,
    )
    report = ReportDefinition.objects.create(
        unit=unit,
        code="one",
        name="01 · Relatório permitido",
        source="sql",
        enabled=True,
        reviewed=True,
        connection=conn,
        query_sql="SELECT :data_inicial, :data_final",
        request_message="Informe o período desejado.",
        parameter_schema={
            "data_inicial": {
                "type": "date",
                "prompt": "Informe a data inicial em DD/MM/AAAA.",
            },
            "data_final": {
                "type": "date",
                "prompt": "Informe a data final em DD/MM/AAAA.",
                "not_before": "data_inicial",
            },
        },
    )
    recipient = ReportRecipient.objects.create(
        unit=unit,
        name="Contato fictício",
        address="5511999990001",
        active=True,
        verified_at=timezone.now(),
    )
    grant = ReportGrant.objects.create(
        unit=unit, recipient=recipient, report=report, active=True
    )
    secret = ReportDefinition.objects.create(
        unit=unit,
        code="secret",
        name="Relatório sem permissão",
        source="sql",
        enabled=True,
        reviewed=True,
        connection=conn,
        query_sql="SELECT 1",
    )
    return {
        **setup,
        "config": config,
        "conn": conn,
        "report": report,
        "recipient": recipient,
        "grant": grant,
        "secret": secret,
    }


def event(e, text="menu", **kwargs):
    return {
        "unit_id": e["unit"].pk,
        "message_id": uuid.uuid4().hex,
        "address": e["recipient"].address,
        "is_group": False,
        "text": text,
        "timestamp": int(timezone.now().timestamp()),
        **kwargs,
    }


def answer(e, text):
    if text == "1":
        convo=ReportConversation.objects.filter(unit=e["unit"],address=e["recipient"].address).first()
        text=next(iter(convo.data.get("choices", {})), text) if convo else text
    return handle_inbound(event(e, text))


def test_default_global_and_unit_gates_do_not_generate_or_send(channel, settings):
    settings.REPORT_BAILEYS_ALLOW_SENDS = False
    with patch("operations.report_whatsapp.service") as send:
        assert answer(channel, "menu") == {"disabled": True, "actions": []}
        assert not ReportExecution.objects.exists()
        send.assert_not_called()
    settings.REPORT_BAILEYS_ALLOW_SENDS = True
    channel["config"].manual_enabled = False
    channel["config"].save()
    assert answer(channel, "menu")["disabled"]


def test_menu_contains_only_granted_reports_in_own_unit(channel):
    e = channel
    other = Unit.objects.create(slug="other", name="Other")
    ReportDefinition.objects.create(
        unit=other, code="foreign", name="Outra unidade", enabled=True, reviewed=True
    )
    menu = str(answer(e, "menu")["actions"][0])
    assert e["report"].name in menu
    assert e["secret"].name not in menu and "Outra unidade" not in menu
    assert "data inicial" in answer(e, "1")["actions"][0]["content"]


def test_sequential_dates_invalid_date_range_and_exactly_one_job(channel):
    e = channel
    with patch("operations.reporting.enqueue") as enqueue:
        answer(e, "menu")
        answer(e, "1")
        assert "Valor inválido" in answer(e, "31/02/2026")["actions"][0]["content"]
        assert not ReportExecution.objects.exists()
        assert "data final" in answer(e, "20/10/2026")["actions"][0]["content"]
        assert "posterior" in answer(e, "19/10/2026")["actions"][0]["content"]
        final = event(e, "25/10/2026")
        first = handle_inbound(final)
        assert handle_inbound(final) == first
        assert ReportExecution.objects.count() == 1
        enqueue.assert_called_once()
        job = ReportExecution.objects.get()
        assert job.parameters == {
            "data_inicial": "2026-10-20",
            "data_final": "2026-10-25",
        }
        assert job.snapshot["transport"] == "baileys" and job.requester is None


def test_revoked_grant_cannot_continue_or_generate(channel):
    e = channel
    answer(e, "menu")
    answer(e, "1")
    e["grant"].active = False
    e["grant"].save()
    result = answer(e, "20/10/2026")["actions"][0]["content"]
    assert "Nenhum relatório" in result and e["report"].name not in result
    assert not ReportExecution.objects.exists()


def test_definition_change_resets_parameter_dialogue(channel):
    e = channel
    answer(e, "menu")
    answer(e, "1")
    e["report"].version += 1
    e["report"].save()
    assert e["report"].name in str(answer(e, "20/10/2026")["actions"][0])
    assert "grant" not in ReportConversation.objects.get().data


def test_shared_contact_duplicate_recipient_is_not_union_of_permissions(channel):
    e = channel
    ReportRecipient.objects.create(
        unit=e["unit"],
        name="Duplicado",
        address="11999990001",
        active=True,
        verified_at=timezone.now(),
    )
    assert "Nenhum relatório" in answer(e, "menu")["actions"][0]["content"]


def test_old_out_of_order_and_group_identity_are_not_applied(channel):
    e = channel
    stale = event(e, "menu", timestamp=int(timezone.now().timestamp()) - 1900)
    assert handle_inbound(stale)["disabled"] and not ReportConversation.objects.exists()
    answer(e, "menu")
    answer(e, "1")
    early = event(e, "20/10/2026", timestamp=ReportConversation.objects.get().last_timestamp - 1)
    assert handle_inbound(early)["actions"] == []
    group = event(e, "menu", address="123456789@g.us", is_group=True)
    assert "Nenhum relatório" in handle_inbound(group)["actions"][0]["content"]
    assert not ReportExecution.objects.exists()


def test_restricted_parameters_are_not_prompted_and_cannot_be_overridden(channel):
    e = channel
    e["grant"].parameters = {"data_inicial": "2026-10-01"}
    e["grant"].save()
    answer(e, "menu")
    text = answer(e, "1")["actions"][0]["content"]
    assert "data final" in text and "data inicial" not in text
    with patch("operations.reporting.enqueue"):
        answer(e, "31/10/2026")
    assert ReportExecution.objects.get().parameters["data_inicial"] == "2026-10-01"


def test_report_without_parameters_can_be_requested_by_verified_phone(channel):
    e = channel
    e["report"].parameter_schema = {}
    e["report"].query_sql = "SELECT 1"
    e["report"].save()
    answer(e, "menu")
    with patch("operations.reporting.enqueue"):
        answer(e, "1")
    assert ReportExecution.objects.count() == 1


def test_delivery_rechecks_permissions_and_never_retries_uncertain_results(channel):
    e = channel
    job = make_execution(
        e["report"],
        {"data_inicial": "2026-10-01", "data_final": "2026-10-02"},
        recipient=e["recipient"],
        origin="whatsapp",
        transport="baileys",
    )
    job.state = "ready"
    job.result = "JVBERi0="
    job.save()
    with patch(
        "operations.report_whatsapp.service", return_value={"state": "uncertain"}
    ) as send:
        deliver_report(job.pk)
        deliver_report(job.pk)
        send.assert_called_once()
    job.refresh_from_db()
    assert job.delivery_state == "uncertain_baileys"
    job.delivery_state = "pending_baileys"
    job.save()
    e["grant"].active = False
    e["grant"].save()
    with patch("operations.report_whatsapp.service") as send:
        deliver_report(job.pk)
        send.assert_not_called()
    job.refresh_from_db()
    assert job.delivery_state == "blocked_access_changed"


def test_linked_user_access_revocation_blocks_menu(channel):
    e = channel
    e["recipient"].user = e["user"]
    e["recipient"].save()
    membership = Membership.objects.get(user=e["user"], unit=e["unit"])
    membership.permissions = {"reports": "none"}
    membership.save()
    assert "Nenhum relatório" in answer(e, "menu")["actions"][0]["content"]


def test_scheduler_does_not_create_work_when_channel_paused(channel, settings):
    e = channel
    ReportAutomation.objects.create(
        unit=e["unit"],
        report=e["report"],
        recipient=e["recipient"],
        send_time=time(0, 0),
        weekdays=list(range(7)),
        enabled=True,
        parameters={"data_inicial": "2026-10-01", "data_final": "2026-10-02"},
    )
    settings.REPORT_BAILEYS_ALLOW_SENDS = False
    tick_reports()
    assert not ReportExecution.objects.exists()


def test_channel_api_is_scoped_admin_only_and_versioned(channel, settings):
    e = channel
    client = e["client"]
    with patch(
        "operations.report_whatsapp.service",
        return_value={"state": "disconnected", "logs": []},
    ):
        assert client.get("/api/v1/report-whatsapp/?unit=ame").status_code == 200
        membership = Membership.objects.get(user=e["user"], unit=e["unit"])
        membership.role = "operator"
        membership.save()
        assert client.get("/api/v1/report-whatsapp/?unit=ame").status_code == 403
        membership.role = "admin"
        membership.save()
        Unit.objects.create(slug="no-access", name="Other")
        assert client.get("/api/v1/report-whatsapp/?unit=no-access").status_code == 403
        body = {
            "action": "configure",
            "version": 1,
            "greeting": "Escolha:",
            "sends_enabled": False,
            "manual_enabled": False,
            "automatic_enabled": False,
        }
        r = client.post(
            "/api/v1/report-whatsapp/?unit=ame",
            body,
            format="json",
            HTTP_IDEMPOTENCY_KEY=uuid.uuid4().hex,
        )
        assert r.status_code == 200
        r = client.post(
            "/api/v1/report-whatsapp/?unit=ame",
            body,
            format="json",
            HTTP_IDEMPOTENCY_KEY=uuid.uuid4().hex,
        )
        assert r.status_code == 409
        settings.REPORT_BAILEYS_ALLOW_SENDS = False
        body.update(version=2, sends_enabled=True)
        assert (
            client.post(
                "/api/v1/report-whatsapp/?unit=ame",
                body,
                format="json",
                HTTP_IDEMPOTENCY_KEY=uuid.uuid4().hex,
            ).status_code
            == 400
        )


def test_callback_requires_service_secret(channel):
    e = channel
    payload = event(e)
    assert (
        e["client"]
        .post("/api/v1/report-whatsapp/inbound/", payload, format="json")
        .status_code
        == 403
    )
    r = e["client"].post(
        "/api/v1/report-whatsapp/inbound/",
        payload,
        format="json",
        HTTP_AUTHORIZATION="Bearer test-token-not-used-on-network",
    )
    assert r.status_code == 200


@pytest.mark.django_db(transaction=True)
def test_concurrent_duplicate_inbound_creates_one_execution(channel):
    e = channel
    e["report"].parameter_schema = {}
    e["report"].query_sql = "SELECT 1"
    e["report"].save()
    answer(e, "menu")
    payload = event(e, next(iter(ReportConversation.objects.get(unit=e["unit"],address=e["recipient"].address).data["choices"])))

    def process():
        close_old_connections()
        try:
            return handle_inbound(payload)
        finally:
            connections.close_all()

    with patch("operations.reporting.enqueue") as enqueue:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: process(), range(2)))
        assert results[0] == results[1]
        assert ReportExecution.objects.count() == 1
        enqueue.assert_called_once()


def test_retried_menu_and_transport_authorization_recheck_revoked_access(channel):
    from operations.report_whatsapp import authorize_delivery

    e = channel
    inbound = event(e, "menu")
    result = handle_inbound(inbound)
    action = result["actions"][0]
    data = {
        "unit_id": e["unit"].pk,
        "key": action["key"],
        "to": action["to"],
        "mode": "manual",
        "event_id": action["event_id"],
        "policy": action["policy"],
    }
    assert authorize_delivery(data)
    e["grant"].active = False
    e["grant"].save()
    assert not authorize_delivery(data)
    assert handle_inbound(inbound)["actions"] == []
    e["config"].sends_enabled = False
    e["config"].save()
    assert handle_inbound(inbound)["disabled"]


def test_authorization_endpoint_requires_secret_and_rejects_wrong_unit(channel):
    e = channel
    body = {
        "unit_id": e["unit"].pk,
        "key": "report:not-a-uuid",
        "to": e["recipient"].address,
        "mode": "manual",
    }
    assert (
        e["client"]
        .post("/api/v1/report-whatsapp/authorize/", body, format="json")
        .status_code
        == 403
    )
    response = e["client"].post(
        "/api/v1/report-whatsapp/authorize/",
        body,
        format="json",
        HTTP_AUTHORIZATION="Bearer test-token-not-used-on-network",
    )
    assert response.status_code == 200 and response.data == {"allowed": False}


@pytest.mark.django_db(transaction=True)
def test_delivery_authorization_sees_committed_claim_from_another_connection(channel):
    from operations.report_whatsapp import authorize_delivery

    e = channel
    job = make_execution(
        e["report"],
        {"data_inicial": "2026-10-01", "data_final": "2026-10-02"},
        recipient=e["recipient"],
        origin="whatsapp",
        transport="baileys",
    )
    job.state = "ready"
    job.result = "JVBERi0="
    job.save()

    def send(unit, action, payload):
        def check():
            try:
                return authorize_delivery(
                    {
                        "unit_id": unit.pk,
                        "key": payload["key"],
                        "to": payload["to"],
                        "mode": "manual",
                    }
                )
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            assert pool.submit(check).result(timeout=10)
        return {"state": "sent", "provider_id": "synthetic"}

    with patch("operations.report_whatsapp.service", side_effect=send):
        deliver_report(job.pk)
    job.refresh_from_db()
    assert job.delivery_state == "sent_baileys"


def test_enabling_manual_sends_does_not_enable_schedules(channel):
    from operations.report_whatsapp import allowed

    e = channel
    schedule = ReportAutomation.objects.create(
        unit=e["unit"],
        report=e["report"],
        recipient=e["recipient"],
        send_time=time(0, 0),
        weekdays=list(range(7)),
        enabled=False,
        parameters={"data_inicial": "2026-10-01", "data_final": "2026-10-02"},
    )
    response = e["client"].post(
        "/api/v1/report-whatsapp/?unit=ame",
        {
            "action": "configure",
            "version": 1,
            "greeting": "Selecione:",
            "sends_enabled": True,
            "manual_enabled": True,
            "automatic_enabled": False,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=uuid.uuid4().hex,
    )
    assert response.status_code == 200
    e["config"].refresh_from_db()
    assert allowed(e["config"], "manual")
    assert not allowed(e["config"], "automatic")
    with patch("operations.reporting.enqueue") as enqueue:
        tick_reports()
        enqueue.assert_not_called()
    schedule.refresh_from_db()
    assert not schedule.enabled
    assert not ReportExecution.objects.exists()
    response = e["client"].post(
        "/api/v1/report-whatsapp/?unit=ame",
        {
            "action": "configure",
            "version": 2,
            "greeting": "Selecione:",
            "sends_enabled": True,
            "manual_enabled": True,
            "automatic_enabled": True,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=uuid.uuid4().hex,
    )
    assert response.status_code == 200
    with patch("operations.reporting.enqueue") as enqueue:
        tick_reports()
        enqueue.assert_not_called()
    schedule.refresh_from_db()
    assert not schedule.enabled
    assert not ReportExecution.objects.exists()


def test_local_report_uses_verified_phone_grant_without_panel_user(channel):
    from operations.reporting import execute_report

    e = channel
    from datetime import datetime
    from operations.models import SourceEvent
    # Keep this report's fixture inside the explicit October reporting window.
    SourceEvent.objects.filter(appointment=e["appointment"]).update(
        occurred_at=timezone.make_aware(datetime(2026,10,15,12))
    )
    report = e["report"]
    report.source = "local"
    report.handler = "contacts"
    report.connection = None
    report.query_sql = ""
    report.parameter_schema = {"start": "date", "end": "date"}
    report.output_format = "csv"
    report.save()
    assert e["recipient"].user_id is None
    assert report.name in str(answer(e, "menu")["actions"][0])
    assert "DD/MM/AAAA" in answer(e, "1")["actions"][0]["content"]
    answer(e, "01/10/2026")
    with patch("operations.reporting.enqueue") as enqueue:
        result = answer(e, "31/10/2026")
    assert "Gerando relatório" in result["actions"][0]["content"]
    enqueue.assert_called_once()
    job = ReportExecution.objects.get(report=report)
    assert job.requester_id is None
    with patch("operations.report_whatsapp.enqueue_delivery") as delivery:
        execute_report(job.pk)
        delivery.assert_called_once()
    job.refresh_from_db()
    assert job.state == "ready", job.error_code
    assert "Paciente" in job.result
    report.refresh_from_db()
    assert report.parameter_schema == {"start": "date", "end": "date"}


def test_local_report_phone_grant_revocation_blocks_generation(channel):
    from operations.reporting import execute_report

    e = channel
    report = e["report"]
    report.source = "local"
    report.handler = "contacts"
    report.connection = None
    report.parameter_schema = {}
    report.save()
    job = make_execution(
        report, {}, recipient=e["recipient"], origin="whatsapp", transport="baileys"
    )
    e["grant"].active = False
    e["grant"].save()
    with patch("operations.reports.local_report_content") as render:
        execute_report(job.pk)
        render.assert_not_called()
    job.refresh_from_db()
    assert job.state == "blocked" and not job.result


def test_native_list_uses_allowed_reports_and_rejects_stale_or_numeric_selection(channel):
    e=channel
    first=answer(e,"menu")["actions"][0]
    assert first["kind"]=="list" and first["button"]=="Ver relatórios"
    assert e["secret"].name not in str(first)
    selected=first["sections"][0]["rows"][0]["rowId"]
    assert selected.startswith("scv:report:")
    assert answer(e,"2")["actions"][0]["kind"]=="list"
    assert answer(e,selected)["actions"][0]["kind"]=="list"
    current=answer(e,"menu")["actions"][0]["sections"][0]["rows"][0]["rowId"]
    assert "data inicial" in answer(e,current)["actions"][0]["content"]


def test_native_list_paginates_without_exposing_ungranted_reports(channel):
    e=channel
    for i in range(12):
        r=ReportDefinition.objects.create(unit=e["unit"],code=f"native-{i}",name=f"Native report {i}",source="sql",connection=e["conn"],query_sql="SELECT 1",enabled=True,reviewed=True)
        ReportGrant.objects.create(unit=e["unit"],recipient=e["recipient"],report=r,active=True)
    first=answer(e,"menu")["actions"][0]
    rows=first["sections"][0]["rows"]
    assert len(rows)==9
    page=next(r["rowId"] for r in rows if r["title"]=="Mais relatórios")
    second=answer(e,page)["actions"][0]
    assert second["kind"]=="list" and len(second["sections"][0]["rows"])==6


def test_flow_configuration_preserves_send_flags_and_checks_version(channel):
    e=channel;c=e["client"];cfg=e["config"]
    data={"action":"configure","version":cfg.version,"greeting":"Escolha o documento desejado.","menu_title":"Documentos SCV","menu_button":"Ver relatórios","menu_section":"Seus relatórios","sends_enabled":cfg.sends_enabled,"manual_enabled":cfg.manual_enabled,"automatic_enabled":cfg.automatic_enabled}
    response=c.post("/api/v1/report-whatsapp/?unit=ame",data,format="json",HTTP_IDEMPOTENCY_KEY=uuid.uuid4().hex)
    assert response.status_code==200,response.data
    cfg.refresh_from_db()
    assert cfg.menu_title=="Documentos SCV" and cfg.menu_button=="Ver relatórios"
    assert cfg.sends_enabled and cfg.manual_enabled and cfg.automatic_enabled
    response=c.post("/api/v1/report-whatsapp/?unit=ame",data,format="json",HTTP_IDEMPOTENCY_KEY=uuid.uuid4().hex)
    assert response.status_code==409


def test_date_prompts_use_portuguese_labels():
    from operations.report_whatsapp import prompt
    assert prompt("start",{"type":"date"})=="Informe a data inicial no formato *DD/MM/AAAA*."
    assert prompt("end_date",{"type":"date"})=="Informe a data final no formato *DD/MM/AAAA*."
    assert "Start Date" not in prompt("start",{"type":"date","prompt":"Informe Start Date"})


def finished_job(e, empty=False):
    job=make_execution(e["report"],{"data_inicial":"2026-10-01","data_final":"2026-10-02"},recipient=e["recipient"],origin="whatsapp",transport="baileys")
    job.state="ready";job.row_count=0 if empty else 2;job.result="" if empty else "JVBERi0="
    if empty:job.snapshot["no_data"]=True
    job.save()
    return job


def test_empty_report_sends_only_notice_with_buttons(channel):
    e=channel;job=finished_job(e,True)
    with patch("operations.report_whatsapp.service",return_value={"state":"sent"}) as send:
        with patch("operations.report_whatsapp.transaction.on_commit", side_effect=lambda fn:fn()):
            deliver_report(job.pk)
        assert send.call_count==1
        payload=send.call_args.args[2]
        assert payload["kind"]=="buttons" and "Não existem dados" in payload["content"]
        assert [b["title"] for b in payload["buttons"]]==["Solicitar novamente","Retornar ao menu"]
    job.refresh_from_db();assert job.delivery_state=="no_data" and not job.result


def test_successful_delivery_shows_buttons_once_and_repeat_asks_dates(channel):
    e=channel;job=finished_job(e)
    with patch("operations.report_whatsapp.service",return_value={"state":"sent"}) as send:
        deliver_report(job.pk);deliver_report(job.pk)
        assert [c.args[2]["kind"] for c in send.call_args_list]==["document","buttons"]
    # Existing conversation, as after a completed inbound request.
    ReportConversation.objects.update_or_create(unit=e["unit"],address=e["recipient"].address,defaults={"expires_at":timezone.now()+timezone.timedelta(minutes=30),"data":{"last_job":str(job.pk)}})
    response=answer(e,f"scv:again:{job.pk}")
    assert "data inicial" in response["actions"][0]["content"]
    assert not ReportConversation.objects.get(unit=e["unit"],address=e["recipient"].address).data["values"]
    assert answer(e,f"scv:new:{job.pk}")["actions"][0]["kind"]=="list"


def test_followup_buttons_revalidate_permission(channel):
    from operations.report_whatsapp import authorize_delivery
    e=channel;job=finished_job(e)
    job.delivery_state="sent_baileys";job.snapshot["feedback_state"]="sending";job.save()
    data={"unit_id":e["unit"].pk,"key":f"report-feedback:{job.pk}","mode":"manual","to":e["recipient"].address}
    assert authorize_delivery(data)
    e["grant"].active=False;e["grant"].save()
    assert not authorize_delivery(data)


def test_empty_query_never_prepares_a_document(channel):
    from operations.reporting import execute_report
    e=channel
    job=make_execution(e["report"],{"data_inicial":"2026-10-01","data_final":"2026-10-02"},recipient=e["recipient"],origin="whatsapp",transport="baileys")
    with patch("operations.reporting.collect",return_value=[("Empty",["X"],[])]),patch("operations.report_whatsapp.enqueue_delivery"):
        execute_report(job.pk)
    job.refresh_from_db()
    assert job.state=="ready" and job.row_count==0 and job.snapshot["no_data"] and job.result==""


def date_button(action, label):
    return next(b["id"] for b in action["buttons"] if b["title"]==label)


def test_date_questions_always_have_today_and_yesterday_and_use_unit_timezone(channel):
    from datetime import datetime, timezone as dt_timezone
    e=channel
    # UTC is already 25/10 but Brasília is still 24/10.
    clock=datetime(2026,10,25,1,30,tzinfo=dt_timezone.utc)
    with patch("operations.report_whatsapp.timezone.now",return_value=clock):
        answer(e,"menu")
        first=answer(e,"1")["actions"][0]
        assert first["kind"]=="buttons" and [b["title"] for b in first["buttons"]]==["Hoje","Ontem","Retornar ao menu"]
        assert "DD/MM/AAAA" in first["content"]
        second=answer(e,date_button(first,"Ontem"))["actions"][0]
        assert ReportConversation.objects.get(unit=e["unit"],address=e["recipient"].address).data["values"]["data_inicial"]=="2026-10-23"
        assert second["kind"]=="buttons" and "data final" in second["content"]
        with patch("operations.reporting.enqueue"):
            answer(e,date_button(second,"Hoje"))
    assert ReportExecution.objects.get().parameters=={"data_inicial":"2026-10-23","data_final":"2026-10-24"}


def test_old_date_button_does_not_fill_next_parameter_and_range_stays_valid(channel):
    e=channel;answer(e,"menu")
    first=answer(e,"1")["actions"][0]
    old=date_button(first,"Hoje")
    second=answer(e,old)["actions"][0]
    again=answer(e,old)["actions"][0]
    convo=ReportConversation.objects.get(unit=e["unit"],address=e["recipient"].address)
    assert "data_final" not in convo.data["values"] and again["kind"]=="buttons"
    rejected=answer(e,date_button(again,"Ontem"))["actions"][0]
    assert "posterior" in rejected["content"] and rejected["kind"]=="buttons"
    assert "data_final" not in ReportConversation.objects.get(pk=convo.pk).data["values"]


def test_optional_date_can_be_typed_skipped_blank_or_selected(channel):
    from operations.report_whatsapp import parameter_value,prompt
    e=channel
    e["report"].parameter_schema={"data_referencia":{"type":"date","required":False,"prompt":"Informe a data no formato AAAA-MM-DD."}}
    e["report"].query_sql="SELECT :data_referencia";e["report"].save()
    answer(e,"menu");first=answer(e,"1")["actions"][0]
    assert first["kind"]=="buttons" and "*DD/MM/AAAA*" in first["content"] and "PULAR" not in first["content"]
    assert "AAAA-MM-DD" not in first["content"]
    assert parameter_value("d",{"type":"date","required":False},"") is None
    assert parameter_value("d",{"type":"date","required":False},"PULAR") is None
    assert parameter_value("d",{"type":"date","required":False},"24/10/2026")=="2026-10-24"
    with patch("operations.reporting.enqueue"):
        answer(e,date_button(first,"Hoje"))
    assert ReportExecution.objects.get().parameters["data_referencia"]


def test_medical_prompt_removes_old_optional_copy_and_bolds_date_format():
    from operations.report_whatsapp import prompt
    text=prompt("data_referencia",{"type":"date","required":False,"prompt":"Data de referência (AAAA-MM-DD). Em branco: hoje. Opcional: responda PULAR para deixar em branco."})
    assert text=="Data de referência (*DD/MM/AAAA*)."
    assert "PULAR" not in text and "branco" not in text


def test_menu_does_not_repeat_report_name_in_description(channel):
    e=channel;e["report"].name="INDICADORES MEDICOS";e["report"].save()
    row=answer(e,"menu")["actions"][0]["sections"][0]["rows"][0]
    assert row["title"]=="INDICADORES MEDICOS" and row["description"]==""


def test_duplicate_selection_creates_only_one_generation(channel):
    e=channel;e["report"].parameter_schema={};e["report"].query_sql="SELECT 1";e["report"].save()
    menu=answer(e,"menu")["actions"][0]
    selection=event(e,menu["sections"][0]["rows"][0]["rowId"])
    with patch("operations.reporting.enqueue") as enqueue:
        handle_inbound(selection);handle_inbound(selection)
        handle_inbound({**selection,"message_id":uuid.uuid4().hex})
    assert ReportExecution.objects.count()==1 and enqueue.call_count==1


def test_return_menu_button_clears_partial_parameters(channel):
    e=channel;answer(e,"menu")
    first=answer(e,"1")["actions"][0]
    assert first["buttons"][-1]=={"id":"scv:menu","title":"Retornar ao menu"}
    answer(e,"20/10/2026")
    returned=answer(e,"scv:menu")["actions"][0]
    assert returned["kind"]=="list"
    convo=ReportConversation.objects.get(unit=e["unit"],address=e["recipient"].address)
    assert "grant" not in convo.data and "values" not in convo.data


def test_unavailable_report_has_menu_button_instead_of_typing_instruction(channel):
    e=channel;answer(e,"menu");answer(e,"1")
    with patch("operations.report_whatsapp.parameter_value",side_effect=__import__("rest_framework.exceptions",fromlist=["ValidationError"]).ValidationError("bad")):
        response=answer(e,"bad")["actions"][0]
    assert "Envie MENU" not in response["content"]
    assert response["buttons"][-1]["title"]=="Retornar ao menu"
