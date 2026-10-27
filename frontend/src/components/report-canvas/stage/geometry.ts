import type {
  BlockOptions,
  BlockType,
  CanvasAssetMeta,
  CanvasBlock,
  CanvasLayout,
  CanvasPageConfig,
  CatalogSqlSource,
  DragSession,
} from "../model";
import {
  BLOCK_LABELS,
  DEFAULT_SIZES,
  clamp,
  clampBlockToPage,
  makeId,
  round2,
  validColor,
} from "../model";
import { selectActivePage, selectAllBlockIds, selectKnownColumns } from "../state/selectors";

export {
  createBlankPageInLayout,
  createCoverPageInLayout,
  deletePageFromLayout,
  movePageInLayout,
  renamePageInLayout,
  validateLayoutBeforeSend,
} from "./pageOps";

export function applyPageConfigPatch(
  prev: CanvasLayout,
  patch: Partial<CanvasPageConfig>,
): CanvasLayout {
  const nextWidth =
    patch.width !== undefined ? round2(clamp(patch.width, 150, 3000)) : prev.page.width;
  const nextHeight =
    patch.height !== undefined ? round2(clamp(patch.height, 150, 3000)) : prev.page.height;
  const nextColumns =
    patch.columns !== undefined ? Math.round(clamp(patch.columns, 1, 48)) : prev.page.columns;
  const nextBg =
    patch.background !== undefined
      ? validColor(patch.background, prev.page.background)
      : prev.page.background;

  if (
    nextWidth === prev.page.width &&
    nextHeight === prev.page.height &&
    nextColumns === prev.page.columns &&
    nextBg === prev.page.background
  ) {
    return prev;
  }

  return {
    ...prev,
    page: {
      width: nextWidth,
      height: nextHeight,
      columns: nextColumns,
      background: nextBg,
    },
    pages: prev.pages.map((p) => ({
      ...p,
      blocks: p.blocks.map((b) => clampBlockToPage(b, nextWidth, nextHeight)),
    })),
  };
}

export function applyBlockUpdate(
  prev: CanvasLayout,
  pageId: string,
  blockId: string,
  updater: (b: CanvasBlock) => CanvasBlock,
): CanvasLayout {
  let changed = false;
  const pages = prev.pages.map((p) => {
    if (p.id !== pageId) return p;
    const blocks = p.blocks.map((b) => {
      if (b.id !== blockId) return b;
      const updated = updater(b);
      if (updated === b) return b;
      changed = true;
      return clampBlockToPage(updated, prev.page.width, prev.page.height);
    });
    return changed ? { ...p, blocks } : p;
  });
  return changed ? { ...prev, pages } : prev;
}

export function applyBlockRemove(prev: CanvasLayout, blockId: string): CanvasLayout {
  const hasBlock = prev.pages.some((p) => p.blocks.some((b) => b.id === blockId));
  if (!hasBlock) return prev;
  return {
    ...prev,
    pages: prev.pages.map((p) =>
      p.blocks.some((b) => b.id === blockId)
        ? { ...p, blocks: p.blocks.filter((b) => b.id !== blockId) }
        : p,
    ),
  };
}

export function createBlockInLayout(params: {
  layout: CanvasLayout;
  activePageId: string;
  type: BlockType;
  explicitAssetId?: string;
  assets: CanvasAssetMeta[];
  availableSources: CatalogSqlSource[];
}):
  | { ok: true; layout: CanvasLayout; blockId: string; label: string }
  | { ok: false; error: string } {
  const { layout, activePageId, type, explicitAssetId, assets, availableSources } = params;
  const allBlockIds = selectAllBlockIds(layout);
  if (allBlockIds.size >= 100) {
    return { ok: false, error: "Limite máximo de 100 blocos por relatório atingido." };
  }
  const activePage = selectActivePage(layout, activePageId);
  const newId = makeId("b", allBlockIds);
  const countOnPage = activePage?.blocks.length || 0;
  const offset = (countOnPage % 8) * 18;
  const size = DEFAULT_SIZES[type];
  const defaultSource = layout.sources[0];
  const knownCols = defaultSource
    ? selectKnownColumns(layout.sources, availableSources, defaultSource.id)
    : [];

  const options: BlockOptions = {
    color: "#075b94",
    font_size: type === "kpi" ? 28 : type === "text" ? 15 : 13,
  };
  if (type === "kpi") {
    options.aggregate = "sum";
    options.precision = 0;
    if (knownCols.length > 0) {
      options.value_field = knownCols[knownCols.length > 1 ? 1 : 0];
    }
  } else if (type === "bar" || type === "line" || type === "pie") {
    if (knownCols.length > 0) options.x_field = knownCols[0];
    if (knownCols.length > 1) options.y_fields = [knownCols[1]];
  }

  const chosenAssetId = explicitAssetId || assets[0]?.id;
  const created: CanvasBlock = clampBlockToPage(
    {
      id: newId,
      type,
      x: 40 + offset,
      y: 40 + offset,
      width: size.w,
      height: size.h,
      ...(type === "text"
        ? { title: "Título", text: "Texto do bloco" }
        : type === "image"
          ? { ...(chosenAssetId ? { asset_id: chosenAssetId } : {}) }
          : {
              title: BLOCK_LABELS[type],
              ...(defaultSource ? { source_id: defaultSource.id } : {}),
            }),
      options,
    },
    layout.page.width,
    layout.page.height,
  );

  const nextLayout: CanvasLayout = {
    ...layout,
    pages: layout.pages.map((p) =>
      p.id === activePage.id ? { ...p, blocks: [...p.blocks, created] } : p,
    ),
  };

  return {
    ok: true,
    layout: nextLayout,
    blockId: newId,
    label: `Adicionar ${BLOCK_LABELS[type].toLowerCase()}`,
  };
}

