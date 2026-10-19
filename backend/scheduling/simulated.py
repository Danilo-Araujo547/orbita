"""Local, read-only appointment source. Never connected to WhatsApp transport."""

import sqlite3
from contextlib import contextmanager
from dataclasses import replace
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from scheduling.connectors import normalize_row


def create_source(path, unit, start_month):
    path = Path(path).resolve()
    if path.exists():
        # Existing sources are preserved, including any locally edited test data.
        with SQLiteSource(unit, path).connect() as connection:
            connection.execute("SELECT * FROM VW_AGENDAMENTOS_SIMULADOS LIMIT 1")
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as connection:
        connection.execute("""CREATE TABLE atendimentos (
            UNIDADE TEXT NOT NULL, KIND TEXT NOT NULL, CD_AGENDA TEXT PRIMARY KEY,
            CD_PACIENTE TEXT NOT NULL, PACIENTE TEXT NOT NULL, CELULAR TEXT NOT NULL,
            CELULAR_2 TEXT, ESPECIALIDADE TEXT NOT NULL, TIPO_CONSULTA TEXT NOT NULL,
            DTA_AGENDA TEXT NOT NULL, HORA_MARCADA TEXT NOT NULL,
            HORA_CHEGADA TEXT NOT NULL, MEDICO TEXT NOT NULL, CIDADE TEXT NOT NULL)""")
        connection.execute("CREATE VIEW VW_AGENDAMENTOS_SIMULADOS AS SELECT * FROM atendimentos")
        for index in range(30):
            month_index = start_month.year * 12 + start_month.month - 1 + index // 10
            year, month = divmod(month_index, 12)
            day = date(year, month + 1, 20 if index % 10 < 5 else 27)
            kind = ("consultation", "exam", "lab")[index % 3]
            procedure = {"consultation": "Cardiologia", "exam": "Ultrassonografia", "lab": "Hemograma"}[kind]
            connection.execute(
                "INSERT INTO atendimentos VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    unit.slug,
                    kind,
                    f"SIM-{index + 1:03}",
                    f"SIM-P-{index + 1:03}",
                    f"Paciente simulado {index + 1:02}",
                    f"1190000{index + 1:04}",
                    f"1190001{index + 1:04}" if index % 5 == 0 else "",
                    procedure,
                    "DA SUA CONSULTA" if kind == "consultation" else "DO SEU EXAME",
                    day.isoformat(),
                    f"{8 + index % 8:02}:30",
                    f"{8 + index % 8:02}:00",
                    "Profissional simulado",
                    "Votuporanga",
                ),
            )
    return path


class SQLiteSource:
    def __init__(self, unit, path=None):
        self.unit = unit
        self.path = Path(path or settings.SIMULATED_SQLITE_PATH).resolve()

    def credentials(self):
        return (self.path.is_file(),)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        try:
            yield connection
        finally:
            connection.close()

    def batches(self):
        with self.connect() as connection:
            return [
                (row[0], date.fromisoformat(row[1]))
                for row in connection.execute(
                    "SELECT DISTINCT KIND, DTA_AGENDA FROM VW_AGENDAMENTOS_SIMULADOS WHERE UNIDADE=? ORDER BY DTA_AGENDA,KIND",
                    (self.unit.slug,),
                )
            ]

    def fetch(self, kind, target_date, timezone, external_ids=None):
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM VW_AGENDAMENTOS_SIMULADOS WHERE UNIDADE=? AND KIND=? AND DTA_AGENDA=? ORDER BY CD_AGENDA",
                (self.unit.slug, kind, target_date.isoformat()),
            ).fetchall()
        result = []
        for raw in rows:
            row = dict(raw)
            if external_ids is not None and row["CD_AGENDA"] not in external_ids:
                continue
            row["DTA_AGENDA"] = datetime.fromisoformat(row["DTA_AGENDA"])
            data = normalize_row(row, kind, timezone)
            phones = tuple(filter(None, (data.phone, row["CELULAR_2"])))
            result.append(replace(data, source="sqlite_simulated", synthetic=True, phone_numbers=phones))
        return result


@transaction.atomic
def import_simulated(unit, actor=None):
    from core.models import Audit

    from scheduling.connectors import appointment_source
    from scheduling.models import Rule
    from scheduling.services import queue_appointment, upsert_appointment

    source = appointment_source(unit)
    if not isinstance(source, SQLiteSource):
        raise ValueError("Fonte SQLite não configurada para esta unidade.")
    now, count = timezone.now(), 0
    rules = {}
    batches = source.batches()
    for kind, _ in batches:
        rules[kind] = (
            Rule.objects.filter(unit=unit, kind=kind, response_condition="any", enabled=True)
            .select_related("template", "unit")
            .order_by("-days_before", "code")
            .first()
        )
        if rules[kind] is None:
            raise ValueError(f"Regra não configurada: {kind}.")
    for kind, day in batches:
        rule = rules[kind]
        stamp = datetime.combine(
            day - timedelta(days=rule.days_before), rule.send_time, ZoneInfo(unit.timezone)
        )
        for data in source.fetch(kind, day, unit.timezone):
            appointment = upsert_appointment(unit, data)
            queue_appointment(appointment, rule, max(stamp, now), now)
            count += 1
    Audit.objects.create(
        unit=unit, actor=actor, action="source.simulated_imported", details={"appointments": count}
    )
    return {"imported": count, "source": "sqlite_simulated"}
