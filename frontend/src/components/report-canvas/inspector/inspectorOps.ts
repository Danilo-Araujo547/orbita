import { inferColumnType } from "../data/columnTypes";
import { placeholderDataset } from "../placeholderData";
import type {
  BlockOptions,
  BlockType,
  CanvasBlock,
  CanvasSource,
  CatalogSqlSource,
  ColumnInfo,
  SourcePreview,
  XGroupGranularity,
} from "../model";
import { NEW_SERIES_PALETTE, clamp, parseNumberOrNull } from "../model";
import {
  adjustWidthsProportionally,
  isDateCompatibleColumn,
  isNumericCompatibleColumn,
} from "../problems";
import type { SourcePreviewsInput } from "../problems";

export { adjustWidthsProportionally, isDateCompatibleColumn, isNumericCompatibleColumn };

const PT_MONTHS_SHORT: Record<number, string> = {
  1: "jan",
  2: "fev",
  3: "mar",
  4: "abr",
  5: "mai",
  6: "jun",
  7: "jul",
  8: "ago",
  9: "set",
  10: "out",
  11: "nov",
  12: "dez",
};

export function resolveSourceColumnInfos(
  source: CanvasSource | null | undefined,
  preview: SourcePreview | null | undefined,
  availableSources: readonly CatalogSqlSource[] = [],
  monthlyGoals?: ReadonlyArray<{ year: number; month: number; value: number }>,
): ColumnInfo[] {
  if (!source) return [];
  if (preview && Array.isArray(preview.columns) && preview.columns.length > 0) {
    return preview.columns;
  }
  if (source.type === "inline") {
    return source.columns.map((name, idx) => {
      const vals = source.rows.map((r) => (Array.isArray(r) ? r[idx] : null));
      const sampleVals = vals
        .filter((v) => v !== null && v !== undefined && v !== "")
        .slice(0, 3)
        .map(String);
      return {
        name,
        type: inferColumnType(vals),
        sample: sampleVals,
      };
    });
  }
  if (source.type === "goals") {
    const sampleRow = monthlyGoals?.[0];
    return [
      { name: "year", type: "number", sample: sampleRow ? [String(sampleRow.year)] : [] },
      { name: "month", type: "number", sample: sampleRow ? [String(sampleRow.month)] : [] },
      { name: "value", type: "number", sample: sampleRow ? [String(sampleRow.value)] : [] },
    ];
  }
  const catalog = availableSources.find((c) => c.id === source.report_id);
  const dataset =
    catalog?.datasets?.find((d) => d.id === (source.dataset || "rows")) || catalog?.datasets?.[0];
  const names = dataset?.columns || catalog?.columns || [];
  if (!names.length) return [];

  try {
    const sample = placeholderDataset(
      {
        id: "sample_block",
        type: "table",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        source_id: source.id,
        options: { columns: names },
      },
      source,
      catalog,
    );
    if (sample && sample.rows.length > 0) {
      return names.map((name) => {
        const colIdx = sample.columns.indexOf(name);
        const vals = colIdx >= 0 ? sample.rows.map((r) => r[colIdx]) : [];
        const inferred = inferColumnType(vals);
        const sampleVals = vals
          .filter((v) => v !== null && v !== undefined && v !== "")
          .slice(0, 3)
          .map(String);
        return {
          name,
          type: inferred,
          sample: sampleVals.length > 0 ? sampleVals : undefined,
        };
      });
    }
  } catch {
    // fallback se falhar inferência
  }

  return names.map((name) => ({ name, type: "unknown" as const }));
}

export function resolveSourceRows(
  source: CanvasSource | null | undefined,
  preview: SourcePreview | null | undefined,
  monthlyGoals?: ReadonlyArray<{ year: number; month: number; value: number }>,
): {
  rows: Array<Array<string | number | boolean | null>>;
  totalRows: number;
  hasRows: boolean;
} {
  if (!source) return { rows: [], totalRows: 0, hasRows: false };
  if (preview) {
    return {
      rows: preview.rows,
      totalRows: typeof preview.total_rows === "number" ? preview.total_rows : preview.rows.length,
      hasRows: true,
    };
  }
  if (source.type === "inline") {
    return {
      rows: source.rows,
      totalRows: source.rows.length,
      hasRows: true,
    };
  }
  if (source.type === "goals" && monthlyGoals && monthlyGoals.length > 0) {
    const rows = monthlyGoals.map((g) => [g.year, g.month, g.value]);
    return {
      rows,
      totalRows: rows.length,
      hasRows: true,
    };
  }
  return { rows: [], totalRows: 0, hasRows: false };
}

