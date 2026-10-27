"""Server-local, allowlisted PDFs published manually by the operation."""

import base64
import hashlib
import io
import os
import stat
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from pypdf import PdfReader
from rest_framework.exceptions import PermissionDenied, ValidationError

HANDLER = "external_pdf_v1"
# Never accept filesystem paths from the report editor or request parameters.
FILES = {
    ("scv", "legacy123-309"): "reports/painel-leitos/painel-leitos.pdf",
    ("scv", "legacy123-162"): "reports/indicadores-gerenciais/indicadores-gerenciais.pdf",
    ("scv", "legacy123-163"): "reports/indicadores-estrategicos/indicadores-estrategicos.pdf",
    ("scv", "legacy123-270"): "reports/internacoes-ps/internacoes-ps.pdf",
}
MAX_BYTES = 7 * 1024 * 1024  # Base64 remains below the execution's 10 MB limit.
MAX_PAGES = 200


def source_name(report):
    name = FILES.get((report.unit.slug, report.code))
    if (not name or report.source != "external_file" or report.handler != HANDLER
            or report.connection_id or report.output_format != "pdf"
            or report.parameter_schema or report.components or report.query_sql):
        raise ValidationError("Revisar a definição do PDF local do relatório.")
    return name


def load_source(report):
    name = source_name(report)
    root = Path(getattr(settings, "REPORT_FILES_ROOT", "/app/files")).resolve()
    path = root / name
    try:
        path.resolve().relative_to(root)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_BYTES:
                raise ValidationError("O PDF local deve ser um arquivo regular de até 7 MB.")
            data = stream.read(MAX_BYTES + 1)
            after = os.fstat(stream.fileno())
        if (len(data) != before.st_size or len(data) > MAX_BYTES
                or (before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                != (after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
            raise ValidationError("PDF em atualização; tente novamente após concluir a cópia.")
    except (OSError, ValueError):
        raise ValidationError(f"PDF local indisponível; publique {Path(name).name} na pasta do relatório.") from None
    try:
        if not data.startswith(b"%PDF-") or b"%%EOF" not in data[-1024:]:
            raise ValueError("incomplete PDF")
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise ValueError("encrypted PDF")
        pages = len(reader.pages)
        if not 1 <= pages <= MAX_PAGES:
            raise ValueError("invalid page count")
        for page in reader.pages:
            if page.get("/Type") != "/Page":
                raise ValueError("invalid page")
    except Exception:
        # Parser exceptions must never expose document content or filesystem paths.
        raise ValidationError("PDF inválido, incompleto, protegido ou com mais de 200 páginas.") from None
    return data, {
        "source": name,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size_bytes": len(data),
        "pages": pages,
        "file_modified_at": datetime.fromtimestamp(before.st_mtime, timezone.utc).isoformat(),
        "publication": "manual",
    }


def definition_snapshot(report):
    return load_source(report)[1]


def check_snapshot(job):
    name = source_name(job.report)
    manifest = job.snapshot.get("external_pdf", {})
    if manifest.get("source") != name or not manifest.get("sha256"):
        raise PermissionDenied("Fotografia do PDF local indisponível.")
    if job.state == "ready":
        try:
            content = base64.b64decode(job.result, validate=True)
        except (ValueError, TypeError):
            raise PermissionDenied("Resultado do PDF inválido.") from None
        if (not content or len(content) != manifest.get("size_bytes")
                or hashlib.sha256(content).hexdigest() != manifest["sha256"]):
            raise PermissionDenied("Resultado do PDF alterado.")
    else:
        current = definition_snapshot(job.report)
        if current["sha256"] != manifest["sha256"]:
            raise PermissionDenied("PDF substituído após a solicitação; solicite novamente.")


def generate(job):
    data, manifest = load_source(job.report)
    if manifest["sha256"] != job.snapshot.get("external_pdf", {}).get("sha256"):
        raise PermissionDenied("PDF substituído após a solicitação; solicite novamente.")
    # One source document, not a SQL row count or a claim about clinical data.
    return base64.b64encode(data).decode(), 1
