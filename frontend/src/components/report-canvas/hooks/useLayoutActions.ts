import { useCallback } from "react";
import type {
  BlockType,
  CanvasAssetMeta,
  CanvasBlock,
  CanvasPage,
  CanvasPageConfig,
  CatalogSqlSource,
} from "../model";
import type { BannerMessage } from "../shell/Banner";
import {
  applyBlockRemove,
  applyBlockUpdate,
  applyPageConfigPatch,
  computeArrowNudgeUpdater,
  createBlankPageInLayout,
  createBlockInLayout,
  createCoverPageInLayout,
  deletePageFromLayout,
  duplicateBlockInLayout,
  movePageInLayout,
  renamePageInLayout,
  reorderBlockInLayout,
} from "../stage/geometry";
import type { ArrowKey } from "../stage/geometry";
import type { CanvasStore } from "../state/canvasStore";

export function useLayoutActions({
  store,
  activePage,
  activePageId,
  selectedBlock,
  assets,
  availableSources,
  setActivePageId,
  setSelectedBlockId,
  setBanner,
}: {
  store: CanvasStore;
  activePage: CanvasPage | undefined;
  activePageId: string;
  selectedBlock: CanvasBlock | null;
  assets: CanvasAssetMeta[];
  availableSources: CatalogSqlSource[];
  setActivePageId: (id: string) => void;
  setSelectedBlockId: (id: string | null | ((curr: string | null) => string | null)) => void;
  setBanner: (banner: BannerMessage | null) => void;
}) {
  const { layout } = store;

  const updateBlock = useCallback(
    (
      blockId: string,
      label: string,
      updater: (b: CanvasBlock) => CanvasBlock,
      coalesceKey?: string,
    ) => {
      if (!activePage) return;
      store.apply(
        label,
        (prev) => applyBlockUpdate(prev, activePage.id, blockId, updater),
        coalesceKey ? { coalesceKey } : undefined,
      );
    },
    [activePage, store],
  );

  const updatePageConfig = useCallback(
    (patch: Partial<CanvasPageConfig>, coalesceKey?: string) => {
      store.apply(
        "Configurar página",
        (prev) => applyPageConfigPatch(prev, patch),
        coalesceKey ? { coalesceKey } : undefined,
      );
    },
    [store],
  );

  const removeBlock = useCallback(
    (blockId: string) => {
      store.apply("Excluir bloco", (prev) => applyBlockRemove(prev, blockId));
      setSelectedBlockId((curr) => (curr === blockId ? null : curr));
    },
    [setSelectedBlockId, store],
  );

  const addBlock = useCallback(
    (type: BlockType, explicitAssetId?: string) => {
      const res = createBlockInLayout({
        layout,
        activePageId,
        type,
        explicitAssetId,
        assets,
        availableSources,
      });
      if (!res.ok) {
        setBanner({ tone: "error", text: res.error });
        return;
      }
      store.apply(res.label, () => res.layout);
      setSelectedBlockId(res.blockId);
      setBanner(null);
    },
    [activePageId, assets, availableSources, layout, setBanner, setSelectedBlockId, store],
  );

  const duplicateSelectedBlock = useCallback(() => {
    if (!selectedBlock) return;
    const res = duplicateBlockInLayout({ layout, activePageId, block: selectedBlock, offset: 16 });
    if (!res.ok) {
      setBanner({ tone: "error", text: res.error });
      return;
    }
    store.apply("Duplicar bloco", () => res.layout);
    setSelectedBlockId(res.blockId);
  }, [activePageId, layout, selectedBlock, setBanner, setSelectedBlockId, store]);

  const reorderBlockLayer = useCallback(
    (dir: -1 | 1) => {
      if (!selectedBlock || !activePage) return;
      store.apply("Reordenar camada", (prev) =>
        reorderBlockInLayout(prev, activePage.id, selectedBlock.id, dir),
      );
    },
    [activePage, selectedBlock, store],
  );

  const addCoverPage = useCallback(() => {
    const res = createCoverPageInLayout(layout, assets);
    if (!res.ok) return setBanner({ tone: "error", text: res.error });
    store.apply("Inserir capa", () => res.layout);
    setActivePageId(res.pageId);
    setSelectedBlockId(res.titleBlockId);
  }, [assets, layout, setActivePageId, setBanner, setSelectedBlockId, store]);

  const addBlankPage = useCallback(() => {
    const res = createBlankPageInLayout(layout);
    if (!res.ok) return setBanner({ tone: "error", text: res.error });
    store.apply("Adicionar página", () => res.layout);
    setActivePageId(res.pageId);
    setSelectedBlockId(null);
  }, [layout, setActivePageId, setBanner, setSelectedBlockId, store]);

  const movePage = useCallback(
    (id: string, dir: -1 | 1) =>
      store.apply("Reordenar página", (prev) => movePageInLayout(prev, id, dir)),
    [store],
  );

  const deletePage = useCallback(
    (id: string) => {
      const res = deletePageFromLayout(layout, id, activePageId);
      if (!res) return;
      store.apply("Remover página", () => res.layout);
      setActivePageId(res.nextActivePageId);
      if (res.clearedSelection) setSelectedBlockId(null);
    },
    [activePageId, layout, setActivePageId, setSelectedBlockId, store],
  );

  const renameActivePage = useCallback(
    (name: string) => {
      if (!activePage) return;
      store.apply("Renomear página", (prev) => renamePageInLayout(prev, activePage.id, name), {
        coalesceKey: `page-name:${activePage.id}`,
      });
    },
    [activePage, store],
  );

  const nudgeBlock = useCallback(
    (id: string, key: ArrowKey, step: number) =>
      updateBlock(
        id,
        "Mover bloco",
        computeArrowNudgeUpdater(key, step, layout.page.width, layout.page.height),
        `nudge:${id}`,
      ),
    [layout.page.height, layout.page.width, updateBlock],
  );

  return {
    updateBlock,
    updatePageConfig,
    removeBlock,
    addBlock,
    duplicateSelectedBlock,
    reorderBlockLayer,
    addCoverPage,
    addBlankPage,
    movePage,
    deletePage,
    renameActivePage,
    nudgeBlock,
  };
}
