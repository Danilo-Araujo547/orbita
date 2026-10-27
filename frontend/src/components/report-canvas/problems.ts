import { COLUMN_TYPE_LABELS, inferColumnType } from "./data/columnTypes";
import type {
  CanvasAssetMeta,
  CanvasBlock,
  CanvasLayout,
  CanvasSource,
  CatalogSqlSource,
  ColumnDataType,
  ColumnInfo,
  SourcePreview,
} from "./model";
import { BLOCK_LABELS, UUID_RE, clamp, clampBlockToPage, parseNumberOrNull } from "./model";

export type ProblemSeverity = "error" | "warning";

export type ProblemCode =
  | "no_source"
  | "source_missing"
  | "column_missing"
  | "y_not_numeric"
  | "x_not_date_for_group"
  | "too_many_series"
  | "pie_negative"
  | "points_over_limit"
  | "table_widths_mismatch"
  | "columns_empty"
  | "kpi_no_value_field"
  | "image_missing"
  | "block_out_of_page"
  | "text_overflow";

export type ProblemTargetTab = "content" | "appearance" | "data";

export interface ProblemFix {
  label: string;
  targetTab?: ProblemTargetTab;
  targetFieldId?: string;
  apply?: (layout: CanvasLayout) => CanvasLayout;
}

export interface Problem {
  blockId: string;
  pageId: string;
  severity: ProblemSeverity;
  code: ProblemCode;
  message: string;
  fix?: ProblemFix;
}

export type SourcePreviewsInput =
  | ReadonlyMap<string, SourcePreview | null | undefined>
  | Record<string, SourcePreview | null | undefined>
  | null
  | undefined;

export interface ComputeProblemsOptions {
  assets?: readonly CanvasAssetMeta[];
  monthlyGoals?: ReadonlyArray<{ year: number; month: number; value: number }>;
}

const DEFAULT_TITLES: Record<CanvasBlock["type"], string> = {
  text: "Texto",
  kpi: "KPI",
  table: "Tabela",
  bar: "Gráfico de barras",
  line: "Gráfico de linhas",
  pie: "Gráfico de pizza",
  image: "Imagem",
};

export function getBlockProblemTitle(block: CanvasBlock): string {
  const trimmed = block.title?.trim();
  if (trimmed && trimmed !== BLOCK_LABELS[block.type]) {
    return trimmed;
  }
  return trimmed || DEFAULT_TITLES[block.type] || block.id;
}

export function formatProblemMessage(
  blockName: string,
  pageName: string,
  what: string,
  howToFix: string,
): string {
  const cleanWhat = what.replace(/\.+$/, "");
  const cleanFix = howToFix.replace(/\.+$/, "");
  return `**${blockName}** (${pageName}): ${cleanWhat}. ${cleanFix}.`;
}

