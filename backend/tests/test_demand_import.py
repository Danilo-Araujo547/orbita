import csv
import io

import pytest
from operations.demand_csv import HEADERS, parse_demand
from rest_framework.exceptions import ValidationError

from core.models import Unit
from messaging.models import Message
from operations.models import Case, Contact, ImportLayout, SourceEvent
from operations.sheets import confirm_sheet, preview_sheet


def sheet(
    *,
    phone="(11)999990001 (11)999990002 ()",
    stamp="2026-10-13 10:30:00",
    duplicate=False,
    observation="Observação original",
):
    row = [""] * 31
    for index, value in {
        0: "000123",
        1: "PACIENTE FICTÍCIO",
        2: phone,
        3: "MUNICÍPIO TESTE",
        4: "ESPECIALIDADE TESTE",
        6: "1ª Consulta",
        13: stamp,
        14: "Qualificação Pendente",
        19: observation,
        20: "Status original",
        23: "Nota de alteração",
        28: "Outra nota",
    }.items():
        row[index] = value
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";")
    writer.writerow(HEADERS)
    writer.writerow(row)
    if duplicate:
        writer.writerow(row)
    return out.getvalue().encode("cp1252")


def test_demand_encoding_dates_repeated_headers_and_multiple_contacts():
    row = parse_demand(sheet())[0]
    assert row["external_id"] == "000123"
    assert row["source_observation"] == "Observação original"
    assert row["source_status_observation"] == "Status original"
    assert row["phone_numbers"] == ["5511999990001", "5511999990002"]
    assert row["occurred_at"] == "2026-10-13T10:30:00"
    assert row["source_appointment_date"] == ""
    assert row["source_status"] == "Qualificação Pendente"
    assert "patient_external_id" not in row
    utf8 = sheet().decode("cp1252").encode("utf-8-sig")
    assert parse_demand(utf8) == parse_demand(sheet())


def test_demand_repeated_number_and_empty_slots():
    row = parse_demand(sheet(phone="() (11)999990001 (11)999990001"))[0]
    assert row["phone_numbers"] == ["5511999990001"]


@pytest.mark.parametrize(
    "content",
    [
        b"Nome;Telefone\nTESTE;11999990001",
        b"",
        sheet().replace(b";Nome;", b";Paciente;", 1),
    ],
)
def test_demand_rejects_incompatible_structure(content):
    with pytest.raises((ValueError, StopIteration)):
        parse_demand(content)


@pytest.mark.django_db
def test_demand_import_keeps_one_record_and_all_contacts_without_sending(setup):
    layout = ImportLayout.objects.create(
        unit=setup["unit"], name="Demanda", format="cross_demand_csv", verified=True
    )
    before = Message.objects.count()
    batch = preview_sheet(
        setup["unit"], layout, setup["user"], "demanda.csv", sheet(duplicate=True)
    )
    assert not batch.errors and batch.duplicates == 1 and len(batch.rows) == 1
    assert batch.rows[0]["occurred_at"].endswith("-03:00")
    with pytest.raises(ValidationError):
        confirm_sheet(batch, "summons")
    ids = confirm_sheet(batch, "waitlist")
    assert len(ids) == 1
    assert Case.objects.filter(pk__in=ids, purpose="waitlist").count() == 1
    assert Contact.objects.filter(event__source=f"cross:{layout.pk}").count() == 2
    assert Message.objects.count() == before
    assert (
        preview_sheet(
            setup["unit"], layout, setup["user"], "demanda.csv", sheet(duplicate=True)
        ).pk
        == batch.pk
    )
    with pytest.raises(ValidationError):
        confirm_sheet(batch, "waitlist")
    changed = preview_sheet(
        setup["unit"],
        layout,
        setup["user"],
        "changed.csv",
        sheet(observation="Alterada"),
    )
    with pytest.raises(ValidationError):
        confirm_sheet(changed, "waitlist")
    assert SourceEvent.objects.filter(source=f"cross:{layout.pk}").count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    "kwargs",
    [
        {"phone": "() () ()"},
        {"phone": "(11)999990001 texto inesperado"},
        {"stamp": "2026-99-13 10:30:00"},
    ],
)
def test_demand_invalid_rows_cannot_be_confirmed(setup, kwargs):
    layout = ImportLayout.objects.create(
        unit=setup["unit"], name="Demanda", format="cross_demand_csv", verified=True
    )
    batch = preview_sheet(
        setup["unit"], layout, setup["user"], "demanda.csv", sheet(**kwargs)
    )
    assert batch.errors
    with pytest.raises(ValidationError):
        confirm_sheet(batch, "waitlist")


@pytest.mark.django_db
def test_demand_layout_unit_and_extension_are_checked(setup):
    layout = ImportLayout.objects.create(
        unit=setup["unit"], name="Demanda", format="cross_demand_csv", verified=True
    )
    other = Unit.objects.create(slug="other", name="OTHER")
    for unit, filename in [(other, "demanda.csv"), (setup["unit"], "demanda.xlsx")]:
        with pytest.raises(ValidationError):
            preview_sheet(unit, layout, setup["user"], filename, sheet())
    layout.verified = False
    with pytest.raises(ValidationError):
        preview_sheet(setup["unit"], layout, setup["user"], "demanda.csv", sheet())
