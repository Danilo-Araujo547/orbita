export type BlockType = "text" | "kpi" | "table" | "bar" | "line" | "pie" | "image";
export type AggregateMode = "sum" | "count" | "first";
export type XGroupGranularity = "day" | "week" | "month" | "quarter" | "year";
export type ChartAggregateMode = "sum" | "avg" | "count" | "min" | "max";
export type OutputFormat = "pdf" | "xlsx";
export type XlsxMode = "layout" | "table";

export const X_GROUP_VALUES: readonly XGroupGranularity[] = [
  "day",
  "week",
  "month",
  "quarter",
  "year",
];
export const Y_AGGREGATE_VALUES: readonly ChartAggregateMode[] = [
  "sum",
  "avg",
  "count",
  "min",
  "max",
];

export interface BlockOptions {
  column_widths?: number[];
  x_field?: string;
  y_fields?: string[];
  x_group?: XGroupGranularity;
  y_aggregate?: ChartAggregateMode;
  series_colors?: string[];
  value_field?: string;
  aggregate?: AggregateMode;
  precision?: number;
  font_size?: number;
  color?: string;
  columns?: string[];
}

export interface CanvasBlock {
  id: string;
  type: BlockType;
  x: number;
  y: number;
  width: number;
  height: number;
  source_id?: string;
  title?: string;
  text?: string;
  asset_id?: string;
  options?: BlockOptions;
}

export interface CanvasPage {
  id: string;
  name: string;
  blocks: CanvasBlock[];
}

export type ColumnDataType = "number" | "date" | "datetime" | "boolean" | "text" | "unknown";

export interface ColumnInfo {
  name: string;
  type: ColumnDataType;
  looks_like?: "date" | "number";
  nullable?: boolean;
  null_count?: number;
  sample?: string[];
}

export interface SourcePreview {
  columns: ColumnInfo[];
  rows: Array<Array<string | number | boolean | null>>;
  total_rows: number;
  truncated: boolean;
  elapsed_ms?: number;
  loaded_at?: string;
}

export type CanvasSource =
  | {
      id: string;
      type: "report";
      report_id: number;
      label?: string;
      dataset?: string;
      parameters?: Record<string, string | number | boolean | null | { parameter: string }>;
    }
  | {
      id: string;
      type: "inline";
      label?: string;
      columns: string[];
      rows: Array<Array<string | number | boolean | null>>;
    }
  | {
      id: string;
      type: "goals";
      label?: string;
    };

export interface CanvasPageConfig {
  width: number;
  height: number;
  columns: number;
  background: string;
}

export interface CanvasLayout {
  schema_version: 1;
  xlsx_mode?: XlsxMode;
  export_format?: OutputFormat;
  page: CanvasPageConfig;
  sources: CanvasSource[];
  pages: CanvasPage[];
}

export interface CatalogSqlSource {
  datasets?: Array<{id:string;name:string;columns:string[]}>;

  id: number;
  name: string;
  code: string;
  columns?: string[];
}

export interface CanvasAssetMeta {
  id: string;
  filename: string;
  width: number;
  height: number;
  content?: string;
  mime?: string;
}

export interface CanvasGetResponse {
  port_notice?: string;
  monthly_goals?: Array<{year:number;month:number;value:number}>;
  version: number;
  layout: Partial<CanvasLayout> | null;
  enabled: boolean;
  output_format: string;
  sources: CatalogSqlSource[];
  assets: CanvasAssetMeta[];
}

export interface CanvasPreviewResponse {
  content: string;
  format: string;
  rows?: number;
  filename: string;
}

export interface ReportSummary {
  id: number;
  name: string;
  version: number;
  output_format?: string;
  monthly_goals?: Array<{ year: number; month: number; value: number }>;
  parameter_schema?: Record<string, any>;
  [key: string]: any;
}

export interface ReportCanvasProps {
  unit: string;
  report: ReportSummary;
  onClose: () => void;
  onSaved?: () => void;
}

export const IDENT_RE = /^[A-Za-z][A-Za-z0-9_-]{0,49}$/;
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