export function adjustWidthsProportionally(
  widths: readonly number[],
  targetWidth: number,
  columnCount?: number,
): number[] {
  const count = columnCount ?? widths.length;
  if (count <= 0) return [];
  const target = clamp(Math.round(targetWidth), count, count * 3000);
  const weights = Array.from({ length: count }, (_, idx) => {
    const raw = Number(widths[idx]);
    return Number.isFinite(raw) && raw > 0 ? raw : 100;
  });
  const totalWeight = weights.reduce((acc, v) => acc + v, 0) || count;
  const exact = weights.map((w) => (w / totalWeight) * target);
  const result = exact.map((v) => clamp(Math.floor(v), 1, 3000));
  let diff = target - result.reduce((acc, v) => acc + v, 0);

  if (diff > 0) {
    const order = exact
      .map((v, idx) => ({ idx, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac || a.idx - b.idx);
    let cursor = 0;
    while (diff > 0 && order.length > 0) {
      const targetIdx = order[cursor % order.length].idx;
      if (result[targetIdx] < 3000) {
        result[targetIdx] += 1;
        diff -= 1;
      } else if (result.every((v) => v >= 3000)) {
        break;
      }
      cursor += 1;
    }
  } else if (diff < 0) {
    const order = exact
      .map((v, idx) => ({ idx, val: v }))
      .sort((a, b) => b.val - a.val || a.idx - b.idx);
    let cursor = 0;
    while (diff < 0 && order.length > 0) {
      const targetIdx = order[cursor % order.length].idx;
      if (result[targetIdx] > 1) {
        result[targetIdx] -= 1;
        diff += 1;
      } else if (result.every((v) => v <= 1)) {
        break;
      }
      cursor += 1;
    }
  }

  return result;
}

function getPreviewFromInput(
  sourcePreviews: SourcePreviewsInput,
  sourceId: string,
): SourcePreview | null {
  if (!sourcePreviews) return null;
  if (sourcePreviews instanceof Map) {
    return (sourcePreviews as ReadonlyMap<string, SourcePreview | null | undefined>).get(sourceId) || null;
  }
  if (typeof (sourcePreviews as ReadonlyMap<string, unknown>).get === "function") {
    return (
      ((sourcePreviews as ReadonlyMap<string, SourcePreview | null | undefined>).get(sourceId)) ||
      null
    );
  }
  return (sourcePreviews as Record<string, SourcePreview | null | undefined>)[sourceId] || null;
}

export interface ResolvedSourceMeta {
  columns: ColumnInfo[];
  rows: Array<Array<string | number | boolean | null>>;
  totalRows: number;
  truncated: boolean;
  hasSchema: boolean;
  hasRows: boolean;
}

export function resolveSourceMetaForProblems(
  source: CanvasSource,
  preview: SourcePreview | null,
  availableSources: readonly CatalogSqlSource[],
  monthlyGoals?: ReadonlyArray<{ year: number; month: number; value: number }>,
): ResolvedSourceMeta {
  if (preview) {
    return {
      columns: preview.columns,
      rows: preview.rows,
      totalRows: typeof preview.total_rows === "number" ? preview.total_rows : preview.rows.length,
      truncated: Boolean(preview.truncated),
      hasSchema: true,
      hasRows: true,
    };
  }

  if (source.type === "inline") {
    const cols: ColumnInfo[] = source.columns.map((name, colIdx) => {
      const colValues = source.rows.map((r) => (Array.isArray(r) ? r[colIdx] : null));
      const inferred = inferColumnType(colValues);
      return {
        name,
        type: inferred,
      };
    });
    return {
      columns: cols,
      rows: source.rows,
      totalRows: source.rows.length,
      truncated: false,
      hasSchema: true,
      hasRows: true,
    };
  }

  if (source.type === "goals") {
    const goalsRows: Array<Array<string | number | boolean | null>> = (monthlyGoals || []).map(
      (g) => [g.year, g.month, g.value],
    );
    return {
      columns: [
        { name: "year", type: "number" },
        { name: "month", type: "number" },
        { name: "value", type: "number" },
      ],
      rows: goalsRows,
      totalRows: goalsRows.length,
      truncated: false,
      hasSchema: true,
      hasRows: goalsRows.length > 0,
    };
  }

  const catalog = availableSources.find((c) => c.id === source.report_id);
  const dataset =
    catalog?.datasets?.find((d) => d.id === (source.dataset || "rows")) || catalog?.datasets?.[0];
  const colNames = dataset?.columns || catalog?.columns || [];

  return {
    columns: colNames.map((name) => ({ name, type: "unknown" as const })),
    rows: [],
    totalRows: 0,
    truncated: false,
    hasSchema: colNames.length > 0,
    hasRows: false,
  };
}

function updateBlockInLayout(
  layout: CanvasLayout,
  pageId: string,
  blockId: string,
  updater: (block: CanvasBlock) => CanvasBlock,
): CanvasLayout {
  return {
    ...layout,
    pages: layout.pages.map((p) =>
      p.id !== pageId
        ? p
        : {
            ...p,
            blocks: p.blocks.map((b) => (b.id === blockId ? updater(b) : b)),
          },
    ),
  };
}

export function isDateCompatibleColumn(col: ColumnInfo | undefined): boolean {
  if (!col) return false;
  return col.type === "date" || col.type === "datetime" || col.looks_like === "date";
}

export function isNumericCompatibleColumn(col: ColumnInfo | undefined): boolean {
  if (!col) return false;
  return col.type === "number" || col.type === "unknown" || col.looks_like === "number";
}

function estimateTextBlockHeight(block: CanvasBlock): {
  estimatedHeight: number;
  usableHeight: number;
  recommendedBlockHeight: number;
} {
  const fontSize = clamp(Number(block.options?.font_size) || 14, 6, 100);
  const lineHeight = fontSize * 1.4;
  const paddingX = 16;
  const paddingY = 16;
  const titleHeight = block.title?.trim() ? Math.max(18, fontSize * 1.25 + 6) : 0;
  const usableWidth = Math.max(24, block.width - paddingX);
  const usableHeight = Math.max(12, block.height - paddingY - titleHeight);
  const avgCharWidth = Math.max(4, fontSize * 0.55);
  const charsPerLine = Math.max(1, Math.floor(usableWidth / avgCharWidth));

  const rawText = block.text || "";
  const paragraphs = rawText.split("\n");
  let totalLines = 0;
  for (const para of paragraphs) {
    totalLines += Math.max(1, Math.ceil(para.length / charsPerLine));
  }
  const estimatedHeight = totalLines * lineHeight;
  const recommendedBlockHeight = Math.ceil(estimatedHeight + paddingY + titleHeight + 6);
  return { estimatedHeight, usableHeight, recommendedBlockHeight };
}

function parseIsoDateKey(val: unknown, granularity: NonNullable<CanvasBlock["options"]>["x_group"]): string | null {
  if (val === null || val === undefined || val === "") return null;
  const str = String(val).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (granularity === "day") return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (granularity === "month") return `${year}-${String(month).padStart(2, "0")}`;
  if (granularity === "quarter") return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  if (granularity === "year") return `${year}`;
  if (granularity === "week") {
    const dt = new Date(Date.UTC(year, month - 1, day));
    const dow = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - dow);
    return dt.toISOString().slice(0, 10);
  }
  return str;
}

function estimateChartPointsAndNegatives(
  block: CanvasBlock,
  meta: ResolvedSourceMeta,
  xIdx: number,
  yIndices: number[],
): { pointCount: number; hasPieNegative: boolean } {
  const opt = block.options || {};
  const xGroup = opt.x_group;
  const yAgg = opt.y_aggregate || (xGroup ? "sum" : undefined);

  if (!meta.hasRows) {
    return { pointCount: meta.totalRows, hasPieNegative: false };
  }

  if (!xGroup && !yAgg) {
    const pointCount = Math.max(meta.totalRows, meta.rows.length);
    let hasPieNegative = false;
    if (block.type === "pie" && yIndices.length > 0) {
      const yi = yIndices[0];
      hasPieNegative = meta.rows.some((r) => {
        const n = parseNumberOrNull(r[yi]);
        return n !== null && n < 0;
      });
    }
    return { pointCount, hasPieNegative };
  }

  // Grouped or aggregated over available sample rows
  const buckets = new Map<string, Array<number[]>>();
  for (const r of meta.rows) {
    const rawX = r[xIdx];
    const key = xGroup ? parseIsoDateKey(rawX, xGroup) : rawX == null ? "" : String(rawX);
    if (key === null) continue;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = yIndices.map(() => []);
      buckets.set(key, bucket);
    }
    yIndices.forEach((yi, sIdx) => {
      if (yAgg === "count") {
        if (r[yi] !== null && r[yi] !== undefined && r[yi] !== "") {
          bucket![sIdx].push(1);
        }
      } else {
        const num = parseNumberOrNull(r[yi]);
        if (num !== null) bucket![sIdx].push(num);
      }
    });
  }

  let hasPieNegative = false;
  if (block.type === "pie" && yIndices.length > 0 && yAgg !== "count") {
    for (const seriesArr of buckets.values()) {
      const vals = seriesArr[0] || [];
      if (!vals.length) continue;
      let aggVal = 0;
      if (yAgg === "avg") aggVal = vals.reduce((a, b) => a + b, 0) / vals.length;
      else if (yAgg === "min") aggVal = Math.min(...vals);
      else if (yAgg === "max") aggVal = Math.max(...vals);
      else aggVal = vals.reduce((a, b) => a + b, 0);
      if (aggVal < 0) {
        hasPieNegative = true;
        break;
      }
    }
  }

  return { pointCount: buckets.size, hasPieNegative };
}

