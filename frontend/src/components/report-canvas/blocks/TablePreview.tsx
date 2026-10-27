import type { CanvasBlock, CanvasSource, CatalogSqlSource } from "../model";
import { sourceColumns } from "../sampleData";

export interface TablePreviewProps {
  block: CanvasBlock;
  source: CanvasSource;
  catalog?: CatalogSqlSource;
  dataset: { columns: string[]; rows: unknown[][] };
  fontSize: number;
  primaryColor: string;
  axisColor: string;
  showSampleData: boolean;
}

export default function TablePreview({
  block,
  source,
  catalog,
  dataset,
  fontSize,
  primaryColor,
  axisColor,
  showSampleData,
}: TablePreviewProps) {
  const opt = block.options || {};

  if (source.type === "report" && !showSampleData) {
    const sourceLabel = catalog
      ? `${catalog.name} (${catalog.code})`
      : `Relatório #${source.report_id}`;
    const known = sourceColumns(source, catalog);
    const headers = opt.columns?.length ? opt.columns : known.length ? known : [];
    return (
      <div className="rc-block-inner">
        {block.title && <div className="rc-block-title">{block.title}</div>}
        <div className="rc-table-wrap">
          <table className="rc-table-preview">
            <thead>
              <tr>
                {headers.map((c) => (
                  <th key={c} style={{ borderBottomColor: primaryColor }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={100} style={{ color: axisColor }}>
                  Fonte ({source.id}): {sourceLabel} · consultada na geração/prévia
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const chosenCols = opt.columns?.length
    ? opt.columns.filter((c) => dataset.columns.includes(c))
    : dataset.columns;
  const indices = chosenCols.map((c) => dataset.columns.indexOf(c));
  const widths = opt.column_widths;
  const hasValidWidths =
    widths?.length === chosenCols.length && widths.every((w) => Number.isFinite(w) && w > 0);
  const totalWidth = hasValidWidths ? widths!.reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="rc-block-inner">
      {block.title && <div className="rc-block-title">{block.title}</div>}
      {chosenCols.length === 0 ? (
        <div className="rc-sql-placeholder">
          <span className="rc-sql-meta">
            A fonte "{source.id}" não informou as colunas. Configure as colunas da tabela no inspetor.
          </span>
        </div>
      ) : (
        <div className="rc-table-wrap">
          <table
            className="rc-table-preview"
            style={{ fontSize: `${fontSize}px`, tableLayout: "fixed" }}
          >
            {hasValidWidths && (
              <colgroup>
                {widths!.map((weight, i) => (
                  <col key={i} style={{ width: `${(100 * weight) / totalWidth}%` }} />
                ))}
              </colgroup>
            )}
            <thead>
              <tr>
                {chosenCols.map((c) => (
                  <th key={c} style={{ borderBottomColor: primaryColor }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataset.rows.length === 0 ? (
                <tr>
                  <td colSpan={chosenCols.length} style={{ color: axisColor }}>
                    Sem linhas em "{source.id}".
                  </td>
                </tr>
              ) : (
                dataset.rows.slice(0, 14).map((r, ri) => (
                  <tr key={ri}>
                    {indices.map((ci, k) => (
                      <td key={k}>
                        {r[ci] === null || r[ci] === undefined ? "" : String(r[ci])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