export function getSourceDisplayMeta(
  source: CanvasSource,
  availableSources: readonly CatalogSqlSource[] = [],
): { title: string; subtitle: string; kindLabel: string } {
  const title = source.label?.trim() || source.id;
  if (source.type === "report") {
    const sql = availableSources.find((c) => c.id === source.report_id);
    const ds =
      sql?.datasets?.find((d) => d.id === (source.dataset || "rows")) || sql?.datasets?.[0];
    const reportTitle = sql?.name || `Relatório #${source.report_id}`;
    const dsTitle = ds?.name || source.dataset || "Registros";
    return {
      title,
      subtitle: `${reportTitle} › ${dsTitle}`,
      kindLabel: "Consulta",
    };
  }
  if (source.type === "inline") {
    return {
      title,
      subtitle: `Manual › ${source.columns.length} ${
        source.columns.length === 1 ? "coluna" : "colunas"
      }`,
      kindLabel: "Manual",
    };
  }
  return {
    title,
    subtitle: "Relatório › Metas mensais",
    kindLabel: "Metas",
  };
}

export function getUsedColumnsForBlock(
  block: CanvasBlock,
  availableColumns: readonly ColumnInfo[] = [],
): string[] {
  const opt = block.options || {};
  if (block.type === "bar" || block.type === "line" || block.type === "pie") {
    const list = [opt.x_field, ...(opt.y_fields || [])].filter((c): c is string =>
      Boolean(c && c.trim()),
    );
    return Array.from(new Set(list));
  }
  if (block.type === "kpi") {
    if ((opt.aggregate ?? "sum") === "count" && !opt.value_field) return [];
    return opt.value_field?.trim() ? [opt.value_field.trim()] : [];
  }
  if (block.type === "table") {
    if (Array.isArray(opt.columns)) {
      return opt.columns;
    }
    return availableColumns.map((c) => c.name);
  }
  if (block.type === "text" && block.text) {
    const matches = Array.from(
      block.text.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g),
    );
    const cols = matches
      .filter((m) => !block.source_id || m[1] === block.source_id)
      .map((m) => m[2]);
    return Array.from(new Set(cols));
  }
  return [];
}

export function hasConfiguredDataFields(block: CanvasBlock): boolean {
  const opt = block.options || {};
  if (block.type === "bar" || block.type === "line" || block.type === "pie") {
    return Boolean(opt.x_field?.trim() || (opt.y_fields && opt.y_fields.length > 0));
  }
  if (block.type === "kpi") {
    return Boolean(opt.value_field?.trim());
  }
  if (block.type === "table") {
    return Boolean(opt.columns && opt.columns.length > 0);
  }
  return false;
}

export function computeSmartDefaults(
  blockType: BlockType,
  columns: readonly ColumnInfo[],
  opts?: { isNewChart?: boolean; existingOptions?: BlockOptions },
): Partial<BlockOptions> {
  const base = opts?.existingOptions || {};
  const hasKnownTypes = columns.some((c) => c.type !== "unknown" || Boolean(c.looks_like));

  if (blockType === "bar" || blockType === "line" || blockType === "pie") {
    const palettePatch =
      opts?.isNewChart && !base.series_colors
        ? { series_colors: [...NEW_SERIES_PALETTE] }
        : {};

    if (!hasKnownTypes || columns.length === 0) {
      return {
        ...palettePatch,
        x_field: undefined,
        y_fields: undefined,
        x_group: undefined,
        y_aggregate: undefined,
      };
    }

    const xCol =
      columns.find((c) => isDateCompatibleColumn(c) || c.type === "text") || columns[0];
    const yCol =
      columns.find(
        (c) =>
          (c.type === "number" || c.looks_like === "number") && c.name !== xCol?.name,
      ) || columns.find((c) => c.type === "number" || c.looks_like === "number");

    const xIsDate = Boolean(xCol && isDateCompatibleColumn(xCol));

    return {
      ...palettePatch,
      x_field: xCol ? xCol.name : undefined,
      y_fields: yCol ? [yCol.name] : undefined,
      x_group: xIsDate ? "month" : undefined,
      y_aggregate: xIsDate ? "sum" : undefined,
    };
  }

  if (blockType === "kpi") {
    if (!hasKnownTypes || columns.length === 0) {
      return {
        value_field: undefined,
      };
    }
    const numCol = columns.find((c) => c.type === "number" || c.looks_like === "number");
    return {
      value_field: numCol ? numCol.name : undefined,
    };
  }

  if (blockType === "table") {
    return {
      columns: undefined,
      column_widths: undefined,
    };
  }

  return {};
}

