import type { CanvasBlock, CanvasSource, CatalogSqlSource, ColumnDataType } from "./model";

export function sourceColumns(source: CanvasSource, catalog?: CatalogSqlSource): string[] {
  if (source.type === "inline") return source.columns;
  if (source.type === "goals") return ["year", "month", "value"];
  const selected = catalog?.datasets?.find((d) => d.id === (source.dataset || "rows"));
  return catalog?.datasets ? selected?.columns || [] : catalog?.columns || [];
}

export interface PlaceholderDatasetResult {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  isPlaceholder?: boolean;
}

// Editor-only synthetic data. Never inserted into layout.sources or sent to the API.
// Synthetic values are explicitly labeled Exemplo by the editor.
export function placeholderDataset(
  block: CanvasBlock,
  source: CanvasSource,
  catalog?: CatalogSqlSource,
): PlaceholderDatasetResult {
  const options = block.options || {};
  const known = sourceColumns(source, catalog);
  const fields = options.columns?.length ? options.columns : known;

  if (block.type === "table" && !fields.length) {
    return { columns: [], rows: [] };
  }

  const x = options.x_field || fields[0] || "Exemplo";
  const numeric = new Set([
    ...(options.y_fields || []),
    ...(options.value_field ? [options.value_field] : []),
  ]);
  if (!numeric.size && block.type !== "table") numeric.add(fields[1] || "Valor");

  const columns =
    block.type === "table"
      ? [...fields]
      : Array.from(new Set([x, ...fields, ...numeric]));

  const rowCount = 6;
  const rows = Array.from({ length: rowCount }, (_, i) =>
    columns.map((column, j) => {
      const type = numeric.has(column) ? "number" : exampleColumnType(column);
      if (type === "number") return (i + 1) * 10 + j * 5;
      if (type === "date") return `2026-01-${String(i + 1).padStart(2, "0")}`;
      if (type === "boolean") return i % 2 === 0;
      return `Exemplo ${i + 1}`;
    }),
  );

  return { columns, rows, isPlaceholder: true };
}

export const sampleDataset = placeholderDataset;

// Catalogs expose names only. Hints apply solely to synthetic examples;
// a loaded preview always supplies the actual server type.
export function exampleColumnType(name: string): ColumnDataType {
  const key = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/^(nm_|nome|ds_|descricao|sg_)|paciente|status/.test(key)) return "text";
  if (/^(dt_|data(?:_|$))|^date$|nascimento|competencia/.test(key)) return "date";
  if (/^(?:ativo|active|boolean|is_)/.test(key)) return "boolean";
  if (/^(?:\d{4}|(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{2}|\d{2}\/\d{2}(?:\/\d{4})?)$/.test(key)) return "number";
  if (/total|quant|valor|media|percent|taxa|qtd|count|exames|atendimentos|consultas?|procedimentos?|dias|leitos|ocupa|razao|meta|^sus$|convenio|particular|sansaude|iamspe|^m\d+$|^ano$|^year$|^month$|^cd_|^id$|^\d{4}$/.test(key)) return "number";
  return "text";
}
