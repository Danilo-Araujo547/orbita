import os
import re
from dataclasses import dataclass, replace
from datetime import datetime, time
from typing import Protocol
from zoneinfo import ZoneInfo

from django.conf import settings

VIEWS = {
    "consultation": "DBASISTEMAS.VDIC_CONSULTA_AGENDA_ENVIO_MSG",
    "exam": "DBASISTEMAS.VDIC_EXAME_AGENDA_ENVIO_MSG",
    "lab": "DBASISTEMAS.VDIC_LAB_AGENDA_ENVIO_MSG",
}


@dataclass(frozen=True)
class AppointmentData:
    external_id: str
    kind: str
    patient: str
    phone: str
    procedure: str
    appointment_type: str
    scheduled_at: datetime
    arrival_time: str
    source: str = "oracle"
    synthetic: bool = False
    data_issue: str = ""
    procedure_code: str = ""
    patient_external_id: str = ""
    phone_numbers: tuple[str, ...] = ()
    professional: str = ""
    city: str = ""


class AppointmentSource(Protocol):
    def fetch(self, kind: str, target_date, timezone: str) -> list[AppointmentData]: ...


def appointment_source(unit):
    if settings.SIMULATED_SQLITE_PATH and unit.slug == settings.SIMULATED_SQLITE_UNIT:
        from scheduling.simulated import SQLiteSource

        return SQLiteSource(unit)
    return OracleSource(unit)


def consolidate_rows(rows):
    """Consolidate the appointment, preserving each distinct contact as a recipient."""
    groups = {}
    for row in rows:
        groups.setdefault((row.kind, row.external_id), set()).add(row)
    consolidated = []
    for values in groups.values():
        ordered = sorted(values, key=lambda row: (row.patient, row.phone, row.procedure, row.arrival_time))
        first = ordered[0]
        non_phone = {replace(row, phone="", phone_numbers=()) for row in ordered}
        phones = set()
        for row in ordered:
            for phone in (*row.phone_numbers, row.phone):
                if phone:
                    try:
                        phone = normalize_phone(phone)
                    except ValueError:
                        phone = str(phone).strip()
                    phones.add(phone)
        first = replace(
            first,
            phone=sorted(phones)[0] if phones else "",
            phone_numbers=tuple(sorted(phones)),
            data_issue="ambiguous_source_record" if len(non_phone) > 1 else first.data_issue,
        )
        consolidated.append(first)
    return sorted(consolidated, key=lambda row: (row.kind, row.external_id))


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) in (10, 11):
        digits = "55" + digits
    if not re.fullmatch(r"55[1-9][0-9]{9,10}", digits):
        raise ValueError("invalid_phone_format")
    return digits


def normalize_row(row, kind, timezone):
    day = row["DTA_AGENDA"].date()
    hour = str(row.get("HORA_MARCADA") or "").strip()
    if not re.fullmatch(r"\d{2}:\d{2}(:\d{2})?", hour):
        raise ValueError("invalid_appointment_time")
    scheduled = datetime.combine(day, time.fromisoformat(hour), ZoneInfo(timezone))
    arrival = str(row.get("HORA_CHEGADA") or hour).strip()
    phone = str(row.get("CELULAR") or "").strip()
    try:
        phone = normalize_phone(phone)
    except ValueError:
        pass
    # MENSAGEM is deliberately ignored; template parameters come from separate fields.
    return AppointmentData(
        external_id=str(row["CD_AGENDA"]),
        kind=kind,
        patient=str(row.get("CROSS") or row["PACIENTE"]).strip(),
        phone=phone,
        procedure=str(row.get("ESPECIALIDADE") or "Coleta de exame").strip(),
        appointment_type=("DA SUA COLETA DE EXAME" if kind == "lab" else str(row.get("TIPO_CONSULTA") or "")),
        scheduled_at=scheduled,
        arrival_time=arrival,
        patient_external_id=str(row.get("CD_PACIENTE") or ""),
        professional=str(row.get("MEDICO") or "").strip(),
        city=str(row.get("CIDADE") or "").strip(),
    )


