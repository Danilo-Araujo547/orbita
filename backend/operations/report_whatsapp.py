"""Report-only Baileys transport and permission-scoped parameter dialogue."""

import base64
import hashlib
import json
import re
import secrets
import urllib.error
import urllib.request
from datetime import datetime
from types import SimpleNamespace

from celery import shared_task
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.access import SectionPermission, local_permissions
from core.models import Audit
from core.permissions import get_unit
from operations.models import (
    ReportConversation,
    ReportExecution,
    ReportGrant,
    ReportInboundReceipt,
    ReportRecipient,
    ReportWhatsAppConfiguration,
)
from operations.report_engine import parameters, report_filename
from operations.reporting import execution_access, grant_for, readiness
from operations.services import Conflict, idempotent


def service(unit, action="", data=None):
    if not settings.REPORT_BAILEYS_TOKEN:
        raise ValidationError("Serviço WhatsApp não configurado.")
    url = f"{settings.REPORT_BAILEYS_URL}/sessions/{unit.pk}" + (
        f"/{action}" if action else ""
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(data or {}).encode() if action else None,
        headers={
            "Authorization": f"Bearer {settings.REPORT_BAILEYS_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST" if action else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise ValidationError(
            "Serviço WhatsApp indisponível ou operação bloqueada."
        ) from None


def allowed(config, mode):
    return bool(
        settings.REPORT_BAILEYS_ALLOW_SENDS
        and config
        and config.sends_enabled
        and getattr(config, f"{mode}_enabled", False)
    )


class ConfigurationInput(serializers.Serializer):
    menu_title = serializers.CharField(max_length=60, required=False)
    menu_button = serializers.CharField(max_length=20, required=False)
    menu_section = serializers.CharField(max_length=24, required=False)
    version = serializers.IntegerField(min_value=1)
    greeting = serializers.CharField(max_length=1000)
    sends_enabled = serializers.BooleanField(default=False)
    manual_enabled = serializers.BooleanField(default=False)
    automatic_enabled = serializers.BooleanField(default=False)


class ChannelLogOutput(serializers.Serializer):
    id = serializers.IntegerField()
    time = serializers.DateTimeField()
    event = serializers.CharField()


class ChannelStatusOutput(serializers.Serializer):
    state = serializers.CharField()
    account = serializers.CharField(required=False, allow_blank=True)
    qr = serializers.CharField(allow_null=True, required=False)
    qr_expires_at = serializers.IntegerField(allow_null=True, required=False)
    sends_enabled = serializers.BooleanField(required=False)
    logs = ChannelLogOutput(many=True)


class ChannelOutput(serializers.Serializer):
    configuration = ConfigurationInput()
    global_sends_enabled = serializers.BooleanField()
    status = ChannelStatusOutput()


class ChannelActionOutput(serializers.Serializer):
    version = serializers.IntegerField(required=False)
    state = serializers.CharField(required=False)


class ChannelActionInput(serializers.Serializer):
    menu_title = serializers.CharField(max_length=60, required=False)
    menu_button = serializers.CharField(max_length=20, required=False)
    menu_section = serializers.CharField(max_length=24, required=False)
    action = serializers.ChoiceField(choices=["connect", "disconnect", "configure"])
    version = serializers.IntegerField(min_value=1, required=False)
    greeting = serializers.CharField(max_length=1000, required=False)
    sends_enabled = serializers.BooleanField(required=False)
    manual_enabled = serializers.BooleanField(required=False)
    automatic_enabled = serializers.BooleanField(required=False)


class ReportWhatsAppView(APIView):
    permission_classes = (SectionPermission,)

    @extend_schema(responses=ChannelOutput)
    def get(self, request):
        unit = get_unit(request, ["admin"])
        config, _ = ReportWhatsAppConfiguration.objects.get_or_create(unit=unit)
        try:
            status = service(unit)
        except ValidationError:
            status = {"state": "unavailable", "qr": None, "logs": []}
        return Response(
            {
                "configuration": {
                    f: getattr(config, f)
                    for f in (
                        "version",
                        "greeting",
                        "menu_title", "menu_button", "menu_section",
                        "sends_enabled",
                        "manual_enabled",
                        "automatic_enabled",
                    )
                },
                "global_sends_enabled": settings.REPORT_BAILEYS_ALLOW_SENDS,
                "status": status,
            },
            headers={"Cache-Control": "no-store"},
        )

    @extend_schema(request=ChannelActionInput, responses=ChannelActionOutput)
    def post(self, request):
        unit = get_unit(request, ["admin"])
        inp = ChannelActionInput(data=request.data)
        inp.is_valid(raise_exception=True)

        def perform():
            with transaction.atomic():
                config, _ = (
                    ReportWhatsAppConfiguration.objects.select_for_update().get_or_create(
                        unit=unit
                    )
                )
                action = inp.validated_data["action"]
                if action == "configure":
                    data = ConfigurationInput(data=inp.validated_data)
                    data.is_valid(raise_exception=True)
                    data = data.validated_data
                    if config.version != data["version"]:
                        raise Conflict("Configuração alterada por outro administrador.")
                    if not settings.REPORT_BAILEYS_ALLOW_SENDS and any(
                        data[k]
                        for k in (
                            "sends_enabled",
                            "manual_enabled",
                            "automatic_enabled",
                        )
                    ):
                        raise ValidationError("Envios bloqueados no ambiente.")
                    for key in (
                        "greeting",
                        "menu_title", "menu_button", "menu_section",
                        "sends_enabled",
                        "manual_enabled",
                        "automatic_enabled",
                    ):
                        setattr(config, key, data.get(key, getattr(config, key)))
                    config.version += 1
                    config.save()
                    result = {"version": config.version}
                else:
                    result = service(unit, action)
                Audit.objects.create(
                    unit=unit,
                    actor=request.user,
                    action="report_whatsapp_" + action,
                    details={"version": config.version},
                )
                return result

        return Response(
            idempotent(
                unit,
                request.user,
                request.headers.get("Idempotency-Key"),
                {"path": request.path, "data": inp.validated_data},
                perform,
            )
        )


class InboundInput(serializers.Serializer):
    unit_id = serializers.IntegerField(min_value=1)
    message_id = serializers.RegexField(r"^[a-zA-Z0-9:_.-]{1,180}$")
    address = serializers.CharField(max_length=100)
    is_group = serializers.BooleanField(default=False)
    text = serializers.CharField(
        max_length=4000, allow_blank=True, trim_whitespace=False
    )
    timestamp = serializers.IntegerField(min_value=1)


class ReportWhatsAppInboundView(APIView):
    authentication_classes = ()
    permission_classes = ()

    @extend_schema(exclude=True)
    def post(self, request):
        expected = settings.REPORT_BAILEYS_TOKEN
        if not expected or not secrets.compare_digest(
            request.headers.get("Authorization", ""), f"Bearer {expected}"
        ):
            raise PermissionDenied("Não autorizado.")
        inp = InboundInput(data=request.data)
        inp.is_valid(raise_exception=True)
        return Response(handle_inbound(inp.validated_data))


def canonical_address(value, group=False):
    if group:
        return value if re.fullmatch(r"[0-9-]{5,90}@g\.us", value) else None
    from scheduling.connectors import normalize_phone

    try:
        return normalize_phone(value)
    except ValueError:
        return None


def eligible_grants(unit, address, group):
    result = []
    # Duplicate recipient identities are ambiguous, never merge their grants.
    recipients = list(
        ReportRecipient.objects.filter(
            unit=unit,
            kind="group" if group else "phone",
            active=True,
            manual_enabled=True,
            verified_at__isnull=False,
        ).select_related("user")
    )
    matches = [r for r in recipients if canonical_address(r.address, group) == address]
    if len(matches) != 1:
        return []
    recipient = matches[0]
    if recipient.user and (
        not recipient.user.is_active
        or local_permissions(recipient.user, unit).get("reports", "none") == "none"
    ):
        return []
    for grant in ReportGrant.objects.filter(
        unit=unit,
        recipient=recipient,
        active=True,
        manual=True,
        report__enabled=True,
        report__manual_enabled=True,
        report__review_queue=False,
        report__catalog_kind="report",
    ).select_related("report__connection", "recipient__user"):
        try:
            grant_for(grant.report, recipient, "manual")
            if not readiness(grant.report):
                from operations.report_parameters import normalized_schema

                grant.report.parameter_schema = normalized_schema(
                    grant.report.parameter_schema
                )
                result.append(grant)
        except PermissionDenied:
            continue
    return sorted(result, key=lambda g: (g.report.name.casefold(), g.pk))[:50]


def ordered_parameters(report):
    schema = report.parameter_schema
    keys = sorted(schema, key=lambda key: (schema[key].get("order", 10000), key))
    dependencies = {key: schema[key].get("not_before") for key in keys}
    for start, end in [
        ("data_inicial", "data_final"),
        ("inicio", "fim"),
        ("data_inicio", "data_fim"),
        ("start_date", "end_date"),
        ("start", "end"),
    ]:
        if (
            start in schema
            and end in schema
            and schema[start].get("type") == schema[end].get("type") == "date"
        ):
            dependencies[end] = dependencies[end] or start
    ordered = []
    while keys:
        eligible = next(
            (
                key
                for key in keys
                if not dependencies[key] or dependencies[key] in ordered
            ),
            None,
        )
        if eligible is None:
            raise ValidationError(
                "Os parâmetros possuem uma dependência circular ou inexistente."
            )
        keys.remove(eligible)
        ordered.append(eligible)
    return ordered


def parameter_label(name):
    return {"start":"data inicial", "start_date":"data inicial", "end":"data final", "end_date":"data final", "data_inicial":"data inicial", "data_final":"data final"}.get(name.casefold(), name.replace("_", " "))


def prompt(name, spec):
    custom = spec.get("prompt", "")
    if custom:
        custom = re.sub(r"(?i)\bstart[ _]date\b", "data inicial", custom)
        custom = re.sub(r"(?i)\bend[ _]date\b", "data final", custom)
        custom = re.sub(r"(?i)AAAA[-/]MM[-/]DD|YYYY[-/]MM[-/]DD|MM/DD/YYYY|DD/MM/YYYY", "DD/MM/AAAA", custom)
        custom = re.sub(r"(?i)\s*(?:Em branco\s*:\s*hoje\.?|Opcional\s*:\s*responda PULAR para deixar em branco\.?|Para ignorar, responda PULAR\.?)", "", custom)
        text = custom.strip()
    else:
        label = parameter_label(name)
        text = f"Informe a {label} no formato DD/MM/AAAA." if spec.get("type") == "date" else f"Informe {label}."
    if spec.get("type") == "date":
        if "DD/MM/AAAA" not in text.upper():
            text += " Use DD/MM/AAAA."
        text = re.sub(r"\**DD/MM/AAAA\**", "*DD/MM/AAAA*", text, flags=re.I)
    return text


def menu_row(grant, selection_id):
    name = grant.report.name.strip()
    if len(name) <= 24:
        return {"rowId": selection_id, "title": name, "description": ""}
    split = name.rfind(" ", 0, 25)
    split = split if split > 0 else 24
    return {"rowId": selection_id, "title": name[:split], "description": name[split:].strip()[:72]}


def parameter_value(name, spec, text):
    if text.strip().casefold() in {"pular", ""} and spec.get("required") is False:
        value = spec.get("default")
    elif spec["type"] == "date":
        if not re.fullmatch(r"\d{2}/\d{2}/\d{4}", text):
            raise ValidationError("Data inválida. Use DD/MM/AAAA.")
        try:
            value = datetime.strptime(text, "%d/%m/%Y").date().isoformat()
        except ValueError:
            raise ValidationError("Data inválida. Use DD/MM/AAAA.") from None
    else:
        value = text
    # A single answer validates its own type; the completed conversation checks date relationships.
    single_spec = {key: item for key, item in spec.items() if key != "not_before"}
    parameters(SimpleNamespace(parameter_schema={name: single_spec}), {name: value})
    return value


def conversation_result(config, convo, grants, text, event):
    def say(value):
        digest = hashlib.sha256(event["message_id"].encode()).hexdigest()
        return {
            "actions": [
                {
                    "key": f"inbound:{digest}",
                    "to": convo.address,
                    "kind": "buttons",
                    "content": value[:15000],
                    "buttons": [{"id":"scv:menu", "title":"Retornar ao menu"}],
                }
            ]
        }

    def ask_date_or_value(name, spec, prefix=""):
        result = say(prefix + prompt(name, spec))
        convo.data.pop("date_choices", None)
        if spec.get("type") == "date":
            nonce = secrets.token_hex(8)
            choices = {f"scv:date:{nonce}:today":"today", f"scv:date:{nonce}:yesterday":"yesterday"}
            convo.data["date_choices"] = {"parameter":name, "choices":choices}
            result["actions"][0].update(kind="buttons", buttons=[
                {"id":next(k for k,v in choices.items() if v=="today"), "title":"Hoje"},
                {"id":next(k for k,v in choices.items() if v=="yesterday"), "title":"Ontem"},
                {"id":"scv:menu", "title":"Retornar ao menu"}])
        return result

    def menu(page=0):
        page = max(0, min(page, (len(grants)-1)//8))
        nonce = secrets.token_hex(8)
        choices = {f"scv:report:{nonce}:{g.pk}": g.pk for g in grants[page*8:(page+1)*8]}
        navigation = {}
        rows = [menu_row(g, key) for key, g in zip(choices, grants[page*8:(page+1)*8])]
        for target, label in ((page-1, "Anterior"), (page+1, "Mais relatórios")):
            if 0 <= target <= (len(grants)-1)//8:
                key = f"scv:page:{nonce}:{target}"
                navigation[key] = target
                rows.append({"rowId": key, "title": label, "description": "Outra página de relatórios"})
        convo.data = {"choices": choices, "navigation": navigation}
        result = say(config.greeting)
        result["actions"][0].update(kind="list", title=config.menu_title, button=config.menu_button,
            sections=[{"title":config.menu_section,"rows":rows}])
        return result

    if text == "scv:menu":
        text = "menu"
    if not grants:
        convo.data = {}
        return say("Nenhum relatório disponível para este contato.")
    repeat_grant = None
    if text.startswith(("scv:again:", "scv:new:")):
        from operations.models import ReportExecution
        requested_id = text.split(":", 2)[2]
        previous = ReportExecution.objects.filter(unit=config.unit, pk=requested_id,
            recipient_id__in=[g.recipient_id for g in grants], state="ready").select_related("report__connection", "recipient", "unit", "requester", "automation").first() if re.fullmatch(r"[a-f0-9-]{36}", requested_id) else None
        if not previous or previous.delivery_state not in {"sent_baileys", "no_data"}:
            return menu()
        try:
            execution_access(previous)
        except (PermissionDenied, ValidationError):
            return menu()
        if text.startswith("scv:new:"):
            return menu()
        repeat_grant = next((g for g in grants if g.report_id == previous.report_id and g.recipient_id == previous.recipient_id), None)
        if not repeat_grant:
            return menu()
        convo.data = {"choices": {text: repeat_grant.pk}}
    if (
        text.casefold() in {"menu", "relatorios", "relatórios", "cancelar"}
        or not convo.data
    ):
        return menu()
    if "grant" not in convo.data:
        selected = None
        if text in convo.data.get("navigation", {}):
            return menu(convo.data["navigation"][text])
        selected_id = convo.data.get("choices", {}).get(text)
        if selected_id is not None:
            selected = next((g for g in grants if g.pk == selected_id), None)
        elif not text.startswith("scv:") and not text.isdigit():
            matched = [
                g
                for g in grants
                if text.casefold()
                in [k.casefold() for k in [g.report.keyword, *g.report.keywords] if k]
            ]
            if len(matched) == 1:
                selected = matched[0]
        if not selected:
            return menu()
        report = selected.report
        convo.data = {
            "grant": selected.pk,
            "definition_version": report.version,
            "grant_version": selected.version,
            "recipient_version": selected.recipient.version,
            "values": {},
        }
        intro = report.request_message.strip()
    else:
        selected = next((g for g in grants if g.pk == convo.data["grant"]), None)
        if not selected or any(
            convo.data.get(k) != v
            for k, v in [
                ("definition_version", selected.report.version),
                ("grant_version", selected.version),
                ("recipient_version", selected.recipient.version),
            ]
        ):
            return menu()
        report = selected.report
        intro = ""
        pending = [
            k
            for k in ordered_parameters(report)
            if k not in selected.parameters and k not in convo.data["values"]
        ]
        if pending:
            key = pending[0]
            date_choice = convo.data.get("date_choices", {})
            if text.startswith("scv:date:"):
                shortcut = date_choice.get("choices", {}).get(text)
                if date_choice.get("parameter") != key or shortcut not in {"today", "yesterday"}:
                    return ask_date_or_value(key, report.parameter_schema[key])
                from zoneinfo import ZoneInfo
                reference = timezone.localtime(timezone.now(), ZoneInfo(config.unit.timezone)).date()
                if shortcut == "yesterday":
                    reference -= timezone.timedelta(days=1)
                text = reference.strftime("%d/%m/%Y")
            try:
                convo.data["values"][key] = parameter_value(
                    key, report.parameter_schema[key], text
                )
            except ValidationError:
                return ask_date_or_value(key, report.parameter_schema[key], "Valor inválido. ")
    pending = [
        k
        for k in ordered_parameters(report)
        if k not in selected.parameters and k not in convo.data["values"]
    ]
    if pending:
        return ask_date_or_value(pending[0], report.parameter_schema[pending[0]], intro + "\n\n" if intro else "")
    values = {**convo.data["values"], **selected.parameters}
    date_keys = [
        k for k, v in report.parameter_schema.items() if v.get("type") == "date"
    ]
    # Explicit ranges use start/end keys, not arbitrary dates in dictionary order.
    ranges = [
        ("data_inicial", "data_final"),
        ("inicio", "fim"),
        ("data_inicio", "data_fim"),
        ("start_date", "end_date"),
        ("start", "end"),
    ]
    ranges += [
        (v["not_before"], k)
        for k, v in report.parameter_schema.items()
        if v.get("not_before")
    ]
    for start, end in ranges:
        if (
            start in date_keys
            and end in date_keys
            and values.get(start)
            and values.get(end)
            and values[start] > values[end]
        ):
            convo.data["values"].pop(end, None)
            return ask_date_or_value(end, report.parameter_schema[end], "A data final deve ser igual ou posterior à inicial. ")
    from operations.reporting import enqueue, make_execution

    job = make_execution(
        report,
        values,
        user=selected.recipient.user,
        recipient=selected.recipient,
        origin="whatsapp",
        transport="baileys",
    )
    job.snapshot.update(inbound_event=event["message_id"])
    job.save(update_fields=["snapshot"])
    enqueue(job)
    convo.data = {"last_job": str(job.pk)}
    return say(
        (intro + "\n\n" if intro else "") + "Solicitação registrada. Gerando relatório."
    )


def policy_fingerprint(config, address, group):
    grants = eligible_grants(config.unit, address, group)
    data = [
        config.version,
        address,
        group,
        [
            (
                g.pk,
                g.version,
                g.report.version,
                g.recipient.version,
                g.report.connection.version if g.report.connection_id else None,
            )
            for g in grants
        ],
    ]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


class DeliveryAuthorizationInput(serializers.Serializer):
    unit_id = serializers.IntegerField(min_value=1)
    key = serializers.CharField(max_length=180)
    to = serializers.CharField(max_length=100)
    mode = serializers.ChoiceField(choices=["manual", "automatic"], default="manual")
    event_id = serializers.CharField(max_length=180, required=False)
    policy = serializers.CharField(max_length=64, required=False)


class ReportWhatsAppAuthorizeView(APIView):
    authentication_classes = ()
    permission_classes = ()

    @extend_schema(exclude=True)
    def post(self, request):
        expected = settings.REPORT_BAILEYS_TOKEN
        if not expected or not secrets.compare_digest(
            request.headers.get("Authorization", ""), f"Bearer {expected}"
        ):
            raise PermissionDenied("Não autorizado.")
        inp = DeliveryAuthorizationInput(data=request.data)
        inp.is_valid(raise_exception=True)
        return Response({"allowed": authorize_delivery(inp.validated_data)})


def authorize_delivery(data):
    config = ReportWhatsAppConfiguration.objects.filter(unit_id=data["unit_id"]).first()
    if not allowed(config, data["mode"]):
        return False
    group = data["to"].endswith("@g.us")
    address = canonical_address(data["to"], group)
    if not address:
        return False
    if data["key"].startswith("inbound:") and data["mode"] == "manual":
        receipt = ReportInboundReceipt.objects.filter(
            unit=config.unit, message_id=data.get("event_id", "")
        ).first()
        return bool(
            receipt
            and data.get("policy") == policy_fingerprint(config, address, group)
            and any(
                a.get("key") == data["key"]
                and a.get("to") == address
                and a.get("policy") == data.get("policy")
                for a in receipt.result.get("actions", [])
            )
        )
    feedback = data["key"].startswith("report-feedback:")
    if not feedback and not data["key"].startswith("report:"):
        return False
    try:
        job = ReportExecution.objects.select_related(
            "unit", "report__connection", "recipient__user", "requester", "automation"
        ).get(
            pk=data["key"].split(":", 1)[1],
            unit=config.unit,
            state="ready",
        )
        if feedback:
            if job.origin != "whatsapp" or job.delivery_state not in {"sent_baileys", "no_data"} or job.snapshot.get("feedback_state") != "sending":
                return False
        elif job.delivery_state != "sending_baileys":
            return False
        if (
            not job.recipient_id
            or job.snapshot.get("transport") != "baileys"
            or data["mode"] != ("automatic" if job.origin == "automatic" else "manual")
        ):
            return False
        if address != canonical_address(
            job.recipient.address, job.recipient.kind == "group"
        ):
            return False
        execution_access(job)
        return not (
            job.recipient.user
            and (
                not job.recipient.user.is_active
                or local_permissions(job.recipient.user, job.unit).get(
                    "reports", "none"
                )
                == "none"
            )
        )
    except (
        ReportExecution.DoesNotExist,
        PermissionDenied,
        ValidationError,
        DjangoValidationError,
        ValueError,
    ):
        return False


def handle_inbound(event):
    with transaction.atomic():
        config = (
            ReportWhatsAppConfiguration.objects.select_for_update()
            .filter(unit_id=event["unit_id"])
            .first()
        )
        if not config:
            return {"disabled": True, "actions": []}
        existing = ReportInboundReceipt.objects.filter(
            unit=config.unit, message_id=event["message_id"]
        ).first()
        if existing:
            if not allowed(config, "manual"):
                return {"disabled": True, "actions": []}
            current_policy = policy_fingerprint(
                config,
                canonical_address(event["address"], event["is_group"]),
                event["is_group"],
            )
            if any(
                a.get("policy") != current_policy
                for a in existing.result.get("actions", [])
            ):
                return {"actions": []}
            return existing.result
        result = {"disabled": True, "actions": []}
        if allowed(config, "manual"):
            address = canonical_address(event["address"], event["is_group"])
            now = timezone.now()
            if address and abs(now.timestamp() - event["timestamp"]) <= 30 * 60:
                convo, _ = ReportConversation.objects.select_for_update().get_or_create(
                    unit=config.unit,
                    address=address,
                    defaults={"is_group": event["is_group"], "expires_at": now},
                )
                if event["timestamp"] >= convo.last_timestamp:
                    if convo.expires_at <= now:
                        convo.data = {}
                    try:
                        result = conversation_result(
                            config,
                            convo,
                            eligible_grants(config.unit, address, event["is_group"]),
                            event["text"].strip(),
                            event,
                        )
                    except (ValidationError, PermissionDenied):
                        convo.data = {}
                        result = {
                            "actions": [
                                {
                                    "key": "inbound:"
                                    + hashlib.sha256(
                                        event["message_id"].encode()
                                    ).hexdigest(),
                                    "to": convo.address,
                                    "kind": "buttons",
                                    "content": "Relatório indisponível.",
                                    "buttons": [{"id":"scv:menu", "title":"Retornar ao menu"}],
                                }
                            ]
                        }
                    convo.expires_at = now + timezone.timedelta(minutes=30)
                    convo.last_timestamp = event["timestamp"]
                    convo.save()
        if result.get("actions"):
            fingerprint = policy_fingerprint(
                config,
                canonical_address(event["address"], event["is_group"]),
                event["is_group"],
            )
            for action in result["actions"]:
                action.update(
                    policy=fingerprint, event_id=event["message_id"], mode="manual"
                )
        ReportInboundReceipt.objects.create(
            unit=config.unit, message_id=event["message_id"], result=result
        )
        return result


@shared_task(
    name="operations.deliver_report_baileys", soft_time_limit=40, time_limit=50
)
def deliver_report(job_id):
    with transaction.atomic():
        job = (
            ReportExecution.objects.select_for_update(of=("self",))
            .select_related(
                "unit",
                "report__connection",
                "recipient__user",
                "requester",
                "automation",
            )
            .get(pk=job_id)
        )
        if (
            job.snapshot.get("transport") != "baileys"
            or job.state != "ready"
            or job.delivery_state not in {"pending_baileys", "blocked_baileys_disabled"}
        ):
            return
        config = ReportWhatsAppConfiguration.objects.filter(unit=job.unit).first()
        if not allowed(config, "automatic" if job.origin == "automatic" else "manual"):
            job.delivery_state = "blocked_baileys_disabled"
            job.save(update_fields=["delivery_state"])
            return
        try:
            execution_access(job)
            if job.recipient.user and (
                not job.recipient.user.is_active
                or local_permissions(job.recipient.user, job.unit).get(
                    "reports", "none"
                )
                == "none"
            ):
                raise PermissionDenied()
        except PermissionDenied:
            job.delivery_state = "blocked_access_changed"
            job.save(update_fields=["delivery_state"])
            return
        to = canonical_address(job.recipient.address, job.recipient.kind == "group")
        if not to:
            job.delivery_state = "invalid_recipient"
            job.save(update_fields=["delivery_state"])
            return
        if job.row_count == 0 and job.snapshot.get("no_data"):
            job.delivery_state = "no_data"
            job.save(update_fields=["delivery_state"])
            transaction.on_commit(lambda: send_report_feedback(job.pk))
            return
        job.delivery_state = "sending_baileys"
        job.save(update_fields=["delivery_state"])
        payload = {
            "key": f"report:{job.pk}",
            "mode": "automatic" if job.origin == "automatic" else "manual",
            "to": to,
            "kind": "document",
            "content": job.result
            if job.format in {"pdf", "xlsx"}
            else base64.b64encode(job.result.encode()).decode(),
            "filename": report_filename(job.report.name + (" - Legado" if job.snapshot.get("data_origin") == "legacy" else ""), job.format),
            "mime": {"pdf": "application/pdf", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "csv": "text/csv", "text": "text/plain"}[
                job.format
            ],
        }
    try:
        result = service(job.unit, "send", payload)
        job.delivery_state = (
            "sent_baileys"
            if result.get("state") == "sent"
            else "blocked_access_changed"
            if result.get("state") == "blocked"
            else "uncertain_baileys"
        )
        job.snapshot["baileys_provider_id"] = result.get("provider_id", "")
    except ValidationError:
        # A lost response may mean a successful send. Never retry automatically.
        job.delivery_state = "uncertain_baileys"
    job.save(update_fields=["delivery_state", "snapshot"])
    if job.delivery_state == "sent_baileys":
        send_report_feedback(job.pk)


def report_delivery_feedback(job):
    if job.delivery_state == "no_data":
        return "Não existem dados para a data selecionada."
    message = "Relatório enviado."
    if job.snapshot.get("data_origin") == "legacy":
        message += " Histórico legado (produção)."
        missing = job.snapshot.get("missing_dates", [])
        if missing:
            message += " Sem snapshot em " + ", ".join(day[8:10]+"/"+day[5:7]+"/"+day[:4] for day in missing[:8])
            if len(missing) > 8: message += f" e mais {len(missing)-8} datas"
            message += "."
    return message


def send_report_feedback(job_id):
    with transaction.atomic():
        job = ReportExecution.objects.select_for_update(of=("self",)).select_related("report__connection", "recipient__user", "requester", "unit", "automation").get(pk=job_id)
        if job.origin != "whatsapp" or job.delivery_state not in {"sent_baileys", "no_data"} or job.snapshot.get("feedback_state"):
            return
        execution_access(job)
        config = ReportWhatsAppConfiguration.objects.get(unit=job.unit)
        if not allowed(config, "manual"):
            return
        job.snapshot["feedback_state"] = "sending"
        job.save(update_fields=["snapshot"])
        payload = {"key":f"report-feedback:{job.pk}", "mode":"manual",
            "to":canonical_address(job.recipient.address, job.recipient.kind == "group"),
            "kind":"buttons", "content":report_delivery_feedback(job),
            "buttons":[{"id":f"scv:again:{job.pk}", "title":"Solicitar novamente"}, {"id":"scv:menu", "title":"Retornar ao menu"}]}
    try:
        response = service(job.unit, "send", payload)
        state = response.get("state", "uncertain")
    except ValidationError:
        state = "uncertain"
    job.refresh_from_db()
    job.snapshot["feedback_state"] = state
    job.save(update_fields=["snapshot"])


def enqueue_delivery(job):
    if job.snapshot.get("transport") == "baileys" and job.state == "ready":
        if settings.ASYNC_TASKS:
            transaction.on_commit(lambda: deliver_report.delay(str(job.pk)))
        else:
            deliver_report(job.pk)