export const SWATCH_COLORS = [
  "#075b94",
  "#14b4cb",
  "#0f766e",
  "#1d4ed8",
  "#0f2438",
  "#475569",
  "#b45309",
  "#b91c1c",
];

export const LEGACY_PDF_PALETTE = [
  "#075b94",
  "#14b4cb",
  "#71bfa6",
  "#7289ba",
  "#af76b5",
  "#db9d49",
];

export const NEW_SERIES_PALETTE = [
  "#075b94",
  "#c2610c",
  "#0f7f73",
  "#b5446e",
  "#0e8fa3",
  "#64748b",
];

export const SERIES_PALETTE = LEGACY_PDF_PALETTE;

export const BLOCK_LABELS: Record<BlockType, string> = {
  text: "Texto",
  kpi: "KPI",
  table: "Tabela",
  bar: "Barras",
  line: "Linhas",
  pie: "Pizza",
  image: "Imagem",
};

export const DEFAULT_SIZES: Record<BlockType, { w: number; h: number }> = {
  text: { w: 380, h: 110 },
  kpi: { w: 230, h: 125 },
  table: { w: 540, h: 240 },
  bar: { w: 430, h: 250 },
  line: { w: 430, h: 250 },
  pie: { w: 330, h: 250 },
  image: { w: 240, h: 140 },
};

export function clamp(val: number, low: number, high: number): number {
  if (!Number.isFinite(val)) return low;
  return Math.max(low, Math.min(high, val));
}

export function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

export function validColor(val: unknown, fallback = "#075b94"): string {
  return typeof val === "string" && HEX_COLOR_RE.test(val) ? val : fallback;
}

export function isDarkHex(hex: string): boolean {
  const clean = validColor(hex, "#ffffff").slice(1);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.45;
}

export function makeId(prefix: string, existing: Set<string>): string {
  for (let i = 1; i <= 5000; i++) {
    const candidate = `${prefix}${i}`;
    if (!existing.has(candidate) && IDENT_RE.test(candidate)) return candidate;
  }
  const rand = `${prefix}_${Date.now().toString(36)}`;
  return rand.slice(0, 50);
}

export function createDefaultLayout(): CanvasLayout {
  return {
    schema_version: 1,
    page: {
      width: 794,
      height: 1123,
      columns: 24,
      background: "#ffffff",
    },
    sources: [],
    pages: [
      {
        id: "p1",
        name: "Página 1",
        blocks: [],
      },
    ],
  };
}

export function clampBlockToPage(b: CanvasBlock, pageW: number, pageH: number): CanvasBlock {
  const width = clamp(Number(b.width) || 200, 20, pageW);
  const height = clamp(Number(b.height) || 120, 20, pageH);
  const x = clamp(Number(b.x) || 0, 0, Math.max(0, pageW - width));
  const y = clamp(Number(b.y) || 0, 0, Math.max(0, pageH - height));
  return { ...b, x, y, width, height };
}

