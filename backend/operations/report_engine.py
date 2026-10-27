"""Read-only report connections, parameter binding and bounded generation."""

import base64
import csv
import io
import json
import re
import time
from contextlib import contextmanager, nullcontext
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet
from django.conf import settings
from rest_framework.exceptions import ValidationError


def report_filename(name, output_format):
    import unicodedata
    title = unicodedata.normalize("NFC", str(name or "Relatório"))
    title = "".join(ch for ch in title if not unicodedata.category(ch).startswith("C"))
    title = re.sub(r'[\\/:*?"<>|]', " ", title)
    title = re.sub(r"\s+", " ", title).strip(" .")[:140].rstrip(" .") or "Relatório"
    extension = {"pdf":"pdf", "csv":"csv", "xlsx":"xlsx", "text":"txt"}.get(output_format, "pdf")
    if title.casefold().endswith("."+extension):
        return title
    return title + "." + extension


def seal(password, admin_password):
    from core.oracle_credentials import encrypt, wrap_service_key

    salt, ciphertext, key = encrypt({"password": password}, admin_password)
    return json.dumps(
        {"salt": salt, "ciphertext": ciphertext, "key": wrap_service_key(key)}
    )


def secret(connection):
    if not connection.ciphertext:
        return ""
    from core.oracle_credentials import service_cipher

    data = json.loads(connection.ciphertext)
    key = service_cipher().decrypt(data["key"].encode())
    return json.loads(Fernet(key).decrypt(data["ciphertext"].encode()))["password"]


def sql_contract(sql, schema, engine):
    # Schema and declaration checks are fresh on every call. No authorization,
    # database state, source rows or execution result is cached here.
    if not isinstance(sql, str) or not sql.strip() or len(sql) > 100000:
        raise ValidationError("Informe uma consulta SELECT de ate 100.000 caracteres.")
    names = _sql_structure(sql, engine)
    if not isinstance(schema, dict) or len(schema) > 30:
        raise ValidationError("Parâmetros devem ser um objeto com at? 30 entradas.")
    for key, value in schema.items():
        if (
            not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,49}", key)
            or not isinstance(value, dict)
            or value.get("type") not in {"date", "integer", "number", "string"}
        ):
            raise ValidationError(
                "Parâmetro inválido: use type date, integer, number ou string."
            )
    if names - set(schema):
        raise ValidationError("Declare todos os parâmetros :nome na configuração.")
    return set(names)


@lru_cache(maxsize=128)
def _sql_structure(sql, engine):
    import sqlglot
    from sqlglot import exp

    if not isinstance(sql, str) or not sql.strip() or len(sql) > 100000:
        raise ValidationError("Informe uma consulta SELECT de at? 100.000 caracteres.")
    try:
        trees = sqlglot.parse(
            sql,
            read={
                "oracle": "oracle",
                "postgres": "postgres",
                "mysql": "mysql",
                "sqlite": "sqlite",
            }.get(engine),
        )
    except Exception:  # noqa: BLE001 - do not expose driver credentials or source data
        raise ValidationError("SQL inválido para a conexão selecionada.") from None
    if len(trees) != 1 or not isinstance(
        trees[0], (exp.Select, exp.Union, exp.Intersect, exp.Except)
    ):
        raise ValidationError("Somente uma consulta SELECT ? permitida.")
    forbidden = {
        "Insert",
        "Update",
        "Delete",
        "Create",
        "Drop",
        "Alter",
        "Command",
        "Transaction",
        "Commit",
        "Rollback",
        "Into",
        "Lock",
        "Copy",
        "Execute",
        "Merge",
        "Grant",
        "Revoke",
        "Pragma",
        "Attach",
        "Detach",
    }
    if any(type(node).__name__ in forbidden for node in trees[0].walk()):
        raise ValidationError("A consulta contém operações não permitidas.")
    # Reject administrative functions even when embedded in SELECT.
    if re.search(
        r"(?i)\b(pg_sleep|dblink|lo_import|lo_export|pg_read_file|pg_ls_dir|set_config|load_extension|readfile|writefile|sleep|benchmark|get_lock|release_lock|utl_file|utl_http|dbms_\w+|nextval|setval|gen_id)\b",
        sql,
    ):
        raise ValidationError("Função não permitida em relatórios.")
    import sqlparse
    from sqlparse.tokens import Name

    names = {
        value[1:]
        for token_type, value in sqlparse.lexer.tokenize(sql)
        if token_type == Name.Placeholder and value.startswith(":")
    }
    return frozenset(names)


