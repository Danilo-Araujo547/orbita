import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Database } from "lucide-react";
import type { CanvasBlock, CanvasSource, CatalogSqlSource } from "../model";
import { BLOCK_LABELS, SERIES_PALETTE, parseNumberOrNull } from "../model";

export interface ChartPreviewProps {
  block: CanvasBlock;
  source: CanvasSource;
  catalog?: CatalogSqlSource;
  dataset: { columns: string[]; rows: unknown[][] };
  primaryColor: string;
  axisColor: string;
  gridColor: string;
  showSampleData: boolean;
}

export default function ChartPreview({
  block,
  source,
  catalog,
  dataset,
  primaryColor,
  axisColor,
  gridColor,
  showSampleData,
}: ChartPreviewProps) {
  const opt = block.options || {};

  if (source.type === "report" && !showSampleData) {
    const sourceLabel = catalog
      ? `${catalog.name} (${catalog.code})`
      : `Relatório #${source.report_id}`;
    return (
      <div className="rc-block-inner">
        {block.title && <div className="rc-block-title">{block.title}</div>}
        <div className="rc-sql-placeholder">
          <span className="rc-sql-badge" style={{ color: primaryColor }}>
            <Database size={11} />
            {BLOCK_LABELS[block.type]} · Dados ({source.id})
          </span>
          <span className="rc-sql-meta">{sourceLabel}</span>
          <span className="rc-sql-meta">
            Eixo X: <strong>{opt.x_field || "1ª coluna"}</strong> · Série(s):{" "}
            <strong>{opt.y_fields?.length ? opt.y_fields.join(", ") : "2ª coluna"}</strong>
          </span>
          <div className="rc-wireframe-bars" aria-hidden="true">
            <span style={{ height: "45%", background: primaryColor }} />
            <span style={{ height: "75%", background: primaryColor }} />
            <span style={{ height: "60%", background: "#14b4cb" }} />
            <span style={{ height: "92%", background: primaryColor }} />
          </div>
        </div>
      </div>
    );
  }

  const xCol =
    opt.x_field && dataset.columns.includes(opt.x_field) ? opt.x_field : dataset.columns[0];
  const rawYs = opt.y_fields?.length ? opt.y_fields : dataset.columns.slice(1, 2);
  const yCols = rawYs.filter((c) => dataset.columns.includes(c)).slice(0, 6);
  const xIdx = xCol ? dataset.columns.indexOf(xCol) : -1;

  if (xIdx < 0 || yCols.length === 0 || dataset.rows.length === 0) {
    return (
      <div className="rc-block-inner">
        {block.title && <div className="rc-block-title">{block.title}</div>}
        <div className="rc-sql-placeholder">
          <span className="rc-sql-badge">
            {BLOCK_LABELS[block.type]} · {source.id}
          </span>
          <span className="rc-sql-meta">
            {dataset.rows.length === 0
              ? source.type === "goals"
                ? "Sem metas mensais cadastradas neste relatório."
                : "Fonte sem linhas para prévia."
              : "Ajuste o eixo X e as séries numéricas no inspetor."}
          </span>
        </div>
      </div>
    );
  }

  const chartData = dataset.rows.slice(0, 80).map((r) => {
    const item: Record<string, string | number | null> = {
      __x: String(r[xIdx] ?? ""),
    };
    for (const yc of yCols) {
      const yi = dataset.columns.indexOf(yc);
      item[yc] = yi >= 0 ? parseNumberOrNull(r[yi]) : null;
    }
    return item;
  });

  const chartW = Math.max(90, Math.floor(block.width - 24));
  const chartH = Math.max(54, Math.floor(block.height - (block.title ? 44 : 20)));
  const palette = [
    primaryColor,
    ...SERIES_PALETTE.filter((c) => c.toLowerCase() !== primaryColor),
  ];

  return (
    <div className="rc-block-inner">
      {block.title && <div className="rc-block-title">{block.title}</div>}
      <div style={{ width: chartW, height: chartH, overflow: "hidden" }}>
        {block.type === "bar" && (
          <BarChart
            width={chartW}
            height={chartH}
            data={chartData}
            margin={{ top: 6, right: 8, bottom: 2, left: -12 }}
          >
            <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="__x"
              tick={{ fill: axisColor, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: axisColor, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip />
            {yCols.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
            {yCols.map((yc, i) => (
              <Bar
                key={yc}
                dataKey={yc}
                name={yc}
                fill={palette[i % palette.length]}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )}
        {block.type === "line" && (
          <LineChart
            width={chartW}
            height={chartH}
            data={chartData}
            margin={{ top: 6, right: 8, bottom: 2, left: -12 }}
          >
            <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="__x"
              tick={{ fill: axisColor, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: axisColor, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip />
            {yCols.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
            {yCols.map((yc, i) => (
              <Line
                key={yc}
                type="monotone"
                dataKey={yc}
                name={yc}
                stroke={palette[i % palette.length]}
                strokeWidth={2}
                dot={{ r: 2.5 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
        {block.type === "pie" &&
          (() => {
            const pieData = chartData.filter(
              (d) => typeof d[yCols[0]] === "number" && Number(d[yCols[0]]) >= 0,
            );
            return (
              <PieChart width={chartW} height={chartH}>
                <Pie
                  data={pieData}
                  dataKey={yCols[0]}
                  nameKey="__x"
                  cx="50%"
                  cy="50%"
                  outerRadius={Math.max(22, Math.floor(Math.min(chartW, chartH) * 0.36))}
                  isAnimationActive={false}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={palette[i % palette.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            );
          })()}
      </div>
    </div>
  );
}
