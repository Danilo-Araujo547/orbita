"""Document parameter evidence without rewriting queries or running legacy routines."""

import re

import sqlparse
from sqlparse.tokens import Comment, Name


def _references(sql):
    bindings, legacy = set(), set()
    for kind, value in sqlparse.lexer.tokenize(sql or ""):
        if kind in Comment:
            continue
        if kind == Name.Placeholder and value.startswith(":"):
            bindings.add(value[1:])
        # Historical WPA replacements may occur inside SQL string literals.
        legacy.update(re.findall(r"\bWPA_[A-Za-z0-9_]+\b", value, re.IGNORECASE))
    return bindings, legacy


def _legacy_type(record):
    kind = str(record.get("TIPO", "")).upper()
    mask = str(record.get("MASCARA", "")).upper()
    if "DATA" in kind:
        if "HH" in mask:
            return "Data e hora"
        return {"MM/YYYY": "Competência (mês/ano)", "YYYY": "Ano", "MM": "Mês"}.get(
            mask, "Data"
        )
    return {"NUMERICO": "Número", "CARACTER": "Texto"}.get(
        kind, kind or "Não identificado"
    )


def normalized_schema(schema):
    """Read the original shorthand types alongside structured parameter definitions."""
    if not isinstance(schema, dict):
        return {}
    return {
        name: {"type": spec} if isinstance(spec, str) else spec
        for name, spec in schema.items()
    }


def parameter_audit(report, seen=None):
    seen = set(seen or ())
    if report.pk in seen:
        return {"items": [], "component_issues": ["Composição circular"]}
    seen.add(report.pk)
    schema = normalized_schema(report.parameter_schema)
    legacy = report.legacy or {}
    records = legacy.get("parameters", [])
    current_bindings, current_legacy = _references(report.query_sql)
    original_bindings, original_legacy = _references(legacy.get("original_sql", ""))
    procedure = legacy.get("record", {}).get("PROCEDIMENTO", "")
    items = []
    documented = set()
    labels = {
        "date": "Data",
        "datetime": "Data e hora",
        "time": "Hora",
        "integer": "Inteiro",
        "number": "Número",
        "string": "Texto",
        "boolean": "Sim/não",
    }
    for record in sorted(records, key=lambda x: int(x.get("ORDEM") or 0)):
        name = str(record.get("NOME", ""))
        spec = schema.get(name, {})
        content = record.get("CONTEUDO", "")
        fragment = bool(
            re.search(
                r"(?:^|\s)(?:AND|OR|WHERE|SELECT|ORDER\s+BY|GROUP\s+BY)\b",
                str(content),
                re.IGNORECASE,
            )
        )
        if name in current_bindings:
            usage, status = "Bind :" + name + " na consulta atual", "confirmed"
        elif name in original_bindings:
            usage, status = "Bind :" + name + " no SQL legado", "legacy"
        elif name.upper() in {x.upper() for x in original_legacy | current_legacy}:
            usage, status = (
                "Marcador " + name + " no SQL legado; conversão para bind pendente",
                "legacy",
            )
        elif procedure:
            usage, status = (
                "Ordem "
                + str(record.get("ORDEM", "?"))
                + " cadastrada; rotina "
                + procedure
                + "; consumo não confirmado",
                "pending",
            )
        else:
            usage, status = (
                "Cadastrado no legado; vínculo com a consulta não confirmado",
                "pending",
            )
        if fragment:
            usage, status = (
                "Trecho de SQL legado; converter para regra revisada, sem interpolação",
                "pending",
            )
        items.append(
            {
                "name": name,
                "type": "Trecho de SQL" if fragment else _legacy_type(record),
                "mask": record.get("MASCARA", ""),
                "order": record.get("ORDEM"),
                "value": content,
                "required": spec.get("required", True) if spec else None,
                "origin": "Cadastro legado",
                "usage": usage,
                "status": status,
                "configured": name in schema,
                "report_code": report.code,
                "report_name": report.name,
            }
        )
        documented.add(name)
    for name, spec in schema.items():
        if name in documented:
            continue
        items.append(
            {
                "name": name,
                "type": labels.get(
                    spec.get("type"), str(spec.get("type", "Não identificado"))
                ),
                "mask": spec.get("format", ""),
                "order": None,
                "value": spec.get("default", ""),
                "required": spec.get("required", True),
                "origin": "Configuração SCV",
                "usage": "Bind :" + name + " na consulta atual"
                if name in current_bindings
                else "Configurado no SCV; consumo não confirmado",
                "status": "confirmed" if name in current_bindings else "pending",
                "configured": True,
                "report_code": report.code,
                "report_name": report.name,
            }
        )
        documented.add(name)
    for name in sorted(
        current_bindings | original_bindings | current_legacy | original_legacy
    ):
        if name.upper() in {n.upper() for n in documented}:
            continue
        items.append(
            {
                "name": name,
                "type": "Não identificado",
                "mask": "",
                "order": None,
                "value": "",
                "required": None,
                "origin": "Consulta SQL",
                "usage": "Referência no SQL sem parâmetro de mesmo nome cadastrado",
                "status": "pending",
                "configured": False,
                "report_code": report.code,
                "report_name": report.name,
            }
        )
    issues = []
    if report.source == "composite":
        from operations.models import ReportDefinition

        for entry in report.components if isinstance(report.components, list) else []:
            code = entry.get("code") if isinstance(entry, dict) else None
            child = (
                ReportDefinition.objects.select_related("connection")
                .filter(unit=report.unit, code=code)
                .first()
            )
            if not child:
                issues.append("Componente não encontrado: " + str(code))
                continue
            audit = parameter_audit(child, seen)
            for item in audit["items"]:
                items.append(
                    {
                        **item,
                        "origin": "Componente " + str(code) + " · " + item["origin"],
                    }
                )
            issues.extend(audit["component_issues"])
    return {"items": items, "component_issues": issues}
