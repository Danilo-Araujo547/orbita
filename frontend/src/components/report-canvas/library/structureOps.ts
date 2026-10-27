import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { BlockType, CanvasBlock, CanvasLayout, CanvasPage } from "../model";
import { BLOCK_LABELS, DEFAULT_SIZES, clamp, clampBlockToPage, makeId } from "../model";
import { selectAllBlockIds } from "../state/selectors";

export const DRAG_BLOCK_MIME = "application/x-orbita-block-type";

export function isBlockType(val: string): val is BlockType {
  return Object.prototype.hasOwnProperty.call(BLOCK_LABELS, val);
}

function cloneBlockOptions(options: CanvasBlock["options"]): CanvasBlock["options"] {
  if (!options) return undefined;
  const copy: Record<string, unknown> = { ...options };
  for (const key of Object.keys(copy)) {
    const val = copy[key];
    if (Array.isArray(val)) {
      copy[key] = [...val];
    }
  }
  return copy as CanvasBlock["options"];
}

export function duplicatePageInLayout(
  prev: CanvasLayout,
  pageId: string,
): { ok: true; layout: CanvasLayout; pageId: string } | { ok: false; error: string } {
  if (prev.pages.length >= 30) {
    return { ok: false, error: "Limite de 30 páginas por relatório atingido." };
  }
  const sourceIdx = prev.pages.findIndex((p) => p.id === pageId);
  if (sourceIdx < 0) {
    return { ok: false, error: "Página de origem não encontrada." };
  }
  const sourcePage = prev.pages[sourceIdx];
  const usedBlockIds = new Set(selectAllBlockIds(prev));
  if (usedBlockIds.size + sourcePage.blocks.length > 100) {
    return {
      ok: false,
      error: `Não é possível duplicar "${sourcePage.name}": limite máximo de 100 blocos seria excedido.`,
    };
  }

  const pageIds = new Set(prev.pages.map((p) => p.id));
  const nextPageId = makeId("p", pageIds);
  const clonedBlocks: CanvasBlock[] = sourcePage.blocks.map((block) => {
    const nextBlockId = makeId("b", usedBlockIds);
    usedBlockIds.add(nextBlockId);
    return clampBlockToPage(
      {
        ...block,
        id: nextBlockId,
        options: cloneBlockOptions(block.options),
      },
      prev.page.width,
      prev.page.height,
    );
  });

  const baseName = sourcePage.name.trim() || `Página ${sourceIdx + 1}`;
  const copyPage: CanvasPage = {
    id: nextPageId,
    name: `${baseName} (cópia)`.slice(0, 100),
    blocks: clonedBlocks,
  };

  const nextPages = [...prev.pages];
  nextPages.splice(sourceIdx + 1, 0, copyPage);

  return {
    ok: true,
    layout: { ...prev, pages: nextPages },
    pageId: nextPageId,
  };
}

