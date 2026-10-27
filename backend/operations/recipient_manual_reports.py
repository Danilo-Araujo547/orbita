"""Bulk manual permissions per WhatsApp recipient. Automatic grants are preserved."""
import hashlib
import json
from django.db.models import Q
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiParameter, extend_schema
from core.models import Audit
from core.permissions import get_unit
from operations.models import ReportDefinition, ReportGrant
from operations.services import Conflict


def grants_token(recipient):
    rows = list(ReportGrant.objects.filter(unit=recipient.unit, recipient=recipient).order_by("pk").values("id", "report_id", "version", "manual", "automatic", "active", "parameters"))
    return hashlib.sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()


def manual_ids(recipient):
    return list(ReportGrant.objects.filter(unit=recipient.unit, recipient=recipient, report__unit=recipient.unit, report__catalog_kind="report", active=True, manual=True).order_by("report_id").values_list("report_id", flat=True))


def set_manual_reports(recipient, ids, token, actor, *, created=False, inactive_ids=None):
    inactive_ids = [] if inactive_ids is None else inactive_ids
    tracked = [*ids, *inactive_ids]
    if len(tracked) > 500 or len(set(tracked)) != len(tracked):
        raise ValidationError("Selecione relatórios únicos; limite de 500.")
    # Caller holds the existing recipient/configuration unit lock and transaction.
    current = list(ReportGrant.objects.select_for_update().filter(unit=recipient.unit, recipient=recipient).select_related("report"))
    if not created and token != grants_token(recipient):
        raise Conflict("As permissões foram alteradas. Reabra o destinatário antes de salvar.")
    allowed = set(ReportDefinition.objects.filter(unit=recipient.unit, catalog_kind="report", manual_enabled=True, review_queue=False, pk__in=ids).values_list("pk", flat=True))
    allowed.update(g.report_id for g in current if g.active and g.manual and g.report.unit_id == recipient.unit_id and g.report.catalog_kind == "report" and g.report_id in ids)
    if allowed != set(ids):
        raise ValidationError("Selecione apenas relatórios manuais desta unidade; componentes não são permitidos.")
    inactive_existing = {g.report_id for g in current if g.manual and not g.active and g.report.unit_id == recipient.unit_id and g.report.catalog_kind == "report"}
    if not set(inactive_ids).issubset(inactive_existing):
        raise ValidationError("Permissão desativada não corresponde ao cadastro anterior. Reabra o destinatário.")
    before = set(manual_ids(recipient))
    existing = {g.report_id: g for g in current}
    automatic_kept_disabled = []
    for report_id in ids:
        grant = existing.get(report_id)
        if grant is not None:
            if (not grant.active or not grant.manual) and grant.legacy.get("record", {}).get("PARAMETRO1") not in (None, "", "<NULL>") and not grant.parameters:
                raise ValidationError("Mapeie os parâmetros restritivos antes de liberar este relatório: " + grant.report.name)
            if not grant.manual or not grant.active:
                # The shared active flag must not reactivate a previously disabled
                # automatic permission when only manual access is being granted.
                if not grant.active:
                    if grant.automatic:
                        automatic_kept_disabled.append(report_id)
                    grant.automatic = False
                grant.manual = grant.active = True
                grant.version += 1
                grant.save(update_fields=["manual", "automatic", "active", "version"])
        else:
            ReportGrant.objects.create(unit=recipient.unit, recipient=recipient, report_id=report_id, manual=True, automatic=False, active=True)
    for grant in current:
        if grant.report_id not in tracked and grant.manual and grant.report.unit_id == recipient.unit_id and grant.report.catalog_kind == "report":
            grant.manual = False
            if not grant.automatic:
                grant.active = False
            grant.version += 1
            grant.save(update_fields=["manual", "active", "version"])
    Audit.objects.create(unit=recipient.unit, actor=actor, action="report_recipient.manual_reports_configured", object_id=str(recipient.pk), details={"added": sorted(set(ids)-before), "removed": sorted(before-set(ids)), "automatic_kept_disabled": sorted(automatic_kept_disabled), "inactive_preserved": sorted(inactive_ids), "inactive_removed": sorted(inactive_existing-set(tracked))})


class ManualReportsOutput(serializers.Serializer):
    selected = serializers.ListField(child=serializers.IntegerField())
    inactive = serializers.ListField(child=serializers.IntegerField())
    reports = serializers.ListField(child=serializers.JSONField())
    token = serializers.CharField()


class ManualReportOptionOutput(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    code = serializers.CharField()
    enabled = serializers.BooleanField()
    manual_enabled = serializers.BooleanField()


class RecipientManualReportsMixin:
    @extend_schema(parameters=[OpenApiParameter("search", str)], responses=ManualReportOptionOutput(many=True))
    @action(detail=False, methods=["get"], url_path="manual-report-options")
    def manual_report_options(self, request):
        unit = get_unit(request, ["admin"])
        search = request.query_params.get("search", "").strip()
        qs = ReportDefinition.objects.filter(unit=unit, catalog_kind="report", manual_enabled=True, review_queue=False).order_by("name", "pk")
        qs = qs.filter(Q(name__icontains=search) | Q(code__icontains=search)) if len(search) >= 2 else qs.none()
        page = self.paginate_queryset(qs)
        return self.get_paginated_response([{"id":r.pk, "name":r.name, "code":r.code, "enabled":r.enabled, "manual_enabled":r.manual_enabled} for r in page])

    @extend_schema(responses=ManualReportsOutput)
    @action(detail=True, methods=["get"], url_path="manual-reports")
    def manual_reports(self, request, pk=None):
        get_unit(request, ["admin"])
        recipient = self.get_object()
        grants = ReportGrant.objects.filter(unit=recipient.unit, recipient=recipient, report__unit=recipient.unit, report__catalog_kind="report", manual=True).select_related("report").order_by("report__name", "report_id")
        cards = [{"id":g.report_id, "name":g.report.name, "code":g.report.code, "enabled":g.report.enabled, "manual_enabled":g.report.manual_enabled, "permission_active":g.active} for g in grants]
        return Response({"selected": [r["id"] for r in cards if r["permission_active"]], "inactive":[r["id"] for r in cards if not r["permission_active"]], "reports":cards, "token": grants_token(recipient)})
