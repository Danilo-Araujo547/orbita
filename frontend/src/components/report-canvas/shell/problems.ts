import type { CanvasBlock, CanvasLayout, CanvasSource, CatalogSqlSource } from "../model";
import { BLOCK_LABELS, UUID_RE } from "../model";
import { selectKnownColumns } from "../state/selectors";

export type ProblemSeverity = "error" | "warning";

export interface CanvasProblemItem {
  id: string;
  severity: ProblemSeverity;
  message: string;
  pageId?: string;
  pageName?: string;
  blockId?: string;
  blockTitle?: string;
}

export interface CanvasProblemsSummary {
  items: CanvasProblemItem[];
  byBlockId: Record<string, CanvasProblemItem>;
  count: number;
  errorCount: number;
  warningCount: number;
  highestSeverity: ProblemSeverity | null;
}

export const DEFAULT_BLOCK_NAMES: Record<CanvasBlock["type"], string> = {
  text: "Texto",
  kpi: "KPI",
  table: "Tabela",
  bar: "Gráfico de barras",
  line: "Gráfico de linhas",
  pie: "Gráfico de pizza",
  image: "Imagem",
};

export function describeBlockDisplayName(block: CanvasBlock): string {
  const trimmed = block.title?.trim();
  if (trimmed && trimmed !== BLOCK_LABELS[block.type]) {
    return trimmed;
  }
  return trimmed || DEFAULT_BLOCK_NAMES[block.type];
}

