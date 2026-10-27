import base64
import binascii
import copy
import hashlib
import io
import json
import logging
import re
import time
from contextlib import ExitStack
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework import serializers
from core.models import Audit
from core.permissions import get_unit
from operations.models import ReportDefinition, ReportCanvasAsset
from operations.services import Conflict, idempotent
from operations.report_engine import parameters, report_filename
from .schema import default_layout, validate_layout, validate_complete, fail, fail_at, source_label
from .engine import definition_snapshot, export, validate_values
from .registry import SOURCES

logger = logging.getLogger(__name__)

ISO_DATE_REGEX = re.compile(
    r"^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$"
)
NUMBER_REGEX = re.compile(r"^-?\d+(?:\.\d+)?$")


class CanvasConfigSchema(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    layout = serializers.JSONField()
    enabled = serializers.BooleanField(default=False)
    output_format = serializers.ChoiceField(choices=["pdf", "xlsx"], default="pdf")
    monthly_goals = serializers.ListField(child=serializers.DictField(), read_only=True)
    sources = serializers.ListField(child=serializers.DictField(), read_only=True)
    assets = serializers.ListField(child=serializers.DictField(), read_only=True)


class CanvasPreviewSchema(serializers.Serializer):
    layout = serializers.JSONField()
    parameters = serializers.JSONField(default=dict)
    output_format = serializers.ChoiceField(choices=["pdf", "xlsx"], default="pdf")


class CanvasPreviewResult(serializers.Serializer):
    content = serializers.CharField()
    format = serializers.ChoiceField(choices=["pdf", "xlsx"])
    rows = serializers.IntegerField()
    filename = serializers.CharField()


class CanvasSourcePreviewSchema(serializers.Serializer):
    source = serializers.DictField()
    parameters = serializers.JSONField(required=False, default=dict)
    limit = serializers.IntegerField(required=False, default=50, min_value=1, max_value=500)


class CanvasSourcePreviewResult(serializers.Serializer):
    columns = serializers.ListField(child=serializers.DictField())
    rows = serializers.ListField(child=serializers.ListField())
    total_rows = serializers.IntegerField()
    truncated = serializers.BooleanField()
    elapsed_ms = serializers.IntegerField()


class CanvasAssetSchema(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    filename = serializers.CharField(max_length=160)
    content = serializers.CharField(required=False, max_length=2800000)
    width = serializers.IntegerField(read_only=True)
    height = serializers.IntegerField(read_only=True)
    mime = serializers.CharField(read_only=True)
    results = serializers.ListField(child=serializers.DictField(), read_only=True)


def context_report(view, request):
    unit = get_unit(request, ["admin"])
    return get_object_or_404(ReportDefinition, pk=view.kwargs["pk"], unit=unit)


def response(report):
    from .native import catalog_datasets
    labels = {
        "overview": "Resumo", "providers": "Prestadores", "chart": "Exames por atendimento",
        "rows": "Registros", "metadata": "Atualização dos dados", "stays": "Permanência média",
        "specialties": "Permanência por especialidade", "ratios": "Exames por atendimento",
        "counts": "Exames e atendimentos", "daily": "Exames e atendimentos por dia",
        "opinions_months": "Pareceres por mês", "opinions_days": "Pareceres por dia",
    }
    candidates = ReportDefinition.objects.filter(
        unit=report.unit, reviewed=True, review_queue=False
    ).select_related("connection", "unit").order_by("name")
    sources = []
    for child in candidates:
        native = catalog_datasets(child)
        if not child.enabled and not (child.pk == report.pk and native):
            continue
        if native:
            sources.append({
                "id": child.pk,
                "name": child.name,
                "code": child.code,
                "datasets": [{"id": k, "name": labels.get(k, k.replace("_", " ")), "columns": v} for k, v in native.items()],
            })
        elif child.source == "sql" and child.connection_id and child.connection.unit_id == report.unit_id and child.connection.enabled and child.connection.validated:
            sources.append({"id": child.pk, "name": child.name, "code": child.code})
    notice = ""
    if report.handler == "external_pdf_v1" and not report.canvas_layout:
        notice = "PDF recebido pronto. A edição dos elementos depende do arquivo de origem."
    elif not report.reviewed and not report.canvas_layout:
        notice = "Portabilidade pendente: a fonte deste relatório ainda não foi integrada."
    return {
        "port_notice": notice,
        "monthly_goals": report.monthly_goals,
        "version": report.version,
        "layout": report.canvas_layout or default_layout(),
        "enabled": report.canvas_enabled,
        "output_format": report.canvas_layout.get("export_format", report.output_format),
        "sources": sources,
        "assets": [{"id": str(a.pk), "filename": a.filename, "width": a.width, "height": a.height} for a in report.canvas_assets.only("id", "filename", "width", "height")],
    }


def configure(view, request):
    report = context_report(view, request)
    if request.method == "GET":
        return Response(response(report))

    def operation():
        with transaction.atomic():
            current = ReportDefinition.objects.select_for_update().get(pk=report.pk, unit=report.unit)
            if type(request.data.get("version")) is not int or request.data["version"] != current.version:
                raise Conflict()
            layout = validate_layout(request.data.get("layout"))
            enabled = request.data.get("enabled", False)
            fmt = request.data.get("output_format", "pdf")
            if type(enabled) is not bool or fmt not in {"pdf", "xlsx"}:
                fail("Formato ou ativação inválidos.")
            # Drafts may refer to a source not yet available, but never to another unit's assets/sources.
            for spec in layout["sources"]:
                if spec["type"] == "report" and not ReportDefinition.objects.filter(pk=spec["report_id"], unit=current.unit).exists():
                    fail("Fonte de outra unidade ou não encontrada.")
                if spec["type"] == "report":
                    from .native import datasets
                    child = ReportDefinition.objects.filter(pk=spec["report_id"], unit=current.unit).first()
                    if child and datasets(child):
                        from .sources import resolve_report
                        resolve_report(current, spec)
            from .engine import assets_for
            assets_for(current, layout)
            if enabled:
                if current.catalog_kind != "report" or current.review_queue:
                    fail("Ative Canvas apenas em relatórios finais revisados.")
                definition_snapshot(current, layout)
            previous = {"layout": current.canvas_layout, "enabled": current.canvas_enabled, "format": current.output_format}
            legacy = dict(current.legacy)
            if enabled and not current.canvas_enabled:
                legacy["canvas_previous"] = {"format": current.output_format, "reviewed": current.reviewed}
            elif not enabled and current.canvas_enabled:
                original = legacy.pop("canvas_previous", {})
                current.output_format = original.get("format", "pdf")
                current.reviewed = original.get("reviewed", current.reviewed)
            layout["export_format"] = fmt
            current.canvas_layout = layout
            current.canvas_enabled = enabled
            current.legacy = legacy
            if enabled:
                current.reviewed = True
                current.output_format = fmt
            current.version += 1
            current.save(update_fields=["canvas_layout", "canvas_enabled", "reviewed", "output_format", "legacy", "version"])
            Audit.objects.create(
                unit=current.unit,
                actor=request.user,
                action="report.canvas_configured",
                object_id=str(current.pk),
                details={"previous": previous, "layout": layout, "enabled": enabled, "version": current.version},
            )
            return response(current)

    return Response(idempotent(report.unit, request.user, request.headers.get("Idempotency-Key"), {"path": request.path, "data": request.data}, operation))


def preview(view, request):
    report = context_report(view, request)
    layout = validate_layout(request.data.get("layout", report.canvas_layout))
    validate_complete(layout)
    definition_snapshot(report, layout)
    values = request.data.get("parameters", {})
    validate_values(report, values)
    fmt = request.data.get("output_format", "pdf")
    if fmt not in {"pdf", "xlsx"}:
        fail("Formato de prévia inválido.")
    try:
        content, count = export(report, layout, values, report.monthly_goals, fmt)
    except ValidationError:
        raise
    except Exception:
        logger.exception("Canvas preview failed unexpectedly")
        fail_at(
            "Não foi possível gerar a prévia. Verifique a fonte, os parâmetros e os blocos.",
            code="preview_failed",
        )
    Audit.objects.create(unit=report.unit, actor=request.user, action="report.canvas_previewed", object_id=str(report.pk), details={"format": fmt, "rows": count})
    return Response({"content": content, "format": fmt, "rows": count, "filename": report_filename(report.name, fmt)})


def infer_column_metadata(col_name, values):
    null_count = sum(1 for v in values if v is None)
    nullable = null_count > 0
    non_nulls = [v for v in values if v is not None]

    sample = []
    seen = set()
    for v in non_nulls:
        sv = str(v)
        if sv not in seen:
            seen.add(sv)
            sample.append(sv)
            if len(sample) == 3:
                break

    if not non_nulls:
        return {
            "name": col_name,
            "type": "unknown",
            "nullable": nullable,
            "null_count": null_count,
            "sample": sample,
        }

    is_all_bool = all(isinstance(v, bool) for v in non_nulls)
    is_all_datetime = all(isinstance(v, datetime) for v in non_nulls)
    is_all_date = all(isinstance(v, date) and not isinstance(v, datetime) for v in non_nulls)
    is_all_number = all(
        isinstance(v, (int, float, Decimal)) and not isinstance(v, bool)
        for v in non_nulls
    )

    if is_all_bool:
        col_type = "boolean"
    elif is_all_datetime:
        col_type = "datetime"
    elif is_all_date:
        col_type = "date"
    elif is_all_number:
        col_type = "number"
    else:
        col_type = "text"

    res = {
        "name": col_name,
        "type": col_type,
        "nullable": nullable,
        "null_count": null_count,
        "sample": sample,
    }

    if col_type == "text":
        total = len(non_nulls)
        iso_matches = sum(
            1 for v in non_nulls if isinstance(v, str) and ISO_DATE_REGEX.match(v.strip())
        )
        num_matches = sum(
            1 for v in non_nulls if isinstance(v, str) and NUMBER_REGEX.match(v.strip())
        )
        if iso_matches / total >= 0.9:
            res["looks_like"] = "date"
        elif num_matches / total >= 0.9:
            res["looks_like"] = "number"

    return res


def serialize_cell(val):
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, Decimal):
        return int(val) if val % 1 == 0 else float(val)
    if isinstance(val, (int, float, bool, str)):
        return val
    return str(val)


def source_preview(view, request):
    start_time = time.perf_counter()
    report = context_report(view, request)

    source = request.data.get("source")
    if not isinstance(source, dict):
        fail_at("Informe a especificação da fonte para a prévia.", code="source_required")

    source_type = source.get("type")
    if source_type not in SOURCES:
        fail_at(f'Tipo de fonte desconhecido: "{source_type}".', code="source_type_invalid")

    SOURCES[source_type].validate(source)
    if source_type == "report":
        from .sources import resolve_report
        resolve_report(report, source)

    raw_params = request.data.get("parameters")
    params = raw_params if isinstance(raw_params, dict) else {}

    raw_limit = request.data.get("limit", 50)
    try:
        limit = int(raw_limit)
        if not (1 <= limit <= 500):
            limit = 50
    except (ValueError, TypeError):
        limit = 50

    with ExitStack() as stack:
        ctx = SimpleNamespace(
            report=report,
            parameters=params,
            goals=report.monthly_goals,
            assets={},
            datasets={},
            sessions={},
            native_cache={},
            stack=stack,
        )
        try:
            dataset = SOURCES[source_type].read(ctx, source)
        except ValidationError:
            raise
        except Exception as exc:
            logger.exception("Failed reading canvas source for preview")
            fail_at(
                f'Não foi possível consultar a fonte "{source_label(source)}": {exc}',
                source_id=source.get("id"),
                code="source_connection_failed",
            )

    total_rows = len(dataset.rows)
    if total_rows > 30000:
        fail_at(
            f'Fonte "{source_label(source)}" excede o limite de 30.000 linhas (retornou {total_rows}).',
            source_id=source.get("id"),
            code="source_limit_exceeded",
        )
    raw_size = len(json.dumps(dataset.rows, default=str).encode())
    if raw_size > 10 * 1024 * 1024:
        fail_at(
            f'Fonte "{source_label(source)}" excede o limite de 10 MB.',
            source_id=source.get("id"),
            code="source_size_exceeded",
        )

    columns = [
        infer_column_metadata(col_name, [r[col_idx] for r in dataset.rows])
        for col_idx, col_name in enumerate(dataset.columns)
    ]

    preview_rows = [
        [serialize_cell(cell) for cell in row]
        for row in dataset.rows[:limit]
    ]

    elapsed_ms = int((time.perf_counter() - start_time) * 1000)

    Audit.objects.create(
        unit=report.unit,
        actor=request.user,
        action="report.canvas_source_previewed",
        object_id=str(report.pk),
        details={
            "source_id": source.get("id"),
            "source_type": source_type,
            "total_rows": total_rows,
            "elapsed_ms": elapsed_ms,
        },
    )

    return Response({
        "columns": columns,
        "rows": preview_rows,
        "total_rows": total_rows,
        "truncated": total_rows > limit,
        "elapsed_ms": elapsed_ms,
    })


def asset_data(asset, content=False):
    data = {"id": str(asset.pk), "filename": asset.filename, "width": asset.width, "height": asset.height, "mime": "image/png"}
    if content:
        data["content"] = base64.b64encode(bytes(asset.data)).decode()
    return data


def assets(view, request):
    report = context_report(view, request)
    if request.method == "GET":
        if request.query_params.get("asset_id"):
            import uuid
            try:
                asset_id = uuid.UUID(request.query_params["asset_id"])
            except (ValueError, TypeError):
                fail("Identificador de imagem inválido.")
            a = get_object_or_404(ReportCanvasAsset, pk=asset_id, report=report, unit=report.unit)
            return Response(asset_data(a, True))
        return Response({"results": [asset_data(a) for a in report.canvas_assets.only("id", "filename", "width", "height")]})

    def operation():
        with transaction.atomic():
            ReportDefinition.objects.select_for_update().get(pk=report.pk)
            if report.canvas_assets.count() >= 20:
                fail("Limite de 20 imagens por relatório.")
            content = request.data.get("content", "")
            if not isinstance(content, str) or len(content) > 2_800_000:
                fail("Imagem deve ter até 2 MB.")
            try:
                raw = base64.b64decode(content, validate=True)
            except (ValueError, binascii.Error):
                fail("Imagem inválida.")
            if len(raw) > 2 * 1024 * 1024:
                fail("Imagem deve ter até 2 MB.")
            from PIL import Image, UnidentifiedImageError
            try:
                with Image.open(io.BytesIO(raw)) as im:
                    if im.format not in {"PNG", "JPEG"} or im.width * im.height > 16_000_000:
                        fail("Use PNG/JPEG de até 16 megapixels.")
                    im.load()
                    im = im.convert("RGBA")
                    w, h = im.size
                    out = io.BytesIO()
                    im.save(out, format="PNG")
                    raw = out.getvalue()
            except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
                fail("Não foi possível ler a imagem.")
            if len(raw) > 4 * 1024 * 1024:
                fail("Imagem decodificada excede o limite.")
            name = str(request.data.get("filename", "imagem.png")).replace("\\", "/").split("/")[-1][:150] or "imagem.png"
            a = ReportCanvasAsset.objects.create(unit=report.unit, report=report, filename=name, data=raw, width=w, height=h, sha256=hashlib.sha256(raw).hexdigest())
            Audit.objects.create(unit=report.unit, actor=request.user, action="report.canvas_asset_uploaded", object_id=str(report.pk), details={"asset_id": str(a.pk), "sha256": a.sha256})
            return asset_data(a, True)

    return Response(idempotent(report.unit, request.user, request.headers.get("Idempotency-Key"), {"path": request.path, "content_hash": hashlib.sha256(str(request.data.get("content", "")).encode()).hexdigest(), "filename": request.data.get("filename", "")}, operation))