function normalizeColMatchKey(name: string): string {
  return name
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function findMatchingColumnName(
  oldName: string,
  nextColumns: readonly ColumnInfo[],
): { name: string; matched: boolean } {
  const exact = nextColumns.find((c) => c.name === oldName);
  if (exact) return { name: exact.name, matched: true };
  const normKey = normalizeColMatchKey(oldName);
  const insensitive = nextColumns.find((c) => normalizeColMatchKey(c.name) === normKey);
  if (insensitive) return { name: insensitive.name, matched: true };
  // Preserve missing column name so problems.ts marks it as column_missing (never drops silently)
  return { name: oldName, matched: false };
}

export function remapColumnsForNewSource(
  block: CanvasBlock,
  nextColumns: readonly ColumnInfo[],
): { options: BlockOptions; matchedCount: number; missingColumns: string[] } {
  const prevOpt = block.options || {};
  const nextOpt: BlockOptions = { ...prevOpt };
  let matchedCount = 0;
  const missingColumns: string[] = [];

  if (nextColumns.length === 0) {
    return { options: nextOpt, matchedCount: 0, missingColumns: [] };
  }

  const mapSingle = (colName: string | undefined): string | undefined => {
    if (!colName || !colName.trim()) return colName;
    const res = findMatchingColumnName(colName.trim(), nextColumns);
    if (res.matched) {
      matchedCount += 1;
    } else if (!missingColumns.includes(res.name)) {
      missingColumns.push(res.name);
    }
    return res.name;
  };

  if (block.type === "bar" || block.type === "line" || block.type === "pie") {
    if (prevOpt.x_field) {
      nextOpt.x_field = mapSingle(prevOpt.x_field);
      const mappedXInfo = nextColumns.find((c) => c.name === nextOpt.x_field);
      if (nextOpt.x_group && mappedXInfo && mappedXInfo.type !== "unknown" && !isDateCompatibleColumn(mappedXInfo)) {
        // Keep x_group if user wants to fix, or problems.ts flags x_not_date_for_group
      }
    }
    if (Array.isArray(prevOpt.y_fields) && prevOpt.y_fields.length > 0) {
      nextOpt.y_fields = prevOpt.y_fields.map((y) => mapSingle(y) || y);
    }
  } else if (block.type === "kpi") {
    if (prevOpt.value_field) {
      nextOpt.value_field = mapSingle(prevOpt.value_field);
    }
  } else if (block.type === "table") {
    if (Array.isArray(prevOpt.columns) && prevOpt.columns.length > 0) {
      nextOpt.columns = prevOpt.columns.map((c) => mapSingle(c) || c);
    }
  }

  return { options: nextOpt, matchedCount, missingColumns };
}

export function convertChartTypePreservingFields(
  block: CanvasBlock,
  nextType: "bar" | "line" | "pie",
): { block: CanvasBlock; droppedExtraSeriesCount: number } {
  const prevOpt = block.options || {};
  const ys = prevOpt.y_fields || [];
  const dropped = nextType === "pie" && ys.length > 1 ? ys.length - 1 : 0;
  const nextYs = nextType === "pie" && ys.length > 1 ? ys.slice(0, 1) : ys;

  return {
    droppedExtraSeriesCount: dropped,
    block: {
      ...block,
      type: nextType,
      options: {
        ...prevOpt,
        ...(ys.length > 0 ? { y_fields: nextYs } : {}),
      },
    },
  };
}

export function formatDateGroupPreview(
  granularity: XGroupGranularity,
  sampleIso?: string | null,
): string {
  let year = 2026;
  let month = 10;
  let day = 27;

  if (sampleIso && typeof sampleIso === "string") {
    const m = sampleIso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (y >= 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        year = y;
        month = mo;
        day = d;
      }
    }
  }

  const yy = String(year).slice(-2);
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");

  if (granularity === "day") {
    return `${dd}/${mm}/${year}`;
  }
  if (granularity === "week") {
    const dt = new Date(Date.UTC(year, month - 1, day));
    const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
    dt.setUTCDate(dt.getUTCDate() - dow);
    const monDay = String(dt.getUTCDate()).padStart(2, "0");
    const monMonth = String(dt.getUTCMonth() + 1).padStart(2, "0");
    return `sem. ${monDay}/${monMonth}`;
  }
  if (granularity === "month") {
    return `${PT_MONTHS_SHORT[month] || "out"}/${yy}`;
  }
  if (granularity === "quarter") {
    const q = Math.floor((month - 1) / 3) + 1;
    return `T${q}/${yy}`;
  }
  return `${year}`;
}

