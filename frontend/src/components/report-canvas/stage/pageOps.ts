import type {
  CanvasAssetMeta,
  CanvasBlock,
  CanvasLayout,
  CanvasPage,
} from "../model";
import {
  BLOCK_LABELS,
  UUID_RE,
  clampBlockToPage,
  makeId,
  sanitizeLayoutForApi,
} from "../model";
import { selectAllBlockIds } from "../state/selectors";

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
