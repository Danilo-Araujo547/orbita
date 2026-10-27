import type {
  BlockOptions,
  BlockType,
  CanvasAssetMeta,
  CanvasBlock,
  CanvasLayout,
  CanvasPage,
  CanvasPageConfig,
  CatalogSqlSource,
  DragSession,
} from "../model";
import {
  BLOCK_LABELS,
  DEFAULT_SIZES,
  UUID_RE,
  clamp,
  clampBlockToPage,
  makeId,
  round2,
  sanitizeLayoutForApi,
  validColor,
} from "../model";
import { selectActivePage, selectAllBlockIds, selectKnownColumns } from "../state/selectors";

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
}): { ok: true; layout: CanvasLayout; blockId: string } | { ok: false; error: string } {
  const { layout, activePageId, block } = params;
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
      x: block.x + 20,
      y: block.y + 20,
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

export function createBlankPageInLayout(
  prev: CanvasLayout,
): { ok: true; layout: CanvasLayout; pageId: string } | { ok: false; error: string } {
  if (prev.pages.length >= 30) {
    return { ok: false, error: "Limite de 30 páginas por relatório." };
  }
  const existing = new Set(prev.pages.map((p) => p.id));
  const pid = makeId("p", existing);
  const nextPage: CanvasPage = {
    id: pid,
    name: `Página ${prev.pages.length + 1}`,
    blocks: [],
  };
  return { ok: true, layout: { ...prev, pages: [...prev.pages, nextPage] }, pageId: pid };
}

export function createCoverPageInLayout(
  prev: CanvasLayout,
  assets: CanvasAssetMeta[],
):
  | { ok: true; layout: CanvasLayout; pageId: string; titleBlockId: string }
  | { ok: false; error: string } {
  if (prev.pages.length >= 30) {
    return { ok: false, error: "Limite de 30 páginas por relatório." };
  }
  const allBlockIds = selectAllBlockIds(prev);
  if (allBlockIds.size + (assets[0]?.id ? 2 : 1) > 100) {
    return { ok: false, error: "Limite de 100 blocos atingido." };
  }
  const pageIds = new Set(prev.pages.map((p) => p.id));
  const pid = makeId("capa", pageIds);
  const usedBlocks = new Set(allBlockIds);
  const coverBlocks: CanvasBlock[] = [];

  const nextY = Math.round(prev.page.height * 0.24);
  if (assets[0]?.id) {
    const imgId = makeId("b", usedBlocks);
    usedBlocks.add(imgId);
    const imgW = Math.min(220, prev.page.width - 80);
    coverBlocks.push(
      clampBlockToPage(
        {
          id: imgId,
          type: "image",
          x: Math.round((prev.page.width - imgW) / 2),
          y: Math.max(48, nextY - 120),
          width: imgW,
          height: 96,
          asset_id: assets[0].id,
          options: { color: "#075b94", font_size: 14 },
        },
        prev.page.width,
        prev.page.height,
      ),
    );
  }

  const titleId = makeId("b", usedBlocks);
  usedBlocks.add(titleId);
  const contentW = Math.max(120, prev.page.width - 120);
  coverBlocks.push(
    clampBlockToPage(
      {
        id: titleId,
        type: "text",
        x: 60,
        y: nextY,
        width: contentW,
        height: 110,
        title: "",
        text: "{{report_name}}",
        options: { color: "#075b94", font_size: 26 },
      },
      prev.page.width,
      prev.page.height,
    ),
  );
  const coverPage: CanvasPage = {
    id: pid,
    name: "Capa",
    blocks: coverBlocks,
  };
  return {
    ok: true,
    layout: { ...prev, pages: [coverPage, ...prev.pages] },
    pageId: pid,
    titleBlockId: titleId,
  };
}

export function movePageInLayout(prev: CanvasLayout, pageId: string, dir: -1 | 1): CanvasLayout {
  const idx = prev.pages.findIndex((p) => p.id === pageId);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= prev.pages.length) return prev;
  const next = [...prev.pages];
  const [item] = next.splice(idx, 1);
  next.splice(target, 0, item);
  return { ...prev, pages: next };
}

export function deletePageFromLayout(
  prev: CanvasLayout,
  pageId: string,
  activePageId: string,
): { layout: CanvasLayout; nextActivePageId: string; clearedSelection: boolean } | null {
  if (prev.pages.length <= 1) return null;
  const idx = prev.pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return null;
  const remaining = prev.pages.filter((p) => p.id !== pageId);
  const fallback = remaining[Math.max(0, idx - 1)] || remaining[0];
  const activeDeleted = activePageId === pageId;
  return {
    layout: { ...prev, pages: remaining },
    nextActivePageId: activeDeleted ? fallback.id : activePageId,
    clearedSelection: activeDeleted,
  };
}

export function renamePageInLayout(
  prev: CanvasLayout,
  pageId: string,
  name: string,
): CanvasLayout {
  const page = prev.pages.find((p) => p.id === pageId);
  if (!page || page.name === name) return prev;
  return {
    ...prev,
    pages: prev.pages.map((p) => (p.id === pageId ? { ...p, name } : p)),
  };
}

export function validateLayoutBeforeSend(
  layout: CanvasLayout,
  requireAtLeastOneBlock: boolean,
):
  | { ok: true; layout: CanvasLayout }
  | { ok: false; error: string; pageId?: string; blockId?: string } {
  const clean = sanitizeLayoutForApi(layout);
  const totalBlocks = clean.pages.reduce((acc, p) => acc + p.blocks.length, 0);
  if (requireAtLeastOneBlock && totalBlocks === 0) {
    return { ok: false, error: "Adicione ao menos um bloco ao Canvas." };
  }
  const sourceIds = new Set(clean.sources.map((s) => s.id));
  for (const p of clean.pages) {
    for (const b of p.blocks) {
      if (b.type !== "text" && b.type !== "image" && (!b.source_id || !sourceIds.has(b.source_id))) {
        return {
          ok: false,
          error: `Selecione uma fonte de dados para o bloco "${b.title || BLOCK_LABELS[b.type]}" (${p.name}).`,
          pageId: p.id,
          blockId: b.id,
        };
      }
      if (b.type === "image" && (!b.asset_id || !UUID_RE.test(b.asset_id))) {
        return {
          ok: false,
          error: `Selecione ou envie uma imagem para o bloco em "${p.name}".`,
          pageId: p.id,
          blockId: b.id,
        };
      }
      if (
        (b.type === "bar" || b.type === "line" || b.type === "pie") &&
        b.options?.y_fields &&
        b.options.y_fields.length > 6
      ) {
        return {
          ok: false,
          error: "Selecione no máximo 6 séries numéricas no gráfico.",
          pageId: p.id,
          blockId: b.id,
        };
      }
    }
  }
  return { ok: true, layout: clean };
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
