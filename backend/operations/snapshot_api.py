"""Administrator-only collection controls, separate from report delivery schedules."""
from django.shortcuts import get_object_or_404
from django.db.models import Q
from drf_spectacular.utils import extend_schema, OpenApiParameter, extend_schema_view, PolymorphicProxySerializer
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError

from core.permissions import get_unit
from operations import models as m
from operations.bed_snapshots import HANDLER, definition, queue_collection
from operations.report_api import Managed, ReportCatalogVersionInput
from operations.services import Conflict


class SnapshotRunSerializer(serializers.ModelSerializer):
    configuration_name = serializers.CharField(source="configuration.name", read_only=True)
    dataset_kind = serializers.CharField(source="configuration.dataset_kind", read_only=True)
    environment = serializers.SerializerMethodField()

    def get_environment(self, obj) -> str:
        return obj.source_snapshot.get("environment", "")

    class Meta:
        model = m.ReportSnapshotRun
        exclude = ("source_snapshot", "claim_token")
        read_only_fields = tuple(f.name for f in m.ReportSnapshotRun._meta.fields)


class SnapshotConfigurationSerializer(serializers.ModelSerializer):
    source_name = serializers.CharField(source="source_report.name", read_only=True)
    connection_name = serializers.CharField(source="source_report.connection.name", read_only=True)
    output_name = serializers.CharField(source="output_report.name", read_only=True)
    pending_items = serializers.SerializerMethodField()
    latest_run = serializers.SerializerMethodField()
    timezone = serializers.CharField(source="unit.timezone", read_only=True)

    class Meta:
        model = m.ReportSnapshotConfiguration
        fields = "__all__"
        read_only_fields = ("unit", "version", "created_at", "updated_at")
        validators = []

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        unit = self.context.get("unit")
        self.fields["source_report"].queryset = m.ReportDefinition.objects.filter(unit=unit, catalog_kind="component", source="sql", connection__engine="oracle")
        self.fields["output_report"].queryset = m.ReportDefinition.objects.filter(unit=unit)
        self.fields["consumers"].child_relation.queryset = m.ReportDefinition.objects.filter(unit=unit)

    def get_pending_items(self, obj) -> list[str]:
        try:
            definition(obj, require_source=True)
        except ValidationError as exc:
            return [obj.source_report.unavailable_reason or str(exc.detail)]
        return []

    def get_latest_run(self, obj) -> dict | None:
        run = obj.runs.order_by("-reference_date", "-requested_at").first()
        return SnapshotRunSerializer(run).data if run else None

    def validate(self, attrs):
        if any(item.unit_id != self.context["unit"].pk for item in attrs.get("consumers", [])):
            raise ValidationError("Consumidores devem pertencer à mesma unidade da coleta.")
        def value(key): return attrs.get(key, getattr(self.instance, key, None))
        days = value("weekdays")
        if days is None: days = list(range(7))
        if (not isinstance(days, list) or not days or len(set(days)) != len(days)
            or any(type(d) is not int or d not in range(7) for d in days)):
            raise ValidationError("Selecione os dias da coleta.")
        attrs["weekdays"] = days
        window = value("window_minutes") or 60
        if not 1 <= window <= 180: raise ValidationError("A janela deve ser de 1 a 180 minutos.")
        if value("collection_time") and value("collection_time").tzinfo:
            raise ValidationError("Use o horário local da unidade.")
        existing = m.ReportSnapshotConfiguration.objects.filter(unit=self.context["unit"], code=value("code"))
        if self.instance: existing = existing.exclude(pk=self.instance.pk)
        if existing.exists(): raise ValidationError("Código já cadastrado nesta unidade.")
        output = value("output_report")
        existing = m.ReportSnapshotConfiguration.objects.filter(output_report=output)
        if self.instance: existing = existing.exclude(pk=self.instance.pk)
        if existing.exists(): raise ValidationError("Esse relatório já possui uma coleta.")
        draft = m.ReportSnapshotConfiguration(unit=self.context["unit"], **{
            k:value(k) for k in ("source_report", "output_report", "environment")},
            dataset_kind=value("dataset_kind") or "beds", reference_offset_days=value("reference_offset_days") or 0)
        definition(draft, require_source=bool(value("enabled")))
        return attrs