export function normalizeLayout(raw: unknown): CanvasLayout {
  if (!raw || typeof raw !== "object") return createDefaultLayout();
  const obj = raw as Record<string, any>;
  if (obj.schema_version !== 1 || !Array.isArray(obj.pages) || obj.pages.length === 0) {
    return createDefaultLayout();
  }
  const rawPage = obj.page && typeof obj.page === "object" ? obj.page : {};
  const width = clamp(Number(rawPage.width) || 794, 150, 3000);
  const height = clamp(Number(rawPage.height) || 1123, 150, 3000);
  const columns = Math.round(clamp(Number(rawPage.columns) || 24, 1, 48));
  const background = validColor(rawPage.background, "#ffffff");

  const sources: CanvasSource[] = [];
  const seenSourceIds = new Set<string>();
  if (Array.isArray(obj.sources)) {
    for (const s of obj.sources) {
      if (!s || typeof s !== "object" || !IDENT_RE.test(String(s.id || "")) || seenSourceIds.has(s.id)) {
        continue;
      }
      if (s.type === "report" && Number.isInteger(Number(s.report_id)) && Number(s.report_id) >= 1) {
        seenSourceIds.add(s.id);
        sources.push({
          id: s.id,
          type: "report",
          report_id: Number(s.report_id),
          ...(typeof s.label === "string" ? { label: s.label.slice(0, 60) } : {}),
          ...(typeof s.dataset === "string" ? {dataset:s.dataset} : {}),
          ...(s.parameters && typeof s.parameters === "object" && !Array.isArray(s.parameters) ? { parameters: s.parameters } : {}),
        });
      } else if (s.type === "inline" && Array.isArray(s.columns) && Array.isArray(s.rows)) {
        seenSourceIds.add(s.id);
        sources.push({
          id: s.id,
          type: "inline",
          ...(typeof s.label === "string" ? { label: s.label.slice(0, 60) } : {}),
          columns: s.columns.map(String),
          rows: s.rows,
        });
      } else if (s.type === "goals") {
        seenSourceIds.add(s.id);
        sources.push({
          id: s.id,
          type: "goals",
          ...(typeof s.label === "string" ? { label: s.label.slice(0, 60) } : {}),
        });
      }
    }
  }

  const pageIds = new Set<string>();
  const blockIds = new Set<string>();
  const pages: CanvasPage[] = [];
  for (const p of obj.pages.slice(0, 30)) {
    if (!p || typeof p !== "object") continue;
    const pid = IDENT_RE.test(String(p.id || "")) && !pageIds.has(p.id) ? String(p.id) : makeId("p", pageIds);
    pageIds.add(pid);
    const pname = typeof p.name === "string" && p.name.trim() ? p.name.slice(0, 100) : `Página ${pages.length + 1}`;
    const blocks: CanvasBlock[] = [];
    if (Array.isArray(p.blocks)) {
      for (const b of p.blocks) {
        if (!b || typeof b !== "object" || (typeof b.type !== "string" || !Object.hasOwn(BLOCK_LABELS, b.type))) continue;
        if (blockIds.size >= 100) break;
        const bid = IDENT_RE.test(String(b.id || "")) && !blockIds.has(b.id) ? String(b.id) : makeId("b", blockIds);
        blockIds.add(bid);
        const rawOpt = b.options && typeof b.options === "object" ? b.options : {};
        const validSeriesColors = Array.isArray(rawOpt.series_colors)
          ? rawOpt.series_colors
              .filter((x: unknown): x is string => typeof x === "string" && HEX_COLOR_RE.test(x.trim()))
              .map((x: string) => x.trim())
              .slice(0, 6)
          : [];
        const opt: BlockOptions = {
          ...(Array.isArray(rawOpt.column_widths) ? {column_widths: rawOpt.column_widths.filter((v:unknown) => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 3000).slice(0,100)} : {}),
          ...(rawOpt.color !== undefined ? { color: validColor(rawOpt.color) } : {}),
          ...(rawOpt.font_size !== undefined ? { font_size: clamp(Number(rawOpt.font_size) || 14, 6, 100) } : {}),
          ...(rawOpt.aggregate === "sum" || rawOpt.aggregate === "count" || rawOpt.aggregate === "first"
            ? { aggregate: rawOpt.aggregate }
            : {}),
          ...(typeof rawOpt.precision === "number"
            ? { precision: Math.round(clamp(rawOpt.precision, 0, 4)) }
            : {}),
          ...(typeof rawOpt.x_field === "string" ? { x_field: rawOpt.x_field.slice(0, 100) } : {}),
          ...(typeof rawOpt.value_field === "string"
            ? { value_field: rawOpt.value_field.slice(0, 100) }
            : {}),
          ...(Array.isArray(rawOpt.y_fields)
            ? { y_fields: rawOpt.y_fields.filter((x: unknown) => typeof x === "string" && x.length > 0).map((x: string) => x.slice(0, 100)) }
            : {}),
          ...(typeof rawOpt.x_group === "string" && X_GROUP_VALUES.includes(rawOpt.x_group as XGroupGranularity)
            ? { x_group: rawOpt.x_group as XGroupGranularity }
            : {}),
          ...(typeof rawOpt.y_aggregate === "string" && Y_AGGREGATE_VALUES.includes(rawOpt.y_aggregate as ChartAggregateMode)
            ? { y_aggregate: rawOpt.y_aggregate as ChartAggregateMode }
            : {}),
          ...(Array.isArray(rawOpt.series_colors) ? { series_colors: validSeriesColors } : {}),
          ...(Array.isArray(rawOpt.columns)
            ? { columns: rawOpt.columns.filter((x: unknown) => typeof x === "string" && x.length > 0).map((x: string) => x.slice(0, 100)) }
            : {}),
        };
        const normalized: CanvasBlock = clampBlockToPage(
          {
            id: bid,
            type: b.type as BlockType,
            x: Number(b.x) || 0,
            y: Number(b.y) || 0,
            width: Number(b.width) || DEFAULT_SIZES[b.type as BlockType].w,
            height: Number(b.height) || DEFAULT_SIZES[b.type as BlockType].h,
            ...(typeof b.source_id === "string" && b.source_id ? { source_id: b.source_id } : {}),
            ...(typeof b.title === "string" ? { title: b.title.slice(0, 300) } : {}),
            ...(typeof b.text === "string" ? { text: b.text.slice(0, 20000) } : {}),
            ...(b.type === "image" && typeof b.asset_id === "string" && b.asset_id ? { asset_id: b.asset_id } : {}),
            ...(b.options !== undefined ? { options: opt } : {}),
          },
          width,
          height,
        );
        blocks.push(normalized);
      }
    }
    pages.push({ id: pid, name: pname, blocks });
  }

  if (pages.length === 0) {
    pages.push({ id: "p1", name: "Página 1", blocks: [] });
  }

  const xlsxMode: XlsxMode | undefined =
    obj.xlsx_mode === "layout" || obj.xlsx_mode === "table" ? obj.xlsx_mode : undefined;

  return {
    schema_version: 1,
    ...(xlsxMode ? { xlsx_mode: xlsxMode } : {}),
    ...(("export_format" in obj) && (obj.export_format === "pdf" || obj.export_format === "xlsx") ? { export_format: obj.export_format as OutputFormat } : {}),
    page: { width, height, columns, background },
    sources,
    pages,
  };
}

