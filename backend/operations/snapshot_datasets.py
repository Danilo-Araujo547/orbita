"""Typed, aggregate-only historical datasets. Never invokes legacy procedures."""
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from .models import ReportSnapshotDataRow

KINDS = {"beds": "Leitos totais", "capacity": "Capacidade SUS/convênio", "lives": "Vidas Sansaúde"}
COLUMNS = {
    "capacity": ["CD_UNID_INT", "DS_UNID_INT", "SUS", "CONVENIO", "TOTAL", "DATA"],
    "lives": ["TP_CONTRATO", "SN_ATIVO", "DATA_FILTRO", "TOTAL"],
}


def contract(config, *, require_source):
    from .bed_snapshots import SnapshotError
    kind = config.dataset_kind
    if kind not in KINDS or type(config.reference_offset_days) is not int:
        raise SnapshotError("invalid_source", "Tipo de coleta inválido.")
    if config.reference_offset_days not in ({-1, 0} if kind == "lives" else {0}):
        raise SnapshotError("invalid_source", "Referência inválida para este tipo de coleta.")
    connection = config.source_report.connection
    if connection and connection.database.casefold() == "hmlvotu" and config.environment != "homologation":
        raise SnapshotError("invalid_source", "A conexão hmlvotu deve permanecer identificada como homologação.")
    schema = config.source_report.parameter_schema
    if kind == "lives":
        if (set(schema) != {"data_alvo"} or schema["data_alvo"].get("type") != "date"
            or not schema["data_alvo"].get("required", True) or "default" in schema["data_alvo"]):
            raise SnapshotError("invalid_source", "Vidas exige o parâmetro de data data_alvo, preenchido pela coleta.")
    elif schema:
        raise SnapshotError("invalid_source", "Esta coleta não aceita parâmetros externos.")
    if require_source and not config.source_report.query_sql.strip():
        raise SnapshotError("source_unavailable", "A query de coleta ainda não foi validada.")


def integer(value):
    number = Decimal(str(value))
    if not number.is_finite() or number != number.to_integral() or not 0 <= number <= 2147483647:
        raise ValueError()
    return int(number)


def source_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value)).date()


def parse_rows(headers, values, config, reference_date):
    from .bed_snapshots import SnapshotError
    kind = config.dataset_kind
    if [str(h).upper() for h in headers] != COLUMNS.get(kind) or not values or len(values) > 1000:
        raise SnapshotError("invalid_result", "Colunas ou quantidade de registros incompatíveis com a coleta.")
    seen, result = set(), []
    try:
        for row in values:
            if kind == "lives":
                contract_type, active, stamp, amount = row
                if contract_type not in {"E", "I", "A"} or active not in {"S", "N"}:
                    raise ValueError()
                key = contract_type + ":" + active
                payload = {"contract": contract_type, "active": active, "date": reference_date.isoformat(), "total": integer(amount)}
            elif kind == "capacity":
                code, name, sus, convenio, total, stamp = row
                code, sus, convenio, total = integer(code), integer(sus), integer(convenio), integer(total)
                if code < 1 or not isinstance(name, str) or not name.strip() or len(name) > 150 or sus + convenio != total:
                    raise ValueError()
                key = str(code)
                payload = {"ward_code": code, "ward_name": name, "sus": sus, "convenio": convenio, "total": total, "date": reference_date.isoformat()}
            else:
                raise ValueError()
            if source_date(stamp) != reference_date or key in seen:
                raise ValueError()
            seen.add(key)
            result.append(ReportSnapshotDataRow(unit_id=config.unit_id, record_key=key, payload=payload))
        if kind == "lives" and {r.payload["contract"] for r in result} != {"E", "I", "A"}:
            raise ValueError()
    except (ValueError, TypeError, InvalidOperation, OverflowError):
        raise SnapshotError("invalid_result", "Data, chave, contagem ou rateio inválido na origem.") from None
    return result
