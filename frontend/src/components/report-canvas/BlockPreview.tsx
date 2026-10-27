import { memo } from "react";
import {sampleDataset, sourceColumns} from "./sampleData";
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
import { Database, Image as ImageIcon } from "lucide-react";
import type { AggregateMode, CanvasBlock, CanvasSource, CanvasAssetMeta, CatalogSqlSource } from "./model";
import { SERIES_PALETTE, BLOCK_LABELS, clamp, validColor, isDarkHex, parseNumberOrNull, interpolateText } from "./model";

interface Props {
  block: CanvasBlock;
  background: string;
  sources: CanvasSource[];
  assets: CanvasAssetMeta[];
  assetUrls: Record<string,string>;
  availableSources: CatalogSqlSource[];
  localDatasets: Map<string,{columns:string[];rows:unknown[][]}>;
  reportName: string;
  showSampleData?: boolean;
}
function BlockPreview({block, background, sources, assets, assetUrls, availableSources, localDatasets, reportName, showSampleData=false}: Props) {
    const displayText=(value:string)=>interpolateText(value,reportName).replace(/\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}/g,(original,id:string,column:string)=>{
      if(!showSampleData)return original;
      const source=sources.find(s=>s.id===id);
      if(!source || source.type!=="report")return original;
      const data=sampleDataset({...block,type:"table",options:{columns:[column]}},source,availableSources.find(c=>c.id===source.report_id));
      return String(data.rows[0]?.[data.columns.indexOf(column)] ?? original);
    });
    const opt = block.options || {};
    const primaryColor = validColor(opt.color, "#075b94");
    const fontSize = clamp(Number(opt.font_size) || 14, 6, 100);
    const pageDark = isDarkHex(background);
    const axisColor = pageDark ? "#9fb3c8" : "#526980";
    const gridColor = pageDark ? "rgba(255,255,255,0.14)" : "#dbe4ee";

    if (block.type === "text") {
      const value=[block.title,block.text].filter(Boolean).map(v=>displayText(v!)).join("\n");
      return (
        <div className="rc-block-inner">
          <div className="rc-block-text-body" style={{fontSize:`${fontSize}px`,color:primaryColor}}>
            {value || "Edite o texto no painel direito"}
          </div>
        </div>
      );
    }

    if (block.type === "image") {
      const blobUrl = block.asset_id ? assetUrls[block.asset_id] : undefined;
      const meta = assets.find((a) => a.id === block.asset_id);
      return (
        <div className="rc-block-inner">
          {blobUrl ? (
            <div className="rc-image-box">
              <img src={blobUrl} alt={meta?.filename || block.title || "Imagem do relatório"} draggable={false} />
            </div>
          ) : (
            <div className="rc-sql-placeholder">
              <span className="rc-sql-badge">
                <ImageIcon size={12} />
                Imagem
              </span>
              <span className="rc-sql-meta">
                {block.asset_id
                  ? meta
                    ? `Carregando ${meta.filename}…`
                    : "Imagem selecionada"
                  : "Selecione ou envie uma imagem no painel direito."}
              </span>
            </div>
          )}
        </div>
      );
    }

    const src = sources.find((s) => s.id === block.source_id);
    if (!src) {
      return (
        <div className="rc-block-inner">
          {block.title && <div className="rc-block-title">{block.title}</div>}
          <div className="rc-sql-placeholder">
            <span className="rc-sql-badge">{BLOCK_LABELS[block.type]}</span>
            <span className="rc-sql-meta">Selecione uma fonte de dados no inspetor à direita.</span>
          </div>
        </div>
      );
    }

    // SQL source: functional placeholder without inventing real data or calling Oracle
    if (src.type === "report" && !showSampleData) {
      const cat = availableSources.find((c) => c.id === src.report_id);
      const sourceLabel = cat ? `${cat.name} (${cat.code})` : `Relatório #${src.report_id}`;
      return (
        <div className="rc-block-inner">
          {block.title && <div className="rc-block-title">{block.title}</div>}
          {block.type === "kpi" ? (
            <div className="rc-kpi-body">
              <div className="rc-kpi-value" style={{ fontSize: `${fontSize}px`, color: primaryColor }}>
                —
              </div>
              <div className="rc-kpi-meta">
                Dados · {src.id} ({opt.aggregate === "count" ? "Contagem" : opt.value_field || "coluna padrão"})
              </div>
              <div className="rc-kpi-meta">{sourceLabel}</div>
            </div>
          ) : block.type === "table" ? (
            <div className="rc-table-wrap">
              <table className="rc-table-preview">
                <thead>
                  <tr>
                    {(opt.columns?.length
                      ? opt.columns
                      : sourceColumns(src,cat).length
                        ? sourceColumns(src,cat)
                        : []
                    ).map((c) => (
                      <th key={c} style={{ borderBottomColor: primaryColor }}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={100} style={{ color: axisColor }}>
                      Fonte ({src.id}): {sourceLabel} · consultada na geração/prévia
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rc-sql-placeholder">
              <span className="rc-sql-badge" style={{ color: primaryColor }}>
                <Database size={11} />
                {BLOCK_LABELS[block.type]} · Dados ({src.id})
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
          )}
        </div>
      );
    }

    // Inline or Goals dataset -> live rendering with Recharts / Table / KPI
    const local=localDatasets.get(src.id);
    const ds = showSampleData && (src.type === "report" || src.type === "goals" && !local?.rows.length)
      ? sampleDataset(block,src,src.type === "report" ? availableSources.find(c=>c.id===src.report_id) : undefined)
      : local || { columns: [], rows: [] };
    if (block.type === "kpi") {
      const mode: AggregateMode = opt.aggregate || "sum";
      const precision = Math.round(clamp(Number(opt.precision) || 0, 0, 4));
      let val: number | null = null;
      const targetCol = opt.value_field || (ds.columns.length > 1 ? ds.columns[1] : ds.columns[0]);
      if (ds.rows.length > 0) {
        if (mode === "count") {
          val = ds.rows.length;
        } else {
          const colIdx = ds.columns.indexOf(targetCol || "");
          if (colIdx >= 0) {
            const nums = ds.rows
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
              {src.id} · {mode === "count" ? "Contagem" : `${mode === "sum" ? "Soma" : "Primeiro"} (${targetCol || "—"})`}
            </div>
          </div>
        </div>
      );
    }

    if (block.type === "table") {
      const chosenCols = opt.columns?.length
        ? opt.columns.filter((c) => ds.columns.includes(c))
        : ds.columns;
      const indices = chosenCols.map((c) => ds.columns.indexOf(c));
      return (
        <div className="rc-block-inner">
          {block.title && <div className="rc-block-title">{block.title}</div>}
          {chosenCols.length === 0 ? (
            <div className="rc-sql-placeholder">
              <span className="rc-sql-meta">A fonte "{src.id}" não informou as colunas. Configure as colunas da tabela no inspetor.</span>
            </div>
          ) : (
            <div className="rc-table-wrap">
              <table className="rc-table-preview" style={{ fontSize: `${fontSize}px`, tableLayout: "fixed" }}>
                {opt.column_widths?.length === chosenCols.length && opt.column_widths.every(w=>Number.isFinite(w) && w>0) && (
                  <colgroup>{opt.column_widths.map((weight,i)=><col key={i} style={{width:`${100*weight/opt.column_widths!.reduce((a,b)=>a+b,0)}%`}} />)}</colgroup>
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
                  {ds.rows.length === 0 ? (
                    <tr>
                      <td colSpan={chosenCols.length} style={{ color: axisColor }}>
                        Sem linhas em "{src.id}".
                      </td>
                    </tr>
                  ) : (
                    ds.rows.slice(0, 14).map((r, ri) => (
                      <tr key={ri}>
                        {indices.map((ci, k) => (
                          <td key={k}>{r[ci] === null || r[ci] === undefined ? "" : String(r[ci])}</td>
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

    // Charts: bar, line, pie via Recharts with exact block pixel dimensions
    const xCol = opt.x_field && ds.columns.includes(opt.x_field) ? opt.x_field : ds.columns[0];
    const rawYs = opt.y_fields?.length ? opt.y_fields : ds.columns.slice(1, 2);
    const yCols = rawYs.filter((c) => ds.columns.includes(c)).slice(0, 6);
    const xIdx = xCol ? ds.columns.indexOf(xCol) : -1;

    if (xIdx < 0 || yCols.length === 0 || ds.rows.length === 0) {
      return (
        <div className="rc-block-inner">
          {block.title && <div className="rc-block-title">{block.title}</div>}
          <div className="rc-sql-placeholder">
            <span className="rc-sql-badge">{BLOCK_LABELS[block.type]} · {src.id}</span>
            <span className="rc-sql-meta">
              {ds.rows.length === 0
                ? src.type === "goals"
                  ? "Sem metas mensais cadastradas neste relatório."
                  : "Fonte sem linhas para prévia."
                : "Ajuste o eixo X e as séries numéricas no inspetor."}
            </span>
          </div>
        </div>
      );
    }

    const chartData = ds.rows.slice(0, 80).map((r) => {
      const item: Record<string, string | number | null> = {
        __x: String(r[xIdx] ?? ""),
      };
      for (const yc of yCols) {
        const yi = ds.columns.indexOf(yc);
        item[yc] = yi >= 0 ? parseNumberOrNull(r[yi]) : null;
      }
      return item;
    });

    const chartW = Math.max(90, Math.floor(block.width - 24));
    const chartH = Math.max(54, Math.floor(block.height - (block.title ? 44 : 20)));
    const palette = [primaryColor, ...SERIES_PALETTE.filter((c) => c.toLowerCase() !== primaryColor)];

    return (
      <div className="rc-block-inner">
        {block.title && <div className="rc-block-title">{block.title}</div>}
        <div style={{ width: chartW, height: chartH, overflow: "hidden" }}>
          {block.type === "bar" && (
            <BarChart width={chartW} height={chartH} data={chartData} margin={{ top: 6, right: 8, bottom: 2, left: -12 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="__x" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
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
            <LineChart width={chartW} height={chartH} data={chartData} margin={{ top: 6, right: 8, bottom: 2, left: -12 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="__x" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
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
          {block.type === "pie" && (() => {
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


// Moving a block changes its position, not its rendered contents.
export default memo(BlockPreview, (a,b) => {
  const x=a.block,y=b.block;
  return a.showSampleData===b.showSampleData && a.background===b.background && a.sources===b.sources && a.assets===b.assets && a.assetUrls===b.assetUrls && a.availableSources===b.availableSources && a.localDatasets===b.localDatasets && a.reportName===b.reportName && x.id===y.id && x.type===y.type && x.width===y.width && x.height===y.height && x.title===y.title && x.text===y.text && x.source_id===y.source_id && x.asset_id===y.asset_id && x.options===y.options;
});