export function computeVisibleCenterPosition(params: {
  stageEl: HTMLElement | null;
  type: BlockType;
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  blockCountOnPage: number;
}): { x: number; y: number } {
  const { stageEl, type, pageWidth, pageHeight, zoom, blockCountOnPage } = params;
  const size = DEFAULT_SIZES[type];
  const cascade = (blockCountOnPage % 6) * 14;
  const maxX = Math.max(0, pageWidth - size.w);
  const maxY = Math.max(0, pageHeight - size.h);

  if (!stageEl || stageEl.clientWidth <= 0 || stageEl.clientHeight <= 0 || zoom <= 0) {
    return {
      x: Math.round(clamp((pageWidth - size.w) / 2 + cascade, 0, maxX)),
      y: Math.round(clamp(120 + cascade, 0, maxY)),
    };
  }

  const pageEl = stageEl.querySelector<HTMLElement>(".cv-page");
  if (!pageEl) {
    return {
      x: Math.round(clamp((pageWidth - size.w) / 2 + cascade, 0, maxX)),
      y: Math.round(clamp(120 + cascade, 0, maxY)),
    };
  }

  const stageRect = stageEl.getBoundingClientRect();
  const pageRect = pageEl.getBoundingClientRect();
  const visibleLeft = Math.max(stageRect.left, pageRect.left);
  const visibleRight = Math.min(stageRect.right, pageRect.right);
  const visibleTop = Math.max(stageRect.top, pageRect.top);
  const visibleBottom = Math.min(stageRect.bottom, pageRect.bottom);

  const centerClientX =
    visibleRight > visibleLeft
      ? (visibleLeft + visibleRight) / 2
      : stageRect.left + stageRect.width / 2;
  const centerClientY =
    visibleBottom > visibleTop
      ? (visibleTop + visibleBottom) / 2
      : stageRect.top + stageRect.height / 2;

  const pageCenterX = (centerClientX - pageRect.left) / zoom;
  const pageCenterY = (centerClientY - pageRect.top) / zoom;

  return {
    x: Math.round(clamp(pageCenterX - size.w / 2 + cascade, 0, maxX)),
    y: Math.round(clamp(pageCenterY - size.h / 2 + cascade, 0, maxY)),
  };
}

export function computePageDropPosition(params: {
  stageEl: HTMLElement | null;
  clientX: number;
  clientY: number;
  type: BlockType;
  pageWidth: number;
  pageHeight: number;
  zoom: number;
}): { x: number; y: number } {
  const { stageEl, clientX, clientY, type, pageWidth, pageHeight, zoom } = params;
  const size = DEFAULT_SIZES[type];
  const maxX = Math.max(0, pageWidth - size.w);
  const maxY = Math.max(0, pageHeight - size.h);
  const pageEl = stageEl?.querySelector<HTMLElement>(".cv-page");
  if (!pageEl || zoom <= 0) {
    return {
      x: Math.round(clamp((pageWidth - size.w) / 2, 0, maxX)),
      y: Math.round(clamp(120, 0, maxY)),
    };
  }
  const rect = pageEl.getBoundingClientRect();
  const rawX = (clientX - rect.left) / zoom - size.w / 2;
  const rawY = (clientY - rect.top) / zoom - size.h / 2;
  return {
    x: Math.round(clamp(rawX, 0, maxX)),
    y: Math.round(clamp(rawY, 0, maxY)),
  };
}

export function useStageBlockDrop({
  stageRef,
  zoom,
  pageWidth,
  pageHeight,
  disabled,
  onDropBlock,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  pageWidth: number;
  pageHeight: number;
  disabled: boolean;
  onDropBlock: (type: BlockType, pos: { x: number; y: number }) => void;
}) {
  const cbRef = useRef(onDropBlock);
  cbRef.current = onDropBlock;
  const metaRef = useRef({ zoom, pageWidth, pageHeight, disabled });
  metaRef.current = { zoom, pageWidth, pageHeight, disabled };

  useEffect(() => {
    const el = stageRef.current;
    if (!el || disabled) return;

    const hasBlockType = (dt: DataTransfer | null) =>
      Boolean(dt && Array.from(dt.types || []).includes(DRAG_BLOCK_MIME));

    const onDragOver = (event: DragEvent) => {
      if (metaRef.current.disabled || !hasBlockType(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    const onDrop = (event: DragEvent) => {
      if (metaRef.current.disabled || !event.dataTransfer) return;
      const rawType = event.dataTransfer.getData(DRAG_BLOCK_MIME);
      if (!isBlockType(rawType)) return;
      event.preventDefault();
      const pos = computePageDropPosition({
        stageEl: el,
        clientX: event.clientX,
        clientY: event.clientY,
        type: rawType,
        pageWidth: metaRef.current.pageWidth,
        pageHeight: metaRef.current.pageHeight,
        zoom: metaRef.current.zoom,
      });
      cbRef.current(rawType, pos);
    };

    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
    };
  }, [disabled, stageRef]);
}