export function sanitizeLayoutForApi(layout: CanvasLayout): CanvasLayout {
  const pageW = clamp(layout.page.width, 150, 3000);
  const pageH = clamp(layout.page.height, 150, 3000);
  const columns = Math.round(clamp(layout.page.columns, 1, 48));
  const background = validColor(layout.page.background, "#ffffff");
  const validSourceIds = new Set(layout.sources.map((s) => s.id));

  const cleanSources: CanvasSource[] = layout.sources.map((s) => {
    const labelProp = typeof s.label === "string" ? { label: s.label.slice(0, 60) } : {};
    if (s.type === "report") {
      return {
        id: s.id,
        type: "report",
        report_id: Math.round(Number(s.report_id)),
        ...labelProp,
        ...(s.dataset ? {dataset:s.dataset} : {}),
        ...(s.parameters !== undefined ? { parameters: s.parameters } : {}),
      };
    }
    if (s.type === "inline") {
      return {
        id: s.id,
        type: "inline",
        ...labelProp,
        columns: s.columns,
        rows: s.rows,
      };
    }
    return { id: s.id, type: "goals", ...labelProp };
  });

  const cleanPages: CanvasPage[] = layout.pages.map((p, idx) => ({
    id: p.id,
    name: p.name.trim() ? p.name.slice(0, 100) : `Página ${idx + 1}`,
    blocks: p.blocks.map((rawBlock) => {
      const b = clampBlockToPage(rawBlock, pageW, pageH);
      const rawOpt = b.options || {};
      const cleanOpt: BlockOptions = {
        ...(rawOpt.color !== undefined ? { color: validColor(rawOpt.color) } : {}),
        ...(rawOpt.font_size !== undefined ? { font_size: clamp(Number(rawOpt.font_size) || 14, 6, 100) } : {}),
      };
      if (Array.isArray(rawOpt.column_widths)) cleanOpt.column_widths=rawOpt.column_widths.filter(v=>Number.isFinite(v) && v>=1 && v<=3000).slice(0,100);
      if (rawOpt.aggregate === "sum" || rawOpt.aggregate === "count" || rawOpt.aggregate === "first") {
        cleanOpt.aggregate = rawOpt.aggregate;
      }
      if (typeof rawOpt.precision === "number" && Number.isFinite(rawOpt.precision)) {
        cleanOpt.precision = Math.round(clamp(rawOpt.precision, 0, 4));
      }
      if (typeof rawOpt.x_field === "string") {
        cleanOpt.x_field = rawOpt.x_field.slice(0, 100);
      }
      if (typeof rawOpt.value_field === "string") {
        cleanOpt.value_field = rawOpt.value_field.slice(0, 100);
      }
      if (Array.isArray(rawOpt.y_fields)) {
        const ys = rawOpt.y_fields.map((v) => v.slice(0, 100)).filter(Boolean);
        cleanOpt.y_fields = ys.slice(0, 100);
      }
      if (rawOpt.x_group && X_GROUP_VALUES.includes(rawOpt.x_group)) {
        cleanOpt.x_group = rawOpt.x_group;
      }
      if (rawOpt.y_aggregate && Y_AGGREGATE_VALUES.includes(rawOpt.y_aggregate)) {
        cleanOpt.y_aggregate = rawOpt.y_aggregate;
      }
      if (Array.isArray(rawOpt.series_colors)) {
        const sc = rawOpt.series_colors
          .filter((v): v is string => typeof v === "string" && HEX_COLOR_RE.test(v.trim()))
          .map((v) => v.trim())
          .slice(0, 6);
        cleanOpt.series_colors = sc;
      }
      if (Array.isArray(rawOpt.columns)) {
        const cols = rawOpt.columns.map((v) => v.slice(0, 100)).filter(Boolean);
        cleanOpt.columns = cols.slice(0, 100);
      }

      const out: CanvasBlock = {
        id: b.id,
        type: b.type,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        ...(b.options !== undefined ? { options: cleanOpt } : {}),
      };
      if (b.title !== undefined) out.title = b.title.slice(0, 300);
      if (b.text !== undefined) out.text = b.text.slice(0, 20000);
      if (b.type !== "image" && b.source_id && validSourceIds.has(b.source_id)) {
        out.source_id = b.source_id;
      }
      if (b.type === "image" && b.asset_id) {
        out.asset_id = b.asset_id;
      }
      return out;
    }),
  }));

  const xlsxMode: XlsxMode | undefined =
    layout.xlsx_mode === "layout" || layout.xlsx_mode === "table" ? layout.xlsx_mode : undefined;

  return {
    schema_version: 1,
    ...(xlsxMode ? { xlsx_mode: xlsxMode } : {}),
    ...(layout.export_format ? { export_format: layout.export_format } : {}),
    page: { width: pageW, height: pageH, columns, background },
    sources: cleanSources,
    pages: cleanPages,
  };
}

export function inferImageMime(filename: string, b64: string, explicitMime?: string): string {
  if (explicitMime && explicitMime.startsWith("image/")) return explicitMime;
  if (/\.jpe?g$/i.test(filename) || b64.startsWith("/9j/")) return "image/jpeg";
  return "image/png";
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export function parseNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function interpolateText(raw: string, reportName: string): string {
  return raw.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (full, key: string) =>
    key === "report_name" ? reportName : full,
  );
}

export type SourceDialogState = {
  mode: "create" | "edit";
  originalId?: string;
  id: string;
  label?: string;
  type: "report" | "inline" | "goals";
  reportId: string;
  dataset?: string;
  parametersJson: string;
  columnsJson: string;
  rowsJson: string;
  error: string;
  testPreview?: SourcePreview | null;
  testError?: string | null;
};

export type DragSession =
  | {
      kind: "move";
      blockId: string;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
      width: number;
      height: number;
    }
  | {
      kind: "resize";
      handle: "se" | "e" | "s";
      blockId: string;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
      startW: number;
      startH: number;
    };

export function isParameterBinding(value: unknown): value is {parameter:string} {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && "parameter" in value && typeof value.parameter === "string" && /^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(value.parameter);
}
