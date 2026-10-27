import type { CanvasLayout } from "../model";

export type LimitSeverity = "ok" | "warning" | "danger";

export const CANVAS_LIMITS = {
  blocks: 100,
  sources: 30,
  pages: 30,
  images: 20,
  layoutKb: 750,
  layoutBytes: 750_000,
} as const;

export interface LimitMetric {
  key: "blocks" | "sources" | "pages" | "images" | "layoutKb";
  label: string;
  used: number;
  max: number;
  unit?: string;
  ratio: number;
  severity: LimitSeverity;
  formatted: string;
}

export interface CanvasLimitsSummary {
  blocks: LimitMetric;
  sources: LimitMetric;
  pages: LimitMetric;
  images: LimitMetric;
  layoutKb: LimitMetric;
  items: LimitMetric[];
  layoutBytes: number;
  overallSeverity: LimitSeverity;
}

export function classifyLimitRatio(ratio: number): LimitSeverity {
  if (!Number.isFinite(ratio) || ratio <= 0) return "ok";
  if (ratio >= 1) return "danger";
  if (ratio >= 0.8) return "warning";
  return "ok";
}

function buildMetric(params: {
  key: LimitMetric["key"];
  label: string;
  used: number;
  max: number;
  ratio?: number;
  unit?: string;
  formattedUsed?: string;
}): LimitMetric {
  const ratio = params.ratio ?? (params.max > 0 ? params.used / params.max : 0);
  const severity = classifyLimitRatio(ratio);
  const usedStr = params.formattedUsed ?? String(params.used);
  const suffix = params.unit ? ` ${params.unit}` : "";
  return {
    key: params.key,
    label: params.label,
    used: params.used,
    max: params.max,
    ...(params.unit ? { unit: params.unit } : {}),
    ratio,
    severity,
    formatted: `${usedStr}/${params.max}${suffix}`,
  };
}

function formatKbPtBr(kb: number): string {
  if (kb <= 0) return "0";
  if (kb >= 10 || Number.isInteger(kb)) return String(Math.round(kb));
  return kb.toFixed(1).replace(".", ",");
}

export function computeLimits(
  layout: CanvasLayout,
  options?: number | { assetCount?: number },
): CanvasLimitsSummary {
  const pagesUsed = layout.pages.length;
  const sourcesUsed = layout.sources.length;
  let blocksUsed = 0;
  const referencedAssets = new Set<string>();

  for (const page of layout.pages) {
    blocksUsed += page.blocks.length;
    for (const block of page.blocks) {
      if (block.type === "image" && block.asset_id) {
        referencedAssets.add(block.asset_id);
      }
    }
  }

  const explicitAssets =
    typeof options === "number"
      ? options
      : typeof options?.assetCount === "number"
        ? options.assetCount
        : undefined;

  const imagesUsed =
    explicitAssets !== undefined
      ? Math.max(0, Math.round(explicitAssets), referencedAssets.size)
      : referencedAssets.size;

  const serialized = JSON.stringify(layout);
  const layoutBytes = new TextEncoder().encode(serialized).length;
  const kbRounded = Math.round((layoutBytes / 1000) * 10) / 10;

  const blocks = buildMetric({
    key: "blocks",
    label: "Blocos",
    used: blocksUsed,
    max: CANVAS_LIMITS.blocks,
  });
  const sources = buildMetric({
    key: "sources",
    label: "Fontes",
    used: sourcesUsed,
    max: CANVAS_LIMITS.sources,
  });
  const pages = buildMetric({
    key: "pages",
    label: "Páginas",
    used: pagesUsed,
    max: CANVAS_LIMITS.pages,
  });
  const images = buildMetric({
    key: "images",
    label: "Imagens",
    used: imagesUsed,
    max: CANVAS_LIMITS.images,
  });
  const layoutKb = buildMetric({
    key: "layoutKb",
    label: "Layout",
    used: kbRounded,
    max: CANVAS_LIMITS.layoutKb,
    ratio: layoutBytes / CANVAS_LIMITS.layoutBytes,
    unit: "KB",
    formattedUsed: formatKbPtBr(kbRounded),
  });

  const items: LimitMetric[] = [blocks, sources, pages, images, layoutKb];
  const overallSeverity: LimitSeverity = items.some((i) => i.severity === "danger")
    ? "danger"
    : items.some((i) => i.severity === "warning")
      ? "warning"
      : "ok";

  return {
    blocks,
    sources,
    pages,
    images,
    layoutKb,
    items,
    layoutBytes,
    overallSeverity,
  };
}