class SnapshotConfigurationViewSet(Managed):
    queryset = m.ReportSnapshotConfiguration.objects.select_related("unit", "source_report__connection", "output_report").order_by("name")
    serializer_class = SnapshotConfigurationSerializer

    @action(detail=False, methods=["get"])
    def options(self, request):
        from rest_framework.response import Response
        unit = get_unit(request, ["admin"])
        sources = m.ReportDefinition.objects.filter(unit=unit, catalog_kind="component", source="sql", connection__engine="oracle").order_by("name")
        reports = m.ReportDefinition.objects.filter(unit=unit).filter(Q(handler=HANDLER) | Q(code__in=["legacy123-18","legacy123-19","legacy123-20","legacy123-24","legacy123-25","legacy123-55","legacy123-271","legacy123-310"])).order_by("name")
        return Response({"sources": [{"id": x.pk, "name": x.name, "connection_name": x.connection.name} for x in sources.select_related("connection")], "reports": list(reports.values("id", "name")), "dataset_kinds": [{"value": k, "label": v} for k, v in m.ReportSnapshotConfiguration._meta.get_field("dataset_kind").choices]})

    @extend_schema(request=ReportCatalogVersionInput, responses=SnapshotRunSerializer)
    @action(detail=True, methods=["post"])
    def collect(self, request, pk=None):
        def execute():
            obj = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)
            if type(request.data.get("version")) is not int or request.data["version"] != obj.version:
                raise Conflict()
            run = queue_collection(obj.pk, user=request.user)
            return SnapshotRunSerializer(run).data
        return self.once(request, execute)


class SnapshotRowSerializer(serializers.ModelSerializer):
    class Meta:
        model = m.BedSnapshotRow
        fields = ("ward_code", "ward_name", "quantity", "source_at")
        read_only_fields = fields


class SnapshotDataRowSerializer(serializers.ModelSerializer):
    class Meta:
        model = m.ReportSnapshotDataRow
        fields = ("record_key", "payload")
        read_only_fields = fields


@extend_schema_view(list=extend_schema(parameters=[OpenApiParameter("configuration", int), OpenApiParameter("state", str), OpenApiParameter("environment", str), OpenApiParameter("period_type", str)]))
class SnapshotRunViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = m.ReportSnapshotRun.objects.select_related("configuration").order_by("-reference_date", "-requested_at")
    serializer_class = SnapshotRunSerializer

    def get_queryset(self):
        qs = self.queryset.filter(unit=get_unit(self.request, ["admin"]))
        configuration = self.request.query_params.get("configuration", "")
        if configuration:
            if not configuration.isdigit(): raise ValidationError("Coleta inválida.")
            qs = qs.filter(configuration_id=configuration)
        state = self.request.query_params.get("state", "")
        if state:
            if state not in {"pending", "running", "ready", "failed", "missed"}: raise ValidationError("Situação inválida.")
            qs = qs.filter(state=state)
        environment = self.request.query_params.get("environment")
        period_type = self.request.query_params.get("period_type")
        if environment:
            if environment not in {"homologation", "production"}: raise ValidationError("Ambiente inválido.")
            qs = qs.filter(source_snapshot__environment=environment)
        if period_type:
            if period_type not in {"day", "month"}: raise ValidationError("Período inválido.")
            qs = qs.filter(period_type=period_type)
        return qs

    def create(self, request):
        from rest_framework.exceptions import MethodNotAllowed
        raise MethodNotAllowed("POST")

    @extend_schema(responses=PolymorphicProxySerializer(component_name="SnapshotRecord", serializers=[SnapshotRowSerializer, SnapshotDataRowSerializer], resource_type_field_name=None, many=True))
    @action(detail=True, methods=["get"])
    def records(self, request, pk=None):
        run = self.get_object()
        if run.configuration.dataset_kind == "beds":
            rows = run.rows.filter(unit=run.unit).order_by("ward_code")
            page = self.paginate_queryset(rows)
            return self.get_paginated_response(SnapshotRowSerializer(page, many=True).data)
        rows = run.data_rows.filter(unit=run.unit).order_by("record_key")
        page = self.paginate_queryset(rows)
        return self.get_paginated_response(SnapshotDataRowSerializer(page, many=True).data)
