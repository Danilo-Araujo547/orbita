"""Monthly targets belong to the report definition, never to patient input."""
from rest_framework.exceptions import ValidationError


def normalize_goals(value):
    if not isinstance(value, list) or len(value) > 600:
        raise ValidationError("Informe até 600 metas mensais.")
    result, seen = [], set()
    for row in value:
        if not isinstance(row, dict) or set(row) != {"year", "month", "value"}:
            raise ValidationError("Cada meta deve conter ano, mês e valor.")
        year, month, target = row["year"], row["month"], row["value"]
        if type(year) is not int or not 2000 <= year <= 2199 or type(month) is not int or not 1 <= month <= 12:
            raise ValidationError("Competência inválida.")
        if type(target) is not int or not 0 <= target <= 100_000_000:
            raise ValidationError("A meta deve ser um número inteiro não negativo.")
        key = (year, month)
        if key in seen:
            raise ValidationError("Já existe uma meta para essa competência.")
        seen.add(key)
        result.append({"year": year, "month": month, "value": target})
    return sorted(result, key=lambda row: (row["year"], row["month"]))
