import math
import re
from datetime import date, datetime, timedelta
from .registry import BLOCKS
from .schema import fail_at, block_label

PT_MONTHS = {
    1: "jan", 2: "fev", 3: "mar", 4: "abr", 5: "mai", 6: "jun",
    7: "jul", 8: "ago", 9: "set", 10: "out", 11: "nov", 12: "dez",
}


def numeric(value, column_name=None, block=None):
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        msg = f'A série "{column_name}" não pode conter valor booleano.' if column_name else "Valor booleano não pode compor uma série numérica."
        fail_at(msg, block_id=block.get("id") if block else None, code="series_not_numeric")
    try:
        result = float(value)
    except (ValueError, TypeError, OverflowError):
        msg = f'A série "{column_name}" precisa ser numérica; a coluna tem texto (ex.: "{value}").' if column_name else "A coluna selecionada deve ser numérica."
        fail_at(msg, block_id=block.get("id") if block else None, code="series_not_numeric")
    if not math.isfinite(result):
        msg = f'A série "{column_name}" possui valor numérico inválido.' if column_name else "Valor numérico inválido."
        fail_at(msg, block_id=block.get("id") if block else None, code="series_not_numeric")
    return result


def field(data, name, block=None):
    if name not in data.columns:
        msg = f'Bloco "{block_label(block)}": coluna "{name}" não encontrada na fonte.' if block else f"Coluna não encontrada: {name}"
        fail_at(msg, block_id=block.get("id") if block else None, code="column_not_found")
    return data.columns.index(name)


def parse_group_date(raw_val, block, col_name):
    if raw_val in (None, ""):
        return None
    if isinstance(raw_val, datetime):
        return raw_val.date()
    if isinstance(raw_val, date):
        return raw_val
    if isinstance(raw_val, str):
        s = raw_val.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
            return dt.date() if isinstance(dt, datetime) else dt
        except (ValueError, TypeError):
            pass
    fail_at(
        f'Gráfico "{block_label(block)}": a coluna "{col_name}" não é uma data (valor "{raw_val}"). Escolha outra coluna ou remova o agrupamento.',
        block_id=block.get("id"),
        code="x_not_a_date",
    )


def aggregate_series(agg_mode, raw_values, series_name, block):
    if agg_mode == "count":
        return sum(1 for v in raw_values if v is not None and v != "")
    nums = [numeric(v, series_name, block) for v in raw_values]
    valid = [v for v in nums if v is not None]
    if not valid:
        return None
    if agg_mode == "sum":
        return sum(valid)
    if agg_mode == "avg":
        return sum(valid) / len(valid)
    if agg_mode == "min":
        return min(valid)
    if agg_mode == "max":
        return max(valid)
    return sum(valid)


class TextBlock:
    def prepare(self, b, ctx):
        def sub(match):
            key = match.group(1)
            value = ctx.parameters.get(key, ctx.report.name if key == "report_name" else match.group(0))
            if "." in key:
                source, column = key.split(".", 1)
                data = ctx.datasets.get(source)
                if data and column in data.columns and data.rows:
                    value = data.rows[0][data.columns.index(column)]
            if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T.*", value):
                try:
                    value = datetime.fromisoformat(value).strftime("%d/%m/%Y %H:%M:%S")
                except ValueError:
                    pass
            if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                try:
                    value = date.fromisoformat(value).strftime("%d/%m/%Y")
                except ValueError:
                    pass
            return str(value)
        return {**b, "text": re.sub(r"{{\s*([A-Za-z][A-Za-z0-9_.]*)\s*}}", sub, b.get("text", ""))}


class ImageBlock:
    def prepare(self, b, ctx):
        return {**b, "image": ctx.assets[b["asset_id"]]}


class TableBlock:
    def prepare(self, b, ctx):
        d = ctx.datasets[b["source_id"]]
        columns = b["options"].get("columns") or d.columns
        widths = b["options"].get("column_widths", [])
        if widths and len(widths) != len(columns):
            fail_at(f'Bloco "{block_label(b)}": informe uma largura para cada coluna da tabela.', block_id=b["id"], code="table_widths_mismatch")
        indices = [field(d, c, b) for c in columns]
        return {**b, "columns": columns, "rows": [[r[i] for i in indices] for r in d.rows]}


