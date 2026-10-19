import pytest
from operations.models import Case, Contact, ImportLayout, SourceEvent
from operations.sheets import confirm_sheet, preview_sheet
from rest_framework.exceptions import ValidationError
from scheduling.models import Patient


def sheet():
    headers = [
        "Codigo",
        "Paciente",
        "Telefone",
        "Data",
        "Horario",
        "Exame",
        "Solicitante",
        "Executante",
        "Profissional",
        "Motivo",
        "Observacao",
    ]
    text = "<table><tr>" + "".join(f"<th>{h}</th>" for h in headers) + "</tr>"
    for identifier in ["0001", "0002"]:
        cells = [
            "001",
            "PACIENTE TESTE",
            "17999990001<br>17999990002",
            "09/10/2026",
            "10:30",
            "CONSULTA",
            "UNIDADE",
            "AME",
            "PROFISSIONAL",
            "INTERNADO",
            "Original",
        ]
        text += "<tr>" + "".join(f"<td>{c}</td>" for c in cells)
        text += f'<input name="ID_HOR[{identifier}]"></tr>'
    return (text + "</table>").encode()


@pytest.mark.django_db
def test_absence_identity_contacts_originals_and_repeat(setup):
    layout = ImportLayout.objects.create(
        unit=setup["unit"], name="Ausentes", format="absence_html", verified=True
    )
    batch = preview_sheet(setup["unit"], layout, setup["user"], "ausentes.xls", sheet())
    assert not batch.errors
    assert len(batch.rows) == 2
    assert batch.rows[0]["patient_external_id"] == "001"
    assert batch.rows[0]["external_id"] == "0001"
    before = setup["message"].__class__.objects.count()
    ids = confirm_sheet(batch, "absence")
    assert len(ids) == 2
    assert Patient.objects.filter(source=f"absence:{layout.pk}").count() == 1
    assert Contact.objects.filter(event__source=f"absence:{layout.pk}").count() == 4
    assert Case.objects.filter(pk__in=ids, purpose="absence").count() == 2
    assert SourceEvent.objects.get(external_id="0001").data["source_reason"] == "INTERNADO"
    assert setup["message"].__class__.objects.count() == before
    repeated = preview_sheet(setup["unit"], layout, setup["user"], "ausentes.xls", sheet())
    assert repeated.pk == batch.pk
    with pytest.raises(ValidationError):
        confirm_sheet(repeated, "absence")
    assert SourceEvent.objects.filter(source=f"absence:{layout.pk}").count() == 2


@pytest.mark.django_db
def test_absence_rejects_wrong_purpose_binary_and_unit(setup):
    from core.models import Unit

    layout = ImportLayout.objects.create(
        unit=setup["unit"], name="Ausentes", format="absence_html", verified=True
    )
    batch = preview_sheet(setup["unit"], layout, setup["user"], "ausentes.xls", sheet())
    with pytest.raises(ValidationError):
        confirm_sheet(batch, "waitlist")
    with pytest.raises(ValidationError):
        preview_sheet(setup["unit"], layout, setup["user"], "binary.xls", b"\xd0\xcf\x11\xe0")
    other = Unit.objects.create(slug="other", name="OTHER")
    with pytest.raises(ValidationError):
        preview_sheet(other, layout, setup["user"], "ausentes.xls", sheet())
    assert not Case.objects.filter(purpose="absence").exists()