export function duplicateBlockInLayout(params: {
  layout: CanvasLayout;
  activePageId: string;
  block: CanvasBlock;
  offset?: number;
}): { ok: true; layout: CanvasLayout; blockId: string } | { ok: false; error: string } {
  const { layout, activePageId, block, offset = 20 } = params;
  const allBlockIds = selectAllBlockIds(layout);
  if (allBlockIds.size >= 100) {
    return { ok: false, error: "Limite de 100 blocos atingido." };
  }
  const activePage = selectActivePage(layout, activePageId);
  const newId = makeId("b", allBlockIds);
  const copy: CanvasBlock = clampBlockToPage(
    {
      ...block,
      id: newId,
      x: block.x + offset,
      y: block.y + offset,
      options: block.options ? { ...block.options } : undefined,
    },
    layout.page.width,
    layout.page.height,
  );
  const nextLayout: CanvasLayout = {
    ...layout,
    pages: layout.pages.map((p) =>
      p.id === activePage.id ? { ...p, blocks: [...p.blocks, copy] } : p,
    ),
  };
  return { ok: true, layout: nextLayout, blockId: newId };
}

export function reorderBlockInLayout(
  prev: CanvasLayout,
  pageId: string,
  blockId: string,
  direction: -1 | 1,
): CanvasLayout {
  const activePage = prev.pages.find((p) => p.id === pageId);
  if (!activePage) return prev;
  const idx = activePage.blocks.findIndex((b) => b.id === blockId);
  const target = idx + direction;
  if (idx < 0 || target < 0 || target >= activePage.blocks.length) return prev;
  return {
    ...prev,
    pages: prev.pages.map((p) => {
      if (p.id !== pageId) return p;
      const next = [...p.blocks];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return { ...p, blocks: next };
    }),
  };
}

export interface SnapGuide {
  type: "vertical" | "horizontal";
  position: number;
  label?: string;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
  snappedX: boolean;
  snappedY: boolean;
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export interface ResizeSnapResult {
  x: number;
  y: number;
  width: number;
  height: number;
  guides: SnapGuide[];
}

export function computeSnapping(params: {
  rect: { x: number; y: number; width: number; height: number };
  otherBlocks: CanvasBlock[];
  pageWidth: number;
  pageHeight: number;
  columns?: number;
  zoom: number;
  disabled?: boolean;
}): SnapResult {
  const { rect, otherBlocks, pageWidth, pageHeight, columns = 1, zoom, disabled = false } = params;
  if (disabled) {
    const clampedX = clamp(rect.x, 0, Math.max(0, pageWidth - rect.width));
    const clampedY = clamp(rect.y, 0, Math.max(0, pageHeight - rect.height));
    return { x: clampedX, y: clampedY, guides: [], snappedX: false, snappedY: false };
  }

  const threshold = 6 / Math.max(0.1, zoom);

  // Targets on X
  const xTargets: { pos: number; label: string }[] = [
    { pos: 24, label: "Margem esquerda (24px)" },
    { pos: pageWidth - 24, label: "Margem direita (24px)" },
    { pos: pageWidth / 2, label: "Centro da página" },
  ];
  if (columns > 1) {
    const colW = pageWidth / columns;
    for (let c = 1; c < columns; c++) {
      xTargets.push({ pos: Math.round(c * colW), label: `Coluna ${c}` });
    }
  }
  for (const b of otherBlocks) {
    xTargets.push(
      { pos: b.x, label: "Alinhamento à esquerda" },
      { pos: b.x + b.width / 2, label: "Centro horizontal" },
      { pos: b.x + b.width, label: "Alinhamento à direita" },
    );
  }

  // Targets on Y
  const yTargets: { pos: number; label: string }[] = [
    { pos: 24, label: "Margem superior (24px)" },
    { pos: pageHeight - 24, label: "Margem inferior (24px)" },
    { pos: pageHeight / 2, label: "Centro vertical da página" },
  ];
  for (const b of otherBlocks) {
    yTargets.push(
      { pos: b.y, label: "Alinhamento ao topo" },
      { pos: b.y + b.height / 2, label: "Centro vertical" },
      { pos: b.y + b.height, label: "Alinhamento à base" },
    );
  }

  // Check moving points on X: left (0), center (width/2), right (width)
  const movingX = [
    { offset: 0, name: "left" },
    { offset: rect.width / 2, name: "center" },
    { offset: rect.width, name: "right" },
  ];
  let bestDeltaX = 0;
  let bestDistX = threshold + 1;
  let snapGuideX: SnapGuide | null = null;

  for (const t of xTargets) {
    for (const m of movingX) {
      const curPos = rect.x + m.offset;
      const diff = t.pos - curPos;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < bestDistX) {
        bestDistX = Math.abs(diff);
        bestDeltaX = diff;
        snapGuideX = { type: "vertical", position: t.pos, label: `${Math.round(t.pos)} px` };
      }
    }
  }