export function computeProblems(
  layout: CanvasLayout,
  sourcePreviews?: SourcePreviewsInput,
  availableSources: readonly CatalogSqlSource[] = [],
  options?: ComputeProblemsOptions,
): Problem[] {
  const problems: Problem[] = [];
  const sourceById = new Map<string, CanvasSource>();
  for (const s of layout.sources) {
    sourceById.set(s.id, s);
  }

  for (const page of layout.pages) {
    for (const block of page.blocks) {
      const blockName = getBlockProblemTitle(block);
      const pageName = page.name || page.id;

      // 1. Out of page bounds
      const outOfBounds =
        block.x < 0 ||
        block.y < 0 ||
        block.width < 20 ||
        block.height < 20 ||
        block.x + block.width > layout.page.width + 0.01 ||
        block.y + block.height > layout.page.height + 0.01;

      if (outOfBounds) {
        problems.push({
          blockId: block.id,
          pageId: page.id,
          severity: "error",
          code: "block_out_of_page",
          message: formatProblemMessage(
            blockName,
            pageName,
            `posição ou tamanho fora dos limites da página (${layout.page.width}×${layout.page.height} px)`,
            "Ajuste posição e dimensões na aba Aparência",
          ),
          fix: {
            label: "Ajustar à página",
            targetTab: "appearance",
            targetFieldId: "insp-geom-x",
            apply: (prev) =>
              updateBlockInLayout(prev, page.id, block.id, (b) =>
                clampBlockToPage(b, prev.page.width, prev.page.height),
              ),
          },
        });
      }

      // 2. Image block
      if (block.type === "image") {
        const invalidUuid = !block.asset_id || !UUID_RE.test(block.asset_id);
        const missingFromAssets =
          !invalidUuid &&
          options?.assets !== undefined &&
          !options.assets.some((a) => a.id === block.asset_id);
        if (invalidUuid || missingFromAssets) {
          problems.push({
            blockId: block.id,
            pageId: page.id,
            severity: "error",
            code: "image_missing",
            message: formatProblemMessage(
              blockName,
              pageName,
              "nenhuma imagem válida vinculada ao bloco",
              "Escolha ou envie uma imagem na aba Conteúdo",
            ),
            fix: {
              label: "Escolher imagem",
              targetTab: "content",
              targetFieldId: "insp-image-asset",
            },
          });
        }
        continue;
      }

      // 3. Text block
      if (block.type === "text") {
        if (block.source_id && !sourceById.has(block.source_id)) {
          problems.push({
            blockId: block.id,
            pageId: page.id,
            severity: "warning",
            code: "source_missing",
            message: formatProblemMessage(
              blockName,
              pageName,
              `a fonte "${block.source_id}" não existe no relatório`,
              "Remova o vínculo ou escolha outra fonte",
            ),
            fix: {
              label: "Limpar fonte",
              targetTab: "content",
              targetFieldId: "insp-text-body",
              apply: (prev) =>
                updateBlockInLayout(prev, page.id, block.id, (b) => ({
                  ...b,
                  source_id: undefined,
                })),
            },
          });
        }

        if (block.text && block.text.trim().length > 0) {
          const { estimatedHeight, usableHeight, recommendedBlockHeight } =
            estimateTextBlockHeight(block);
          if (estimatedHeight > usableHeight) {
            problems.push({
              blockId: block.id,
              pageId: page.id,
              severity: "warning",
              code: "text_overflow",
              message: formatProblemMessage(
                blockName,
                pageName,
                `o texto estimado (${Math.ceil(estimatedHeight)} px) não cabe na altura útil do bloco (${Math.floor(usableHeight)} px)`,
                "Aumente a altura do bloco ou reduza o texto",
              ),
              fix: {
                label: "Ajustar altura",
                targetTab: "appearance",
                targetFieldId: "insp-geom-h",
                apply: (prev) =>
                  updateBlockInLayout(prev, page.id, block.id, (b) =>
                    clampBlockToPage(
                      {
                        ...b,
                        height: Math.min(prev.page.height - b.y, recommendedBlockHeight),
                      },
                      prev.page.width,
                      prev.page.height,
                    ),
                  ),
              },
            });
          }
        }
        continue;
      }

      // 4. Data blocks (kpi, table, bar, line, pie): validate source
      if (!block.source_id) {
        problems.push({
          blockId: block.id,
          pageId: page.id,
          severity: "error",
          code: "no_source",
          message: formatProblemMessage(
            blockName,
            pageName,
            "nenhuma fonte de dados selecionada",
            "Escolha uma fonte na aba Dados",
          ),
          fix: {
            label: "Escolher fonte",
            targetTab: "data",
            targetFieldId: "insp-source-select",
          },
        });
        continue;
      }

      const source = sourceById.get(block.source_id);
      const sqlCatalogMissing =
        source?.type === "report" &&
        availableSources.length > 0 &&
        !availableSources.some((c) => c.id === source.report_id);

      if (!source || sqlCatalogMissing) {
        problems.push({
          blockId: block.id,
          pageId: page.id,
          severity: "error",
          code: "source_missing",
          message: formatProblemMessage(
            blockName,
            pageName,
            `a fonte "${block.source_id}" não foi encontrada`,
            "Selecione uma fonte disponível na aba Dados",
          ),
          fix: {
            label: "Trocar fonte",
            targetTab: "data",
            targetFieldId: "insp-source-select",
          },
        });
        continue;
      }

      const preview = getPreviewFromInput(sourcePreviews, source.id);
      const meta = resolveSourceMetaForProblems(
        source,
        preview,
        availableSources,
        options?.monthlyGoals,
      );
      const colMap = new Map<string, ColumnInfo>();
      for (const col of meta.columns) {
        colMap.set(col.name, col);
      }
      const opt = block.options || {};

      // 5. KPI checks
      if (block.type === "kpi") {
        const agg = opt.aggregate ?? "sum";
        const valField = opt.value_field?.trim() || "";
        if (agg !== "count" && !valField) {
          problems.push({
            blockId: block.id,
            pageId: page.id,
            severity: "error",
            code: "kpi_no_value_field",
            message: formatProblemMessage(
              blockName,
              pageName,
              "coluna de valor não definida para o indicador",
              "Selecione uma coluna numérica na aba Conteúdo",
            ),
            fix: {
              label: "Escolher coluna",
              targetTab: "content",
              targetFieldId: "insp-kpi-value",
            },
          });
          continue;
        }

        if (agg !== "count" && valField && meta.hasSchema) {
          const colInfo = colMap.get(valField);
          if (!colInfo) {
            problems.push({
              blockId: block.id,
              pageId: page.id,
              severity: "error",
              code: "column_missing",
              message: formatProblemMessage(
                blockName,
                pageName,
                `a coluna "${valField}" não existe na fonte atual`,
                "Selecione uma coluna válida na aba Conteúdo",
              ),
              fix: {
                label: "Trocar coluna",
                targetTab: "content",
                targetFieldId: "insp-kpi-value",
              },
            });
          } else if (!isNumericCompatibleColumn(colInfo)) {
            const typeLabel = COLUMN_TYPE_LABELS[colInfo.type as ColumnDataType] || colInfo.type;
            problems.push({
              blockId: block.id,
              pageId: page.id,
              severity: "error",
              code: "y_not_numeric",
              message: formatProblemMessage(
                blockName,
                pageName,
                `a coluna "${valField}" tem tipo ${typeLabel} e não é numérica`,
                "Escolha uma coluna numérica ou use a agregação Contagem",
              ),
              fix: {
                label: "Trocar coluna",
                targetTab: "content",
                targetFieldId: "insp-kpi-value",
              },
            });
          }
        }
        continue;
      }

      // 6. Table checks
      if (block.type === "table") {
        const explicitCols = Array.isArray(opt.columns) ? opt.columns : undefined;
        const effectiveCols =
          explicitCols !== undefined ? explicitCols : meta.columns.map((c) => c.name);

        if ((explicitCols !== undefined && explicitCols.length === 0) || (meta.hasSchema && effectiveCols.length === 0)) {
          problems.push({
            blockId: block.id,
            pageId: page.id,
            severity: "error",
            code: "columns_empty",
            message: formatProblemMessage(
              blockName,
              pageName,
              "nenhuma coluna selecionada para exibição na tabela",
              meta.columns.length > 0
                ? "Marque ao menos uma coluna na aba Conteúdo"
                : "Escolha uma fonte com colunas disponíveis",
            ),
            fix:
              meta.columns.length > 0
                ? {
                    label: "Selecionar todas",
                    targetTab: "content",
                    targetFieldId: "insp-table-cols",
                    apply: (prev) =>
                      updateBlockInLayout(prev, page.id, block.id, (b) => ({
                        ...b,
                        options: {
                          ...b.options,
                          columns: meta.columns.map((c) => c.name),
                        },
                      })),
                  }
                : {
                    label: "Ver colunas",
                    targetTab: "content",
                    targetFieldId: "insp-table-cols",
                  },
          });
        }

        if (meta.hasSchema && explicitCols && explicitCols.length > 0) {
          const seenMissing = new Set<string>();
          for (const colName of explicitCols) {
            if (!colMap.has(colName) && !seenMissing.has(colName)) {
              seenMissing.add(colName);
              problems.push({
                blockId: block.id,
                pageId: page.id,
                severity: "error",
                code: "column_missing",
                message: formatProblemMessage(
                  blockName,
                  pageName,
                  `a coluna "${colName}" não existe na fonte atual`,
                  "Desmarque a coluna ausente na aba Conteúdo",
                ),
                fix: {
                  label: "Remover ausentes",
                  targetTab: "content",
                  targetFieldId: "insp-table-cols",
                  apply: (prev) =>
                    updateBlockInLayout(prev, page.id, block.id, (b) => ({
                      ...b,
                      options: {
                        ...b.options,
                        columns: (b.options?.columns || []).filter((c) => colMap.has(c)),
                      },
                    })),
                },
              });
            }
          }
        }

        const widths = Array.isArray(opt.column_widths) ? opt.column_widths : [];
        if (widths.length > 0) {
          const sumWidths = widths.reduce((acc, w) => acc + (Number(w) || 0), 0);
          const countMismatch =
            effectiveCols.length > 0 && widths.length !== effectiveCols.length;
          const sumExceedsBlock = sumWidths > block.width + 0.5;

          if (countMismatch || sumExceedsBlock) {
            const targetCount = effectiveCols.length > 0 ? effectiveCols.length : widths.length;
            const detail = countMismatch
              ? `há ${widths.length} larguras manuais para ${effectiveCols.length} colunas selecionadas`
              : `a soma das larguras (${Math.round(sumWidths)} px) excede a largura do bloco (${Math.round(block.width)} px)`;
            problems.push({
              blockId: block.id,
              pageId: page.id,
              severity: "error",
              code: "table_widths_mismatch",
              message: formatProblemMessage(
                blockName,
                pageName,
                detail,
                "Ajuste as larguras proporcionalmente na aba Conteúdo",
              ),
              fix: {
                label: "Ajustar proporcionalmente",
                targetTab: "content",
                targetFieldId: "insp-table-width-0",
                apply: (prev) =>
                  updateBlockInLayout(prev, page.id, block.id, (b) => ({
                    ...b,
                    options: {
                      ...b.options,
                      column_widths: adjustWidthsProportionally(
                        b.options?.column_widths || widths,
                        b.width,
                        targetCount,
                      ),
                    },
                  })),
              },
            });
          }
        }
        continue;
      }

      // 7. Chart checks (bar, line, pie)
      const xField = opt.x_field?.trim() || "";
      const yFields = (opt.y_fields || []).map((y) => y.trim()).filter(Boolean);
      const maxSeries = block.type === "pie" ? 1 : 6;

      if (!xField || yFields.length === 0) {
        const missingPart = !xField
          ? block.type === "pie"
            ? "a coluna de categoria não foi selecionada"
            : "a coluna do eixo X não foi selecionada"
          : "nenhuma série numérica (eixo Y) foi selecionada";
        problems.push({
          blockId: block.id,
          pageId: page.id,
          severity: "error",
          code: "columns_empty",
          message: formatProblemMessage(
            blockName,
            pageName,
            missingPart,
            "Configure os campos do gráfico na aba Conteúdo",
          ),
          fix: {
            label: "Escolher colunas",
            targetTab: "content",
            targetFieldId: !xField ? "insp-chart-x" : "insp-chart-y-0",
          },
        });
      }

      if (yFields.length > maxSeries) {
        const limitDesc =
          block.type === "pie"
            ? `gráfico de pizza aceita apenas 1 série, mas há ${yFields.length} selecionadas`
            : `gráfico aceita até 6 séries, mas há ${yFields.length} selecionadas`;
        problems.push({
          blockId: block.id,
          pageId: page.id,
          severity: "error",
          code: "too_many_series",
          message: formatProblemMessage(
            blockName,
            pageName,
            limitDesc,
            block.type === "pie"
              ? "Mantenha apenas 1 série ou troque para gráfico de barras"
              : "Remova as séries excedentes na aba Conteúdo",
          ),
          fix: {
            label: block.type === "pie" ? "Manter 1ª série" : "Manter 6 séries",
            targetTab: "content",
            targetFieldId: "insp-chart-y-0",
            apply: (prev) =>
              updateBlockInLayout(prev, page.id, block.id, (b) => ({
                ...b,
                options: {
                  ...b.options,
                  y_fields: (b.options?.y_fields || []).slice(0, maxSeries),
                },
              })),
          },
        });
      }

      if (meta.hasSchema) {
        const seenMissing = new Set<string>();
        if (xField && !colMap.has(xField)) {
          seenMissing.add(xField);
          problems.push({
            blockId: block.id,
            pageId: page.id,
            severity: "error",
            code: "column_missing",
            message: formatProblemMessage(
              blockName,
              pageName,
              `a coluna "${xField}" não existe na fonte atual`,
              "Escolha outra coluna para o eixo X na aba Conteúdo",
            ),
            fix: {
              label: "Trocar eixo X",
              targetTab: "content",
              targetFieldId: "insp-chart-x",
            },
          });
        }

        yFields.forEach((yCol, idx) => {
          if (!colMap.has(yCol) && !seenMissing.has(yCol)) {
            seenMissing.add(yCol);
            problems.push({
              blockId: block.id,
              pageId: page.id,
              severity: "error",
              code: "column_missing",
              message: formatProblemMessage(
                blockName,
                pageName,
                `a coluna "${yCol}" não existe na fonte atual`,
                "Escolha outra coluna de série na aba Conteúdo",
              ),
              fix: {
                label: "Trocar série",
                targetTab: "content",
                targetFieldId: `insp-chart-y-${idx}`,
              },
            });
          }
        });

        // x_not_date_for_group
        const xInfo = xField ? colMap.get(xField) : undefined;
        if (opt.x_group && xInfo && xInfo.type !== "unknown" && !isDateCompatibleColumn(xInfo)) {
          const typeLabel = COLUMN_TYPE_LABELS[xInfo.type] || xInfo.type;
          problems.push({
            blockId: block.id,
            pageId: page.id,
            severity: "error",
            code: "x_not_date_for_group",
            message: formatProblemMessage(
              blockName,
              pageName,
              `o eixo X "${xField}" (${typeLabel}) não é uma data para agrupar por período`,
              "Remova o agrupamento temporal ou escolha uma coluna de data",
            ),
            fix: {
              label: "Remover agrupamento",
              targetTab: "content",
              targetFieldId: "insp-chart-x",
              apply: (prev) =>
                updateBlockInLayout(prev, page.id, block.id, (b) => ({
                  ...b,
                  options: {
                    ...b.options,
                    x_group: undefined,
                  },
                })),
            },
          });
        }

        // y_not_numeric (when y_aggregate !== "count")
        if (opt.y_aggregate !== "count") {
          yFields.forEach((yCol, idx) => {
            const yInfo = colMap.get(yCol);
            if (yInfo && !isNumericCompatibleColumn(yInfo)) {
              const typeLabel = COLUMN_TYPE_LABELS[yInfo.type] || yInfo.type;
              problems.push({
                blockId: block.id,
                pageId: page.id,
                severity: "error",
                code: "y_not_numeric",
                message: formatProblemMessage(
                  blockName,
                  pageName,
                  `a série "${yCol}" tem tipo ${typeLabel} e não pode ser agregada numericamente`,
                  "Selecione uma coluna numérica ou use a agregação Contagem",
                ),
                fix: {
                  label: "Trocar série",
                  targetTab: "content",
                  targetFieldId: `insp-chart-y-${idx}`,
                },
              });
            }
          });
        }

        // points_over_limit & pie_negative (when xField & yFields are valid)
        if (xField && yFields.length > 0 && colMap.has(xField) && yFields.every((y) => colMap.has(y))) {
          const xIdx = meta.columns.findIndex((c) => c.name === xField);
          const yIndices = yFields.map((y) => meta.columns.findIndex((c) => c.name === y));
          const { pointCount, hasPieNegative } = estimateChartPointsAndNegatives(
            block,
            meta,
            xIdx,
            yIndices,
          );

          if (pointCount > 500) {
            const xCanGroup = isDateCompatibleColumn(xInfo) || xInfo?.type === "unknown";
            const formattedCount = pointCount.toLocaleString("pt-BR");
            problems.push({
              blockId: block.id,
              pageId: page.id,
              severity: "warning",
              code: "points_over_limit",
              message: formatProblemMessage(
                blockName,
                pageName,
                `o gráfico aceita até 500 pontos, mas possui ${formattedCount} pontos`,
                xCanGroup && !opt.x_group
                  ? "Agrupe o eixo X por mês para consolidar os períodos"
                  : "Agrupe ou agregue os dados para reduzir o número de pontos",
              ),
              fix:
                xCanGroup && !opt.x_group
                  ? {
                      label: "Agrupar por mês",
                      targetTab: "content",
                      targetFieldId: "insp-chart-x-group",
                      apply: (prev) =>
                        updateBlockInLayout(prev, page.id, block.id, (b) => ({
                          ...b,
                          options: {
                            ...b.options,
                            x_group: "month",
                            y_aggregate: b.options?.y_aggregate || "sum",
                          },
                        })),
                    }
                  : {
                      label: "Agregar valores",
                      targetTab: "content",
                      targetFieldId: "insp-chart-y-agg",
                      apply: (prev) =>
                        updateBlockInLayout(prev, page.id, block.id, (b) => ({
                          ...b,
                          options: {
                            ...b.options,
                            y_aggregate: b.options?.y_aggregate || "sum",
                          },
                        })),
                    },
            });
          }

          if (hasPieNegative) {
            problems.push({
              blockId: block.id,
              pageId: page.id,
              severity: "error",
              code: "pie_negative",
              message: formatProblemMessage(
                blockName,
                pageName,
                `a série "${yFields[0]}" possui valores negativos incompatíveis com gráfico de pizza`,
                "Troque para gráfico de barras ou escolha outra coluna",
              ),
              fix: {
                label: "Usar barras",
                targetTab: "content",
                targetFieldId: "insp-chart-type",
                apply: (prev) =>
                  updateBlockInLayout(prev, page.id, block.id, (b) => ({
                    ...b,
                    type: "bar",
                  })),
              },
            });
          }
        }
      }
    }
  }

  return problems;
}
