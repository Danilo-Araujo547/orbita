import type {
  CanvasBlock,
  CanvasLayout,
  CanvasPage,
  CanvasPageConfig,
  CanvasSource,
  CatalogSqlSource,
} from "../model";
import { sourceColumns } from "../sampleData";

export function selectActivePage(layout: CanvasLayout, activePageId: string): CanvasPage {
  return layout.pages.find((p) => p.id === activePageId) || layout.pages[0];
}

export function selectSelectedBlock(
  page: CanvasPage | undefined,
  selectedBlockId: string | null,
): CanvasBlock | null {
  if (!page || !selectedBlockId) return null;
  return page.blocks.find((b) => b.id === selectedBlockId) || null;
}

export function selectAllBlockIds(layout: CanvasLayout): Set<string> {
  const ids = new Set<string>();
  for (const p of layout.pages) {
    for (const b of p.blocks) ids.add(b.id);
  }
  return ids;
}

export function selectKnownColumns(
  sources: CanvasSource[],
  availableSources: CatalogSqlSource[],
  sourceId?: string,
): string[] {
  if (!sourceId) return [];
  const src = sources.find((s) => s.id === sourceId);
  if (!src) return [];
  const cat =
    src.type === "report" ? availableSources.find((c) => c.id === src.report_id) : undefined;
  return sourceColumns(src, cat);
}

export function selectLocalDatasets(
  sources: CanvasSource[],
  monthlyGoals: Array<{ year: number; month: number; value: number }>,
): Map<string, { columns: string[]; rows: unknown[][] }> {
  const map = new Map<string, { columns: string[]; rows: unknown[][] }>();
  const goalsList = Array.isArray(monthlyGoals) ? monthlyGoals : [];
  for (const s of sources) {
    if (s.type === "inline") {
      map.set(s.id, { columns: s.columns, rows: s.rows });
    } else if (s.type === "goals") {
      map.set(s.id, {
        columns: ["year", "month", "value"],
        rows: goalsList.map((g) => [g.year, g.month, g.value]),
      });
    }
  }
  return map;
}

export function selectPageFormatPreset(
  page: CanvasPageConfig,
): "portrait" | "landscape" | "custom" {
  if (page.width === 794 && page.height === 1123) return "portrait";
  if (page.width === 1123 && page.height === 794) return "landscape";
  return "custom";
}
