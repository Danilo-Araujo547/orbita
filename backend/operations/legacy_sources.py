"""Attach source provenance without enabling legacy connections or reports."""

from django.db import transaction
from operations.models import ReportConnection, ReportDefinition


@transaction.atomic
def describe_sources(unit, descriptions):
    by_id = {str(x["legacy_id"]): x for x in descriptions}
    for id, entry in by_id.items():
        obj = ReportConnection.objects.filter(
            unit=unit, legacy__source="172.16.0.123", legacy__id=id
        ).first()
        if obj is None:
            obj = ReportConnection.objects.create(
                unit=unit,
                name=entry["display_name"],
                engine="postgres"
                if entry["source_config"]["engine"] == "POSTGRESS"
                else "oracle",
                legacy={"source": "172.16.0.123", "id": id},
            )
        before = obj.legacy or {}
        if obj.name.startswith("Oracle legado") or obj.name == before.get(
            "description_auto_name"
        ):
            obj.name = entry["display_name"]
        obj.legacy = {**before, **entry, "description_auto_name": entry["display_name"]}
        fields = ["name", "legacy"]
        config = entry["source_config"]
        # Populate only known direct origins. Firebird stays documentary, not operational.
        if not obj.enabled and not obj.ciphertext and not obj.username and not obj.host:
            if config["engine"] in {"ORACLE", "POSTGRESS"} and config["host"]:
                obj.engine = "postgres" if config["engine"] == "POSTGRESS" else "oracle"
                obj.host = config["host"]
                obj.port = int(config["port"])
                obj.database = config.get("service") or config["database"]
                obj.validated = False
                fields.extend(["engine", "host", "port", "database", "validated"])
        obj.save(update_fields=fields)
    for report in ReportDefinition.objects.filter(
        unit=unit, code__startswith="legacy123-"
    ):
        original = report.legacy.get("record", {})
        base = by_id.get(str(original.get("ID_BASE")))
        procedure = original.get("PROCEDIMENTO", "")
        is_file = procedure.lower().endswith(".pdf")
        if report.components and report.source == "composite":
            codes = [str(x.get("code", "?")) for x in report.components]
            path = (
                "WhatsReport 172.16.0.123 → composição ordenada: "
                + " → ".join(codes)
                + " → PDF. As fontes estão nos componentes."
            )
        elif is_file:
            producer = {
                "legacy123-162": "PowerPoint",
                "legacy123-163": "Excel",
                "legacy123-309": "Tableau",
            }.get(report.code, "produtor externo não identificado")
            path = f"{producer} → arquivo {procedure} → WhatsReport 172.16.0.123 distribui o PDF. A base de dados do arquivo-fonte ainda precisa ser identificada."
        elif base:
            config = base["source_config"]
            path = f"WhatsReport 172.16.0.123 → {base['data_access_method']} → {config['engine']} {config['host'] or 'host pendente'} / {config['database'] or 'banco pendente'} → "
            path += f"objeto configurado no campo PROCEDIMENTO: {procedure}" if procedure else "SQL cadastrado"
            if original.get("ID_BASE") == "3" and procedure:
                path += ". Dados do cache local: rastrear sincronizadores 59/61 e as tabelas utilizadas; não executar a procedure para descobrir a origem."
            path += ". DBLINK não comprovado."
        else:
            path = "Origem da definição ainda não identificada; conferir componentes e configuração original."
        if base and base["source_config"]["engine"] != "FIREBIRD":
            revised = [v.replace("Converter procedure Firebird para consulta direta no Oracle:", "Validar objeto de origem (view/procedure a identificar):") for v in report.dependencies]
            if revised != report.dependencies:
                report.dependencies = revised
                report.unavailable_reason = report.unavailable_reason.replace("Converter procedure Firebird para consulta direta no Oracle:", "Validar objeto de origem (view/procedure a identificar):")
                report.save(update_fields=["dependencies", "unavailable_reason"])
        report.legacy = {
            **report.legacy,
            "source_path": path,
            "source_base_id": original.get("ID_BASE"),
            "source_location": base["source_config"] if base else None,
            "access_method": base["data_access_method"] if base else "Pendente",
            "dblink_status": "Não identificado nos SQLs cadastrados; interior das procedures não auditado",
        }
        report.save(update_fields=["legacy"])
    return len(by_id)