class OracleSource:
    def __init__(self, unit=None):
        self.unit = unit

    def credentials(self):
        from core.oracle_credentials import connection_payload

        payload = connection_payload(self.unit)
        if payload:
            import oracledb

            target = {"service_name" if payload["identifier_type"] == "service" else "sid": payload["identifier"]}
            return oracledb.makedsn(payload["host"], payload["port"], **target), payload["username"], payload["password"]
        if self.unit is None or self.unit.slug == "ame":
            return settings.ORACLE_DSN, settings.ORACLE_USER, settings.ORACLE_PASSWORD
        prefix = "ORACLE_" + re.sub(r"[^A-Z0-9]", "_", self.unit.slug.upper()) + "_"
        return tuple(os.getenv(prefix + key, "") for key in ["DSN", "USER", "PASSWORD"])

    def connect(self):
        from core.oracle_credentials import connect, connection_payload

        payload = connection_payload(self.unit)
        if payload:
            return connect(payload)
        import oracledb

        dsn, user, password = self.credentials()
        if not all([dsn, user, password]):
            raise ValueError("oracle_not_configured")
        if settings.ORACLE_THICK and oracledb.is_thin_mode():
            oracledb.init_oracle_client(lib_dir=settings.ORACLE_CLIENT_DIR or None)
        connection = oracledb.connect(user=user, password=password, dsn=dsn)
        connection.call_timeout = settings.ORACLE_CALL_TIMEOUT_MS
        return connection

    def fetch(self, kind, target_date, timezone, external_ids=None):
        view = VIEWS[kind]
        if self.unit is not None:
            from operations.models import SourceConfiguration

            configuration = SourceConfiguration.objects.filter(unit=self.unit, kind=kind).first()
            if configuration:
                from operations.connectors import source_view

                view = source_view(configuration)
            elif self.unit.slug != "ame":
                raise ValueError("unit_source_not_configured")
        # Only allow-listed identifiers can enter SQL. Date is always bound.
        sql = f"""SELECT v.CD_AGENDA, {{optional_columns}} v.DTA_AGENDA, v.PACIENTE, v.CELULAR,
                  v.HORA_MARCADA, v.CROSS, v.HORA_CHEGADA, v.ESPECIALIDADE, v.TIPO_CONSULTA
                  FROM {view} v
                  WHERE v.DTA_AGENDA = :target_date AND v.CELULAR IS NOT NULL
                  AND v.CD_AGENDA NOT IN (
                    SELECT cd_agenda FROM DBASISTEMAS.TBL_LOG_MEGA_MSG WHERE sn_enviado = 'S'
                  ) ORDER BY v.CD_AGENDA"""
        with self.connect() as connection:
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SET TRANSACTION READ ONLY")
                    cursor.execute(f"SELECT * FROM {view} WHERE 1=0")
                    available = {col[0] for col in cursor.description}
                    optional_columns = ", ".join(
                        f"v.{col}" for col in ["CD_PACIENTE", "MEDICO", "CIDADE"] if col in available
                    )
                    sql = sql.replace(
                        "{optional_columns}", optional_columns + ", " if optional_columns else ""
                    )
                    binds = {"target_date": datetime.combine(target_date, time.min)}
                    if external_ids is not None:
                        if not external_ids or len(external_ids) > 500:
                            raise ValueError("invalid_source_batch")
                        binds = {f"id_{i}": value for i, value in enumerate(external_ids)}
                        # Refresh only records already stored locally, independently of the legacy send log.
                        sql = (
                            sql[: sql.index("WHERE v.DTA_AGENDA")]
                            + "WHERE v.CD_AGENDA IN ("
                            + ", ".join(":" + key for key in binds)
                            + ") ORDER BY v.CD_AGENDA"
                        )
                    cursor.execute(sql, binds)
                    columns = [col[0] for col in cursor.description]
                    rows = [normalize_row(dict(zip(columns, row)), kind, timezone) for row in cursor]
                    return consolidate_rows(rows)
            finally:
                connection.rollback()