export function describeBlockLineage(
  block: CanvasBlock,
  sources: CanvasSource[],
  assetFilenames?: Record<string, string>,
): string | null {
  if (block.type === "image") {
    if (!block.asset_id) return null;
    return assetFilenames?.[block.asset_id] || "imagem vinculada";
  }

  if (block.type === "text") {
    if (block.source_id) {
      const src = sources.find((s) => s.id === block.source_id);
      const srcName =
        (src && "label" in src && typeof src.label === "string" && src.label.trim()) ||
        block.source_id;
      const match = block.text?.match(/\{\{\s*[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\s*\}\}/);
      return match ? `${srcName} › ${match[1]}` : srcName;
    }
    const varMatch = block.text?.match(/\{\{\s*([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\s*\}\}/);
    if (varMatch) return `${varMatch[1]} › ${varMatch[2]}`;
    return null;
  }

  if (!block.source_id) return null;
  const src = sources.find((s) => s.id === block.source_id);
  const srcName =
    (src && "label" in src && typeof src.label === "string" && src.label.trim()) ||
    block.source_id;

  const opt = block.options;
  if (block.type === "kpi") {
    const col =
      opt?.value_field || (opt?.aggregate === "count" ? "contagem" : undefined);
    return col ? `${srcName} › ${col}` : srcName;
  }

  if (block.type === "bar" || block.type === "line" || block.type === "pie") {
    const cols = [opt?.x_field, ...(opt?.y_fields || [])].filter(Boolean);
    return cols.length ? `${srcName} › ${cols.join(", ")}` : srcName;
  }

  if (block.type === "table") {
    const cols = opt?.columns || [];
    if (cols.length === 1) return `${srcName} › ${cols[0]}`;
    if (cols.length > 1) return `${srcName} › ${cols[0]} +${cols.length - 1}`;
    return srcName;
  }

  return srcName;
}

export function computeCanvasProblems(params: {
  layout: CanvasLayout;
  enabled: boolean;
  availableSources: CatalogSqlSource[];
}): CanvasProblemsSummary {
  const { layout, enabled, availableSources } = params;
  const items: CanvasProblemItem[] = [];
  const byBlockId: Record<string, CanvasProblemItem> = {};
  const sourceIds = new Set(layout.sources.map((s) => s.id));

  const addProblem = (item: CanvasProblemItem) => {
    items.push(item);
    if (item.blockId) {
      const prev = byBlockId[item.blockId];
      if (!prev || (prev.severity === "warning" && item.severity === "error")) {
        byBlockId[item.blockId] = item;
      }
    }
  };

  const totalBlocks = layout.pages.reduce((sum, p) => sum + p.blocks.length, 0);
  if (enabled && totalBlocks === 0) {
    addProblem({
      id: "empty-enabled",
      severity: "error",
      message: "Adicione ao menos um bloco ao relatório antes de publicá-lo.",
    });
  }

  for (const page of layout.pages) {
    for (const block of page.blocks) {
      const blockTitle = describeBlockDisplayName(block);
      const base = {
        pageId: page.id,
        pageName: page.name,
        blockId: block.id,
        blockTitle,
      };

      if (
        block.x < 0 ||
        block.y < 0 ||
        block.x + block.width > layout.page.width + 0.01 ||
        block.y + block.height > layout.page.height + 0.01
      ) {
        addProblem({
          id: `${block.id}:bounds`,
          severity: "error",
          message: `Bloco "${blockTitle}" (${page.name}): fora dos limites da página.`,
          ...base,
        });
      }

      if (block.type === "image") {
        if (!block.asset_id || !UUID_RE.test(block.asset_id)) {
          addProblem({
            id: `${block.id}:asset`,
            severity: "error",
            message: `Bloco "${blockTitle}" (${page.name}): selecione ou envie uma imagem.`,
            ...base,
          });
        }
        continue;
      }

      if (block.type === "text") {
        if (block.source_id && !sourceIds.has(block.source_id)) {
          addProblem({
            id: `${block.id}:text-source`,
            severity: "warning",
            message: `Bloco "${blockTitle}" (${page.name}): fonte "${block.source_id}" não existe.`,
            ...base,
          });
        }
        continue;
      }

      if (!block.source_id) {
        addProblem({
          id: `${block.id}:source-missing`,
          severity: "error",
          message: `Bloco "${blockTitle}" (${page.name}): selecione uma fonte de dados.`,
          ...base,
        });
        continue;
      }

      if (!sourceIds.has(block.source_id)) {
        addProblem({
          id: `${block.id}:source-not-found`,
          severity: "error",
          message: `Bloco "${blockTitle}" (${page.name}): a fonte "${block.source_id}" não existe.`,
          ...base,
        });
        continue;
      }

      const opt = block.options;
      if (block.type === "kpi") {
        if ((opt?.aggregate ?? "sum") !== "count" && !opt?.value_field) {
          addProblem({
            id: `${block.id}:kpi-value`,
            severity: "error",
            message: `Bloco "${blockTitle}" (${page.name}): selecione a coluna do valor do indicador.`,
            ...base,
          });
          continue;
        }
      } else if (block.type === "bar" || block.type === "line" || block.type === "pie") {
        if (!opt?.x_field) {
          addProblem({
            id: `${block.id}:chart-x`,
            severity: "error",
            message: `Bloco "${blockTitle}" (${page.name}): selecione a coluna do eixo X.`,
            ...base,
          });
          continue;
        }
        if (!opt?.y_fields || opt.y_fields.length === 0) {
          addProblem({
            id: `${block.id}:chart-y`,
            severity: "error",
            message: `Bloco "${blockTitle}" (${page.name}): selecione ao menos uma coluna de série (Y).`,
            ...base,
          });
          continue;
        }
        if (opt.y_fields.length > 6) {
          addProblem({
            id: `${block.id}:chart-y-max`,
            severity: "error",
            message: `Bloco "${blockTitle}" (${page.name}): máximo de 6 séries por gráfico.`,
            ...base,
          });
          continue;
        }
      }

      const knownCols = selectKnownColumns(layout.sources, availableSources, block.source_id);
      if (knownCols.length > 0) {
        const knownSet = new Set(knownCols);
        const referencedCols = [
          opt?.x_field,
          opt?.value_field,
          ...(opt?.y_fields || []),
          ...(opt?.columns || []),
        ].filter((c): c is string => Boolean(c));
        const unknown = referencedCols.find((c) => !knownSet.has(c));
        if (unknown) {
          addProblem({
            id: `${block.id}:unknown-col`,
            severity: "warning",
            message: `Bloco "${blockTitle}" (${page.name}): coluna "${unknown}" não consta na fonte "${block.source_id}".`,
            ...base,
          });
        }
      }
    }
  }

  const errorCount = items.filter((i) => i.severity === "error").length;
  const warningCount = items.filter((i) => i.severity === "warning").length;

  return {
    items,
    byBlockId,
    count: items.length,
    errorCount,
    warningCount,
    highestSeverity: errorCount > 0 ? "error" : warningCount > 0 ? "warning" : null,
  };
}