def parameters(report, values):
    from datetime import date
    from decimal import Decimal, InvalidOperation

    schema = report.parameter_schema
    if not isinstance(values, dict) or set(values) - set(schema):
        raise ValidationError("Parâmetros não cadastrados.")
    result = {}
    for name, spec in schema.items():
        value = values.get(name, spec.get("default"))
        if value is None or value == "":
            if spec.get("required", True):
                raise ValidationError("Parâmetro obrigatório: " + name)
            result[name] = None
            continue
        try:
            kind = spec["type"]
            if kind == "date":
                value = date.fromisoformat(str(value))
            elif kind == "integer":
                if isinstance(value, bool) or not re.fullmatch(r"-?\d+", str(value)):
                    raise ValueError()
                value = int(value)
            elif kind == "number":
                value = Decimal(str(value))
                if not value.is_finite():
                    raise ValueError()
            else:
                value = str(value)
                if len(value) > 2000:
                    raise ValueError()
        except (ValueError, TypeError, InvalidOperation):
            raise ValidationError("Valor inválido: " + name) from None
        if kind in {"integer", "number"}:
            for limit, invalid in [("minimum", lambda bound: value < bound), ("maximum", lambda bound: value > bound)]:
                bound = spec.get(limit)
                if bound is not None:
                    if isinstance(bound, bool) or not isinstance(bound, (int, float)) or not __import__("math").isfinite(bound):
                        raise ValidationError("Limite inválido no parâmetro: " + name)
                    if invalid(Decimal(str(bound))):
                        raise ValidationError("Valor fora do intervalo permitido: " + name)
        result[name] = value
    for name, spec in schema.items():
        previous = spec.get("not_before")
        if previous:
            if spec.get("type") != "date" or previous not in schema or schema[previous].get("type") != "date":
                raise ValidationError("Referência de data inválida: " + name)
            if result.get(name) is not None and result.get(previous) is not None and result[name] < result[previous]:
                raise ValidationError("A data final deve ser igual ou posterior à data inicial.")
    return result


def bound_sql(sql, values, engine):
    # Lexing preserves literals/comments/casts without grouping historical SQL.
    import sqlparse
    from sqlparse.tokens import Name

    tokens = list(sqlparse.lexer.tokenize(sql))
    names = {
        value[1:]
        for kind, value in tokens
        if kind == Name.Placeholder and value.startswith(":")
    }
    if engine == "oracle":
        return sql, {k: v for k, v in values.items() if k in names}
    positional, output = [], []
    for kind, value in tokens:
        if kind == Name.Placeholder and value.startswith(":"):
            positional.append(values[value[1:]])
            output.append("%s" if engine in {"mysql", "postgres"} else "?")
        else:
            output.append(
                value.replace("%", "%%") if engine in {"mysql", "postgres"} else value
            )
    vals = tuple(
        v.isoformat()
        if hasattr(v, "isoformat")
        else str(v)
        if engine == "sqlite" and type(v).__name__ == "Decimal"
        else v
        for v in positional
    )
    return "".join(output), vals


@contextmanager
def connect(connection):
    c = None
    engine = connection.engine
    timeout = connection.timeout_seconds
    try:
        if engine == "sqlite":
            import sqlite3

            root = Path(
                getattr(settings, "REPORT_SQLITE_ROOT", "/app/report_sources")
            ).resolve()
            path = Path(connection.database).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValidationError(
                    "SQLite deve existir na pasta report_sources do servidor."
                )
            c = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=timeout)
            c.execute("PRAGMA query_only=ON")
            start = time.monotonic()
            c.set_progress_handler(
                lambda: int(time.monotonic() - start > timeout), 1000
            )
        elif engine == "oracle":
            from core.oracle_credentials import connect as oracle_connect

            c = oracle_connect(
                {
                    "host": connection.host,
                    "port": connection.port,
                    "identifier_type": connection.options.get(
                        "identifier_type", "service"
                    ),
                    "identifier": connection.database,
                    "username": connection.username,
                    "password": secret(connection),
                    "timeout_ms": timeout * 1000,
                }
            )
            c.cursor().execute("SET TRANSACTION READ ONLY")
        elif engine == "postgres":
            import psycopg

            c = psycopg.connect(
                host=connection.host,
                port=connection.port,
                dbname=connection.database,
                user=connection.username,
                password=secret(connection),
                connect_timeout=5,
                options=f"-c default_transaction_read_only=on -c statement_timeout={timeout * 1000}",
            )
        elif engine == "mysql":
            import pymysql

            c = pymysql.connect(
                host=connection.host,
                port=connection.port,
                database=connection.database,
                user=connection.username,
                password=secret(connection),
                connect_timeout=5,
                read_timeout=timeout,
                write_timeout=timeout,
                charset="utf8mb4",
            )
            c.cursor().execute("START TRANSACTION READ ONLY")
        elif engine == "firebird":
            from firebird.driver import (
                Isolation,
                TraAccessMode,
                tpb,
            )
            from firebird.driver import (
                connect as fb_connect,
            )

            c = fb_connect(
                f"{connection.host}/{connection.port}:{connection.database}",
                user=connection.username,
                password=secret(connection),
                charset=connection.options.get("charset", "UTF8"),
            )
            c.begin(
                tpb(
                    Isolation.READ_COMMITTED_RECORD_VERSION,
                    lock_timeout=timeout,
                    access_mode=TraAccessMode.READ,
                )
            )
        else:
            raise ValidationError("Conexão não suportada.")
        yield c
    finally:
        if c is not None:
            try:
                c.rollback()
            finally:
                c.close()


