import type { AggregateMode, CanvasBlock, CanvasSource, CatalogSqlSource } from "../model";
import { clamp, parseNumberOrNull } from "../model";

export interface KpiPreviewProps {
  block: CanvasBlock;
  source: CanvasSource;
  catalog?: CatalogSqlSource;
  dataset: { columns: string[]; rows: unknown[][] };
  fontSize: number;
  primaryColor: string;
  showSampleData: boolean;
}

export default function KpiPreview({
  block,
  source,
  catalog,
  dataset,
  fontSize,
  primaryColor,
  showSampleData,
}: KpiPreviewProps) {
  const opt = block.options || {};

  if (source.type === "report" && !showSampleData) {
    const sourceLabel = catalog
      ? `${catalog.name} (${catalog.code})`
      : `Relatório #${source.report_id}`;
    return (
      <div className="rc-block-inner">
        {block.title && <div className="rc-block-title">{block.title}</div>}
        <div className="rc-kpi-body">
          <div className="rc-kpi-value" style={{ fontSize: `${fontSize}px`, color: primaryColor }}>
            —
          </div>
          <div className="rc-kpi-meta">
            Dados · {source.id} ({opt.aggregate === "count" ? "Contagem" : opt.value_field || "coluna padrão"})
          </div>
          <div className="rc-kpi-meta">{sourceLabel}</div>
        </div>
      </div>
    );
  }

  const mode: AggregateMode = opt.aggregate || "sum";
  const precision = Math.round(clamp(Number(opt.precision) || 0, 0, 4));
  let val: number | null = null;
  const targetCol =
    opt.value_field || (dataset.columns.length > 1 ? dataset.columns[1] : dataset.columns[0]);
  if (dataset.rows.length > 0) {
    if (mode === "count") {
      val = dataset.rows.length;
    } else {
      const colIdx = dataset.columns.indexOf(targetCol || "");
      if (colIdx >= 0) {
        const nums = dataset.rows
          .map((r) => parseNumberOrNull(r[colIdx]))
          .filter((n): n is number => n !== null);
        if (nums.length > 0) {
          val = mode === "sum" ? nums.reduce((a, b) => a + b, 0) : nums[0];
        }
      }
    }
  }
  const formatted =
    val === null
      ? "—"
      : mode === "count" && !opt.precision
        ? val.toLocaleString("pt-BR")
        : val.toLocaleString("pt-BR", {
            minimumFractionDigits: precision,
            maximumFractionDigits: precision,
          });

  return (
    <div className="rc-block-inner">
      {block.title && <div className="rc-block-title">{block.title}</div>}
      <div className="rc-kpi-body">
        <div className="rc-kpi-value" style={{ fontSize: `${fontSize}px`, color: primaryColor }}>
          {formatted}
        </div>
        <div className="rc-kpi-meta">
          {source.id} ·{" "}
          {mode === "count"
            ? "Contagem"
            : `${mode === "sum" ? "Soma" : "Primeiro"} (${targetCol || "—"})`}
        </div>
      </div>
    </div>
  );
}
