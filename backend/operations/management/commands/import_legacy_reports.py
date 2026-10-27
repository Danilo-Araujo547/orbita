import re
import unicodedata

"""Import an evidence snapshot; never connect to or execute legacy databases."""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Audit, Unit
from operations.models import (
    ReportAutomation,
    ReportConnection,
    ReportDefinition,
    ReportGrant,
    ReportRecipient,
)


class Command(BaseCommand):
    help = "Importa catálogo, destinatários, permissões e horários legados, todos desativados."

    def add_arguments(self, p):
        p.add_argument("--directory", required=True)
        p.add_argument("--unit", required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        root = Path(options["directory"])

        def load(name):
            return json.loads((root / name).read_text(encoding="utf-8-sig"))

        a = load("all_permissions.json")
        b = load("all_definitions.json")
        c = load("all_parameters_page2.json")
        if isinstance(c, dict):
            c = [c]
        unit = Unit.objects.select_for_update().get(slug=options["unit"])
        contacts, grants, reports, schedules, words, parts = [
            a[i]["rows"] for i in (3, 4, 5, 6, 7, 8)
        ]
        delivery_ids = {str(g["ID_RELATORIO"]) for g in grants + schedules}
        params = b[2]["rows"] + c[0]["rows"]
        if (
            len(reports) != int(a[0]["rows"][0]["REPORTS"])
            or len(grants) != int(a[2]["rows"][0]["PERMISSIONS"])
            or len(params) != int(b[1]["rows"][0]["PARAMETERS"])
        ):
            raise CommandError("Extração incompleta.")
        definitions = {x["ID_RELATORIO"]: x["COMANDO_VIEW"] for x in b[0]["rows"]}
        bases = {
            x["ID_BASE"] for x in reports if x["ID_BASE"] not in ("0", "<NULL>", "")
        }
        connections = {}
        for id in sorted(bases):
            obj, _ = ReportConnection.objects.get_or_create(
                unit=unit,
                legacy__source="172.16.0.123",
                legacy__id=id,
                defaults={
                    "name": "Oracle legado · base " + id,
                    "engine": "oracle",
                    "enabled": False,
                    "legacy": {
                        "source": "172.16.0.123",
                        "id": id,
                        "pending": "Identificar Oracle de origem; substituir o cache Firebird",
                    },
                },
            )
            connections[id] = obj
        rm = {}
        cm = {}
        issues = []
        for r in reports:
            id = r["ID_RELATORIO"]
            procedure = r["PROCEDIMENTO"]
            name = r["NOME_RELATORIO"] or r["DESCRICAO"] or "Relatório legado " + id
            sql = definitions.get(id, "")
            source = "sql"
            deps = []
            candidate = ""
            if r["MULTIPLOS_RELATORIOS"] == "S":
                source = "composite"
                deps.append("Revisar componentes e fórmulas do relatório composto")
            elif procedure.lower().endswith(".pdf"):
                source = "external_file"
                deps.append("Arquivo-fonte externo e rotina de publicação pendentes")
            elif procedure and procedure.upper() != "SINCRONIZAR":
                deps.append(
                    "Converter procedure Firebird para consulta direta no Oracle: "
                    + procedure
                )
            elif sql:
                if r["ID_BASE"] != "3":
                    candidate = sql
                else:
                    deps.append(
                        "Substituir consulta ao cache Firebird por consulta Oracle"
                    )
            else:
                deps.append("Definição de consulta não recuperada")
            upper = name.upper()
            if any(x in upper for x in ("SINCR", "LIMPAR", "ALTERAR MES")):
                source = "legacy_pending"
                candidate = ""
                deps.append("Rotina interna; não executar como relatório de leitura")
            if any(
                x in upper
                for x in (
                    "WHATS",
                    "ROB8",
                    "TEMPLATE",
                    "MENSAG",
                    "BUSCA ATIVA",
                    "CONFIRMAD",
                    "CONFIRMAC",
                )
            ):
                source = "application_pending"
                candidate = ""
                deps.append(
                    "Integração com mensagens/robô/Meta pendente; preservada sem implementação"
                )
            schemas = {}
            for t in params:
                if t["ID_RELATORIO"] != id:
                    continue
                key = t["NOME"]
                if key.startswith("WPA_"):
                    schemas[key] = {
                        "type": "date"
                        if "DATA" in t["TIPO"]
                        else "integer"
                        if t["TIPO"] == "NUMERICO"
                        else "string",
                        "required": True,
                    }
            keywords = [w["PALAVRA_CHAVE"] for w in words if w["ID_RELATORIO"] == id]
            obj, _created = ReportDefinition.objects.get_or_create(
                unit=unit,
                code="legacy123-" + id,
                defaults={
                    "name": name[:200],
                    "catalog_kind": "report" if str(id) in delivery_ids else "component",
                    "review_queue": bool(
                        re.search(
                            r"\b(?:SINCR[A-Z]*|LIMPAR|LIMPEZA|APAGAR|EXCLUIR)(?:\b|_)",
                            unicodedata.normalize("NFKD", name)
                            .encode("ascii", "ignore")
                            .decode()
                            .upper(),
                        )
                    ),
                    "keyword": keywords[0][:80] if keywords else "",
                    "keywords": keywords,
                    "source": source,
                    "connection": connections.get(r["ID_BASE"]),
                    "query_sql": candidate,
                    "parameter_schema": schemas,
                    "enabled": False,
                    "reviewed": False,
                    "manual_enabled": True,
                    "unavailable_reason": "; ".join(deps),
                    "dependencies": deps,
                    "legacy": {
                        "source": "172.16.0.123",
                        "record": r,
                        "original_sql": sql,
                        "parameters": [t for t in params if t["ID_RELATORIO"] == id],
                    },
                    "components": [
                        {"code": "legacy123-" + t["ID_RELATORIO_MULTIPLOS"]}
                        for t in parts
                        if t["ID_RELATORIO"] == id
                    ],
                    "output_format": "csv"
                    if r["RETORNO_TEXTO"] == "P"
                    else "text"
                    if r["RETORNO_TEXTO"] == "S"
                    else "pdf",
                },
            )
            rm[id] = obj
        for a in contacts:
            address = a["CELULAR"].strip()
            kind = "group" if address.endswith("@g.us") else "phone"
            # Preserve the exact legacy address; normalization requires explicit review.
            obj, _created = ReportRecipient.objects.get_or_create(
                unit=unit,
                legacy_key="legacy123-" + a["ID_ADM"],
                defaults={
                    "address": address,
                    "name": a["NOME_ADM"][:200],
                    "kind": kind,
                    "active": False,
                    "manual_enabled": a["SOMENTE_RECEBE_RELATORIO"] != "S",
                    "legacy": {"source": "172.16.0.123", "record": a},
                },
            )
            cm[a["ID_ADM"]] = obj
        for g in grants:
            report = rm.get(g["ID_RELATORIO"])
            recipient = cm.get(g["ID_ADM"])
            if not report or not recipient:
                issues.append({"kind": "orphan_permission", "record": g})
                continue
            ReportGrant.objects.get_or_create(
                unit=unit,
                report=report,
                recipient=recipient,
                defaults={
                    "active": False,
                    "manual": True,
                    "automatic": True,
                    "legacy": {"record": g},
                },
            )
        for s in schedules:
            report = rm.get(s["ID_RELATORIO"])
            recipient = cm.get(s["ID_ADM"])
            if not report or not recipient:
                issues.append({"kind": "orphan_schedule", "record": s})
                continue
            if not ReportAutomation.objects.filter(
                unit=unit, legacy__source="172.16.0.123", legacy__record__ID=s["ID"]
            ).exists():
                ReportAutomation.objects.create(
                    unit=unit,
                    report=report,
                    recipient=recipient,
                    send_time=s["TIME_START"],
                    weekdays=[
                        i
                        for i, k in enumerate(
                            ("SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM")
                        )
                        if s[k] == "S"
                    ],
                    enabled=False,
                    legacy={
                        "source": "172.16.0.123",
                        "record": s,
                        "TIPO": s["TIPO"],
                        "DIA_FIXO": s["DIA_FIXO"],
                        "MES_ANO": s["MES_ANO"],
                        "permission_missing": not any(
                            g["ID_ADM"] == s["ID_ADM"]
                            and g["ID_RELATORIO"] == s["ID_RELATORIO"]
                            for g in grants
                        ),
                    },
                )
        for w in words:
            if w["ID_RELATORIO"] not in rm:
                issues.append({"kind": "orphan_keyword", "record": w})
        if (root / "source_descriptions.json").exists():
            from operations.legacy_sources import describe_sources

            describe_sources(unit, load("source_descriptions.json"))
        Audit.objects.create(
            unit=unit,
            action="report.legacy_imported",
            object_id="172.16.0.123",
            details={"reports": len(rm), "contacts": len(cm), "issues": issues},
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Catálogo: {len(rm)}; destinatários: {len(cm)}; inconsistências: {len(issues)}. Todos os novos registros estão desativados."
            )
        )