class KPIBlock:
    def prepare(self, b, ctx):
        d = ctx.datasets[b["source_id"]]
        opt = b["options"]
        mode = opt.get("aggregate", "sum")
        if not d.rows:
            value = None
        elif mode == "count":
            value = len(d.rows)
        else:
            col_name = opt.get("value_field") or (d.columns[1] if len(d.columns) > 1 else d.columns[0])
            index = field(d, col_name, b)
            values = [numeric(row[index], col_name, b) for row in d.rows]
            values = [v for v in values if v is not None]
            value = (sum(values) if mode == "sum" else values[0]) if values else None
        return {**b, "value": value}


class ChartBlock:
    def prepare(self, b, ctx):
        d = ctx.datasets[b["source_id"]]
        opt = b["options"]
        x = opt.get("x_field") or d.columns[0]
        ys = opt.get("y_fields") or d.columns[1:2]
        if not ys or len(ys) > 6:
            fail_at(f'Bloco "{block_label(b)}": selecione de 1 a 6 séries numéricas.', block_id=b["id"], code="series_count_invalid")
        xi = field(d, x, b)
        indices = [field(d, y, b) for y in ys]

        x_group = opt.get("x_group")
        y_aggregate = opt.get("y_aggregate")

        if x_group:
            agg_mode = y_aggregate or "sum"
            groups = {}
            for r in d.rows:
                d_val = parse_group_date(r[xi], b, x)
                if d_val is None:
                    continue
                if x_group == "day":
                    sort_key = d_val
                    label = d_val.strftime("%d/%m/%Y")
                elif x_group == "week":
                    monday = d_val - timedelta(days=d_val.weekday())
                    sort_key = monday
                    label = f"sem. {monday.strftime('%d/%m')}"
                elif x_group == "month":
                    sort_key = (d_val.year, d_val.month)
                    label = f"{PT_MONTHS[d_val.month]}/{d_val.strftime('%y')}"
                elif x_group == "quarter":
                    q = (d_val.month - 1) // 3 + 1
                    sort_key = (d_val.year, q)
                    label = f"T{q}/{d_val.strftime('%y')}"
                elif x_group == "year":
                    sort_key = d_val.year
                    label = f"{d_val.year}"
                else:
                    fail_at(f'Bloco "{block_label(b)}": agrupamento "{x_group}" inválido.', block_id=b["id"], code="x_group_invalid")

                if sort_key not in groups:
                    groups[sort_key] = (label, [[] for _ in ys])
                for idx, col_idx in enumerate(indices):
                    groups[sort_key][1][idx].append(r[col_idx])

            rows = []
            for sort_key in sorted(groups.keys()):
                label, series_lists = groups[sort_key]
                agg_row = [label]
                for idx, y_name in enumerate(ys):
                    agg_row.append(aggregate_series(agg_mode, series_lists[idx], y_name, b))
                rows.append(agg_row)

        elif y_aggregate:
            groups = {}
            order = []
            for r in d.rows:
                cat = str(r[xi])
                if cat not in groups:
                    groups[cat] = [[] for _ in ys]
                    order.append(cat)
                for idx, col_idx in enumerate(indices):
                    groups[cat][idx].append(r[col_idx])

            rows = []
            for cat in order:
                agg_row = [cat]
                for idx, y_name in enumerate(ys):
                    agg_row.append(aggregate_series(y_aggregate, groups[cat][idx], y_name, b))
                rows.append(agg_row)

        else:
            rows = [[str(r[xi]), *[numeric(r[i], ys[idx], b) for idx, i in enumerate(indices)]] for r in d.rows]

        if len(rows) > 500:
            fail_at(
                f'Gráfico "{block_label(b)}": aceita até 500 pontos, mas gerou {len(rows)} pontos. Agrupe por mês ou semana para reduzir os dados.',
                block_id=b["id"],
                code="chart_points_limit",
            )

        if b["type"] == "pie" and any(r[1] is not None and r[1] < 0 for r in rows):
            fail_at(f'Gráfico "{block_label(b)}": gráfico de pizza não aceita valores negativos.', block_id=b["id"], code="pie_negative_value")

        return {**b, "columns": [x, *ys], "rows": rows}


BLOCKS.register("text", TextBlock())
BLOCKS.register("image", ImageBlock())
BLOCKS.register("table", TableBlock())
BLOCKS.register("kpi", KPIBlock())
for kind in ("line", "bar", "pie"):
    BLOCKS.register(kind, ChartBlock())