  // Check moving points on Y: top (0), center (height/2), bottom (height)
  const movingY = [
    { offset: 0, name: "top" },
    { offset: rect.height / 2, name: "center" },
    { offset: rect.height, name: "bottom" },
  ];
  let bestDeltaY = 0;
  let bestDistY = threshold + 1;
  let snapGuideY: SnapGuide | null = null;

  for (const t of yTargets) {
    for (const m of movingY) {
      const curPos = rect.y + m.offset;
      const diff = t.pos - curPos;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < bestDistY) {
        bestDistY = Math.abs(diff);
        bestDeltaY = diff;
        snapGuideY = { type: "horizontal", position: t.pos, label: `${Math.round(t.pos)} px` };
      }
    }
  }

  const guides: SnapGuide[] = [];
  let nextX = rect.x;
  let snappedX = false;
  if (snapGuideX) {
    nextX = rect.x + bestDeltaX;
    guides.push(snapGuideX);
    snappedX = true;
  }

  let nextY = rect.y;
  let snappedY = false;
  if (snapGuideY) {
    nextY = rect.y + bestDeltaY;
    guides.push(snapGuideY);
    snappedY = true;
  }

  // Clamp within page
  const clampedX = clamp(nextX, 0, Math.max(0, pageWidth - rect.width));
  const clampedY = clamp(nextY, 0, Math.max(0, pageHeight - rect.height));

  return {
    x: clampedX,
    y: clampedY,
    guides,
    snappedX,
    snappedY,
  };
}

