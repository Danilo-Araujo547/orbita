import type { CanvasBlock, CanvasSource, CatalogSqlSource } from "./model";

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
// Neutral, explicitly labeled structure: no realistic names or fake dates.
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

  const periodColumn =
    /^(?:\d{4}|(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{2}|\d{2}\/\d{2}(?:\/\d{4})?)$/i;

  const x = options.x_field || fields[0] || "Exemplo";
  const numeric = new Set([
    ...(options.y_fields || []),
    ...(options.value_field ? [options.value_field] : []),
  ]);

  if (!numeric.size) {
    const amount = fields.find((c) =>
      /total|quant|valor|media|média|percent|taxa|qtd|count|exames|atendimentos|consultas?|procedimentos?|pacientes?|dias|leitos|meta/i.test(
        c,
      ),
    );
    if (amount) {
      numeric.add(amount);
    } else if (block.type !== "table") {
      numeric.add(fields[1] || "Valor");
    }
  }

  const columns =
    block.type === "table"
      ? [...fields]
      : Array.from(new Set([x, ...fields, ...numeric]));

  const rowCount = 6;
  const rows = Array.from({ length: rowCount }, (_, i) =>
    columns.map((column, j) => {
      const isNum =
        numeric.has(column) ||
        periodColumn.test(column) ||
        /total|quant|valor|media|média|percent|taxa|qtd|count|exames|atendimentos|consultas?|procedimentos?|pacientes?|dias|leitos|ocupa|razão|meta|^sus$|convênio|particular|sansaúde|iamspe|^m\d+$|^ano$|^year$|^cd_|^id$/i.test(
          column,
        );

      if (isNum) {
        return (i + 1) * 10 + j * 5;
      }
      return `Exemplo ${i + 1}`;
    }),
  );

  return { columns, rows, isPlaceholder: true };
}

export const sampleDataset = placeholderDataset;
