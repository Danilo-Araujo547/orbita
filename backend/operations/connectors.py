import re
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone
from scheduling.connectors import OracleSource, normalize_phone

from operations.models import Campaign, Case, Contact, FlowRun, SourceEvent
from operations.services import log, preview_campaign


def source_view(configuration):
    if not configuration.verified or not re.fullmatch(
        r"[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*", configuration.view_name
    ):
        raise ValueError("source_not_verified")
    return configuration.view_name


def fetch_postoperative(rule, target):
    if rule.source.kind != "postoperative" or rule.purpose != "postoperative":
        raise ValueError("unsupported_source_contract")
    view = source_view(rule.source)
    with OracleSource(rule.unit).connect() as connection:
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION READ ONLY")
                cursor.execute(
                    f"SELECT CD_PRINCIPAL, PRONTUARIO, PACIENTE, TELEFONE, CIRURGIA, DATA_REALIZADO, PRESTADOR FROM {view} WHERE DATA_REALIZADO = :target_date",
                    target_date=target.strftime("%d/%m/%Y"),
                )
                rows = cursor.fetchmany(10001)
                if len(rows) > 10000:
                    raise ValueError("source_row_limit")
                return rows
        finally:
            connection.rollback()


def run_flow(rule, now=None, fetcher=fetch_postoperative):
    now = now or timezone.now()
    local = timezone.localtime(now, ZoneInfo(rule.unit.timezone))
    if (
        not rule.enabled
        or not rule.evidence
        or not rule.source.verified
        or local.weekday() not in rule.weekdays
        or local.time() < rule.send_time
    ):
        return None
    run, created = FlowRun.objects.get_or_create(unit=rule.unit, rule=rule, run_date=local.date())
    if not created:
        return run
    try:
        rows = fetcher(rule, local.date() - timedelta(days=rule.days_after))
        with transaction.atomic():
            campaign = Campaign.objects.create(
                unit=rule.unit,
                name=f"{rule.name} · {local.date()}",
                purpose=rule.purpose,
                template=rule.template,
                scheduled_for=now,
            )
            seen = {}
            for principal, record, patient, phone, surgery, performed, professional in rows:
                phone = normalize_phone(phone)
                identity = f"{principal}|{record}|{performed}"
                data = {"procedure": str(surgery), "surgery": str(surgery), "professional": str(professional)}
                value = (str(patient), phone, str(performed), data)
                if identity in seen and seen[identity] != value:
                    raise ValueError("ambiguous_source_record")
                seen[identity] = value
                day = datetime.strptime(str(performed), "%d/%m/%Y").date()
                event, _ = SourceEvent.objects.get_or_create(
                    unit=rule.unit,
                    source=f"oracle:{rule.source_id}",
                    kind="postoperative",
                    external_id=identity,
                    defaults={
                        "patient": str(patient),
                        "phone": phone,
                        "occurred_at": datetime.combine(day, time.min, ZoneInfo(rule.unit.timezone)),
                        "data": data,
                    },
                )
                if event.phone != phone or event.patient != str(patient):
                    raise ValueError("ambiguous_source_record")
                case, new = Case.objects.get_or_create(unit=rule.unit, event=event, purpose=rule.purpose)
                if new:
                    log(
                        case,
                        "imported",
                        "Procedimento importado em modo de análise.",
                        data={"rule": rule.code, "version": rule.version},
                    )
                Contact.objects.get_or_create(unit=rule.unit, event=event, phone=phone)
                campaign.cases.add(case)
            preview_campaign(campaign)
            run.state, run.count = "completed", len(seen)
    except Exception as exc:
        run.state = "failed"
        safe = str(exc)
        run.error_code = (
            safe
            if safe
            in {
                "source_not_verified",
                "unsupported_source_contract",
                "oracle_not_configured",
                "source_row_limit",
                "ambiguous_source_record",
                "invalid_phone_format",
            }
            else "source_import_failed"
        )
    run.completed_at = timezone.now()
    run.save()
    return run