export function computeKpiPreviewSample(
  block: CanvasBlock,
  columns: readonly ColumnInfo[],
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>,
  totalRows?: number,
): string | null {
  if (block.type !== "kpi") return null;
  const opt = block.options || {};
  const mode = opt.aggregate ?? "sum";
  const precision = Math.round(clamp(Number(opt.precision ?? 0), 0, 4));

  if (mode === "count") {
    const countVal = typeof totalRows === "number" ? totalRows : rows.length;
    return `= ${countVal.toLocaleString("pt-BR", {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    })}`;
  }

  const valField = opt.value_field?.trim();
  if (!valField || rows.length === 0) return null;
  const colIdx = columns.findIndex((c) => c.name === valField);
  if (colIdx < 0) return null;

  const nums: number[] = [];
  for (const r of rows) {
    const parsed = parseNumberOrNull(r[colIdx]);
    if (parsed !== null) nums.push(parsed);
  }
  if (nums.length === 0) return null;

  const result = mode === "first" ? nums[0] : nums.reduce((acc, v) => acc + v, 0);
  return `= ${result.toLocaleString("pt-BR", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })}`;
}

function formatInterpolatedIsoValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  const dtMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (dtMatch) {
    const [, y, m, d, hh, mm, ss] = dtMatch;
    return `${d}/${m}/${y} ${hh}:${mm}:${ss || "00"}`;
  }
  const dMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dMatch) {
    const [, y, m, d] = dMatch;
    return `${d}/${m}/${y}`;
  }
  return str;
}

export function interpolateTextPreview(
  raw: string,
  ctx: {
    reportName: string;
    parameters?: Record<string, unknown>;
    sources?: readonly CanvasSource[];
    previews?: SourcePreviewsInput;
  },
): string {
  if (!raw) return "";
  return raw.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g, (full, key: string) => {
    if (key === "report_name") return ctx.reportName || full;
    if (ctx.parameters && key in ctx.parameters && ctx.parameters[key] != null) {
      return formatInterpolatedIsoValue(ctx.parameters[key]);
    }
    if (key.includes(".") && ctx.sources) {
      const [srcId, colName] = key.split(".", 2);
      const src = ctx.sources.find((s) => s.id === srcId);
      if (src) {
        const preview =
          ctx.previews instanceof Map
            ? ctx.previews.get(srcId)
            : ctx.previews
              ? (ctx.previews as Record<string, SourcePreview | null | undefined>)[srcId]
              : null;
        const cols =
          preview?.columns.map((c: ColumnInfo) => c.name) ||
          (src.type === "inline" ? src.columns : []);
        const rows = preview?.rows || (src.type === "inline" ? src.rows : []);
        const colIdx = cols.indexOf(colName);
        if (colIdx >= 0 && rows.length > 0 && rows[0][colIdx] !== undefined && rows[0][colIdx] !== null) {
          return formatInterpolatedIsoValue(rows[0][colIdx]);
        }
      }
    }
    return full;
  });
}

export function formatSourceLineageLine(params: {
  block: CanvasBlock;
  source: CanvasSource;
  columns: readonly ColumnInfo[];
  availableSources?: readonly CatalogSqlSource[];
  totalRows?: number | null;
  isUnavailable?: boolean;
}): string {
  const { block, source, columns, availableSources = [], totalRows, isUnavailable } = params;
  const meta = getSourceDisplayMeta(source, availableSources);
  const breadcrumb =
    source.type === "report"
      ? meta.subtitle
      : `${meta.title} › ${source.type === "inline" ? "Registros" : "Metas"}`;

  const used = getUsedColumnsForBlock(block, columns);
  const usedInSourceCount =
    columns.length > 0
      ? used.filter((c) => columns.some((col) => col.name === c)).length
      : used.length;

  const colSegment =
    columns.length > 0
      ? `${usedInSourceCount} de ${columns.length} colunas usadas`
      : `${used.length} ${used.length === 1 ? "coluna configurada" : "colunas configuradas"}`;

  const rowSegment =
    typeof totalRows === "number"
      ? `prévia de ${totalRows.toLocaleString("pt-BR")} ${totalRows === 1 ? "linha" : "linhas"}`
      : isUnavailable
        ? "prévia indisponível"
        : "prévia não carregada";

  return `${breadcrumb} · ${colSegment} · ${rowSegment}`;
}