def run_query(report, values, *, session=None, typed=False):
    connection = report.connection
    if (
        not connection
        or not connection.enabled
        or not connection.validated
        or connection.unit_id != report.unit_id
    ):
        raise ValidationError("Conexão desativada ou não validada.")
    sql_contract(report.query_sql, report.parameter_schema, connection.engine)
    sql, binds = bound_sql(
        report.query_sql, parameters(report, values), connection.engine
    )
    with (nullcontext(session) if session is not None else connect(connection)) as c:
        cursor = c.cursor()
        try:
            cursor.execute(sql, binds)
            if not cursor.description:
                raise ValidationError("A consulta não retornou colunas.")
            headers = [x[0] for x in cursor.description]
            if len(headers) > 100:
                raise ValidationError("Limite de 100 colunas excedido.")
            rows = cursor.fetchmany(connection.max_rows + 1)
            if len(rows) > connection.max_rows:
                raise ValidationError("Limite de linhas excedido; ajuste os filtros.")
            output = []
            size = 0
            for row in rows:
                line = []
                for v in row:
                    if hasattr(v, "read"):
                        raise ValidationError(
                            "LOB não suportado; converta a coluna na consulta."
                        )
                    text = "" if v is None else str(v)
                    size += len(text.encode())
                    if len(text) > 20000 or size > 5 * 1024 * 1024:
                        raise ValidationError("Resultado excede o limite de tamanho.")
                    if typed:
                        from datetime import date, datetime
                        from decimal import Decimal
                        if isinstance(v, datetime) and v.tzinfo is not None:
                            from zoneinfo import ZoneInfo
                            v = v.astimezone(ZoneInfo(report.unit.timezone)).replace(tzinfo=None)
                        line.append(v if v is None or isinstance(v,(int,float,Decimal,date,datetime)) else text)
                    else:
                        line.append(text)
                output.append(line)
            return headers, output
        finally:
            cursor.close()


def render_workbook(sections):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    book = Workbook()
    book.remove(book.active)
    for index, (name, headers, rows) in enumerate(sections, 1):
        title = re.sub(r"[\\/*?:\[\]]", " ", name).strip()[:25] or "Relatório"
        sheet = book.create_sheet(f"{index} {title}"[:31])
        sheet.append([str(v) for v in headers])
        for cell in sheet[1]:
            cell.data_type = "s"
            cell.font = Font(bold=True)
        for row_index, row in enumerate(rows, 2):
            sheet.append([str(v) for v in row])
            for cell in sheet[row_index]:
                cell.data_type = "s"
    out = io.BytesIO()
    book.save(out)
    return base64.b64encode(out.getvalue()).decode()


def render(name, headers, rows, output_format):
    if output_format == "xlsx":
        return render_workbook([(name, headers, rows)])
    if output_format == "pdf":
        from xml.sax.saxutils import escape

        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import (
            LongTable,
            Paragraph,
            SimpleDocTemplate,
            TableStyle,
        )

        out = io.BytesIO()
        styles = getSampleStyleSheet()
        style = styles["BodyText"]
        style.fontSize, style.leading = 7, 9
        table = LongTable(
            [[Paragraph(escape(str(v)), style) for v in r] for r in [headers, *rows]],
            repeatRows=1,
        )
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dcebf6")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                ]
            )
        )
        SimpleDocTemplate(
            out, pagesize=landscape(A4), leftMargin=18, rightMargin=18
        ).build([Paragraph(escape(name), styles["Title"]), table])
        return base64.b64encode(out.getvalue()).decode()
    if output_format == "text":
        return "\n".join(" | ".join(row) for row in [headers, *rows])
    out = io.StringIO()
    csv.writer(out).writerows(
        [
            [
                "'" + str(v) if str(v).startswith(("=", "+", "-", "@")) else v
                for v in row
            ]
            for row in [headers, *rows]
        ]
    )
    return out.getvalue()