export function computeResizeSnapping(params: {
  handle: ResizeHandle;
  rect: { x: number; y: number; width: number; height: number };
  otherBlocks: CanvasBlock[];
  pageWidth: number;
  pageHeight: number;
  columns?: number;
  zoom: number;
  disabled?: boolean;
}): ResizeSnapResult {
  const { handle, rect, otherBlocks, pageWidth, pageHeight, columns = 1, zoom, disabled = false } = params;
  let { x, y, width, height } = rect;

  const minW = 20;
  const minH = 20;

  if (disabled) {
    width = Math.max(minW, Math.min(width, pageWidth - x));
    height = Math.max(minH, Math.min(height, pageHeight - y));
    return { x, y, width, height, guides: [] };
  }

  const threshold = 6 / Math.max(0.1, zoom);
  const guides: SnapGuide[] = [];

  const xTargets: number[] = [24, pageWidth - 24, pageWidth / 2];
  if (columns > 1) {
    const colW = pageWidth / columns;
    for (let c = 1; c < columns; c++) xTargets.push(Math.round(c * colW));
  }
  for (const b of otherBlocks) {
    xTargets.push(b.x, b.x + b.width / 2, b.x + b.width);
  }

  const yTargets: number[] = [24, pageHeight - 24, pageHeight / 2];
  for (const b of otherBlocks) {
    yTargets.push(b.y, b.y + b.height / 2, b.y + b.height);
  }

  if (handle === "e" || handle === "se" || handle === "ne") {
    const rightEdge = x + width;
    let bestDelta = 0;
    let bestDist = threshold + 1;
    let guidePos: number | null = null;
    for (const t of xTargets) {
      const diff = t - rightEdge;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < bestDist) {
        bestDist = Math.abs(diff);
        bestDelta = diff;
        guidePos = t;
      }
    }
    if (guidePos !== null) {
      width += bestDelta;
      guides.push({ type: "vertical", position: guidePos, label: `${Math.round(guidePos)} px` });
    }
  }

  if (handle === "w" || handle === "sw" || handle === "nw") {
    let bestDelta = 0;
    let bestDist = threshold + 1;
    let guidePos: number | null = null;
    for (const t of xTargets) {
      const diff = t - x;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < bestDist) {
        bestDist = Math.abs(diff);
        bestDelta = diff;
        guidePos = t;
      }
    }
    if (guidePos !== null) {
      const newX = x + bestDelta;
      width += x - newX;
      x = newX;
      guides.push({ type: "vertical", position: guidePos, label: `${Math.round(guidePos)} px` });
    }
  }

  if (handle === "s" || handle === "se" || handle === "sw") {
    const bottomEdge = y + height;
    let bestDelta = 0;
    let bestDist = threshold + 1;
    let guidePos: number | null = null;
    for (const t of yTargets) {
      const diff = t - bottomEdge;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < bestDist) {
        bestDist = Math.abs(diff);
        bestDelta = diff;
        guidePos = t;
      }
    }
    if (guidePos !== null) {
      height += bestDelta;
      guides.push({ type: "horizontal", position: guidePos, label: `${Math.round(guidePos)} px` });
    }
  }

  if (handle === "n" || handle === "nw" || handle === "ne") {
    let bestDelta = 0;
    let bestDist = threshold + 1;
    let guidePos: number | null = null;
    for (const t of yTargets) {
      const diff = t - y;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < bestDist) {
        bestDist = Math.abs(diff);
        bestDelta = diff;
        guidePos = t;
      }
    }
    if (guidePos !== null) {
      const newY = y + bestDelta;
      height += y - newY;
      y = newY;
      guides.push({ type: "horizontal", position: guidePos, label: `${Math.round(guidePos)} px` });
    }
  }

  if (width < minW) {
    if (handle === "w" || handle === "sw" || handle === "nw") {
      x -= minW - width;
    }
    width = minW;
  }
  if (height < minH) {
    if (handle === "n" || handle === "nw" || handle === "ne") {
      y -= minH - height;
    }
    height = minH;
  }

  if (x < 0) {
    width += x;
    x = 0;
  }
  if (y < 0) {
    height += y;
    y = 0;
  }
  if (x + width > pageWidth) {
    width = pageWidth - x;
  }
  if (y + height > pageHeight) {
    height = pageHeight - y;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(minW, Math.round(width)),
    height: Math.max(minH, Math.round(height)),
    guides,
  };
}

export function computePointerDragUpdater(
  drag: DragSession,
  clientX: number,
  clientY: number,
  zoom: number,
  pageW: number,
  pageH: number,
): (b: CanvasBlock) => CanvasBlock {
  const dx = (clientX - drag.startClientX) / zoom;
  const dy = (clientY - drag.startClientY) / zoom;
  if (drag.kind === "move") {
    const nextX = Math.round(clamp(drag.startX + dx, 0, Math.max(0, pageW - drag.width)));
    const nextY = Math.round(clamp(drag.startY + dy, 0, Math.max(0, pageH - drag.height)));
    return (b) => (b.x === nextX && b.y === nextY ? b : { ...b, x: nextX, y: nextY });
  }
  const allowX = drag.handle === "se" || drag.handle === "e";
  const allowY = drag.handle === "se" || drag.handle === "s";
  const nextW = allowX ? Math.round(clamp(drag.startW + dx, 20, pageW - drag.startX)) : drag.startW;
  const nextH = allowY ? Math.round(clamp(drag.startH + dy, 20, pageH - drag.startY)) : drag.startH;
  return (b) =>
    b.width === nextW && b.height === nextH ? b : { ...b, width: nextW, height: nextH };
}

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export function computeArrowNudgeUpdater(
  key: ArrowKey,
  step: number,
  pageW: number,
  pageH: number,
): (b: CanvasBlock) => CanvasBlock {
  return (b) => {
    if (key === "ArrowLeft") {
      const nextX = Math.max(0, b.x - step);
      return nextX === b.x ? b : { ...b, x: nextX };
    }
    if (key === "ArrowRight") {
      const nextX = Math.min(pageW - b.width, b.x + step);
      return nextX === b.x ? b : { ...b, x: nextX };
    }
    if (key === "ArrowUp") {
      const nextY = Math.max(0, b.y - step);
      return nextY === b.y ? b : { ...b, y: nextY };
    }
    const nextY = Math.min(pageH - b.height, b.y + step);
    return nextY === b.y ? b : { ...b, y: nextY };
  };
}

export function toggleMultiColumn(
  list: string[] | undefined,
  col: string,
  maxItems: number,
): string[] {
  const curr = list || [];
  if (curr.includes(col)) {
    return curr.filter((x) => x !== col);
  }
  if (curr.length >= maxItems) return curr;
  return [...curr, col];
}
