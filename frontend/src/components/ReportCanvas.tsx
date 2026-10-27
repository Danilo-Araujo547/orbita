import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AlertTriangle, PanelRightOpen } from "lucide-react";
import DataPanel from "./report-canvas/data/DataPanel";
import SourceDialog from "./report-canvas/data/SourceDialog";
import PreviewDialog from "./report-canvas/dialogs/PreviewDialog";
import { useCanvasSession } from "./report-canvas/hooks/useCanvasSession";
import { useFitZoom } from "./report-canvas/hooks/useFitZoom";
import { useKeyboardShortcuts } from "./report-canvas/hooks/useKeyboardShortcuts";
import { useLayoutActions } from "./report-canvas/hooks/useLayoutActions";
import type { InspectorTab } from "./report-canvas/inspector/BlockInspector";
import Inspector from "./report-canvas/inspector/Inspector";
import BlockLibrary from "./report-canvas/library/BlockLibrary";
import ImagesPanel from "./report-canvas/library/ImagesPanel";
import PagesPanel from "./report-canvas/library/PagesPanel";
import { computeVisibleCenterPosition, duplicatePageInLayout, useStageBlockDrop } from "./report-canvas/library/structureOps";
import type { BlockType, CanvasBlock, ReportCanvasProps } from "./report-canvas/model";
import { clamp, round2 } from "./report-canvas/model";
import Banner from "./report-canvas/shell/Banner";
import EditorShell, { computeFitToPageZoom } from "./report-canvas/shell/EditorShell";
import LeftRail from "./report-canvas/shell/LeftRail";
import PanelResizer from "./report-canvas/shell/PanelResizer";
import { WorkspaceSkeleton } from "./report-canvas/shell/ShellSkeleton";
import StatusBar from "./report-canvas/shell/StatusBar";
import TopBar from "./report-canvas/shell/TopBar";
import { computeCanvasProblems } from "./report-canvas/shell/problems";
import { useShellLayoutPrefs } from "./report-canvas/shell/useShellLayoutPrefs";
import Stage from "./report-canvas/stage/Stage";
import ShortcutsDialog from "./report-canvas/dialogs/ShortcutsDialog";
import ProblemsPanel from "./report-canvas/problems/ProblemsPanel";
import {
  clearDraftFromStorage,
  formatDraftTime,
  isDraftDifferent,
  loadDraftFromStorage,
  saveDraftToStorage,
} from "./report-canvas/state/draftRecovery";
import {
  applyBlockUpdate,
  createBlockInLayout,
  renamePageInLayout,
  reorderBlockInLayout,
} from "./report-canvas/stage/geometry";
import { usePointerDrag } from "./report-canvas/stage/usePointerDrag";
import { useCanvasStore } from "./report-canvas/state/canvasStore";
import { computeLimits } from "./report-canvas/state/limits";
import {
  selectActivePage,
  selectKnownColumns,
  selectLocalDatasets,
  selectSelectedBlock,
} from "./report-canvas/state/selectors";
import "./report-canvas/tokens.css";
import "./report-canvas/layout.css";
import "./report-canvas/shell.css";
import "./report-canvas/library.css";
import "./report-canvas/data.css";
import "./report-canvas/stage.css";
import "./report-canvas/dialogs.css";

export default function ReportCanvas({ unit, report, onClose, onSaved }: ReportCanvasProps) {
  const store = useCanvasStore();
  const { layout } = store;

  const [activePageId, setActivePageId] = useState("p1");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showGrid] = useState(false);
  const [showSampleData, setShowSampleData] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("content");
  const [displayVersion, setDisplayVersion] = useState<number>(report.version || 1);
  const [hiddenAssetIds, setHiddenAssetIds] = useState<string[]>([]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [problemsPanelOpen, setProblemsPanelOpen] = useState(false);
  const [draftBanner, setDraftBanner] = useState<{
    text: string;
    onRestore: () => void;
    onDiscard: () => void;
  } | null>(null);
  const pendingCloseRef = useRef(false);
  const draftCheckedRef = useRef(false);

  useEffect(() => {
    setDisplayVersion(report.version || 1);
    setHiddenAssetIds([]);
    draftCheckedRef.current = false;
    setDraftBanner(null);
  }, [report.id, report.version]);

  const prefs = useShellLayoutPrefs();
  const activePage = useMemo(() => selectActivePage(layout, activePageId), [layout, activePageId]);
  const selectedBlock = useMemo(
    () => selectSelectedBlock(activePage, selectedBlockId),
    [activePage, selectedBlockId],
  );
  const selectPage = useCallback((id: string) => {
    setActivePageId(id);
    setSelectedBlockId(null);
  }, []);

  const fitRef = useRef<(w?: number) => void>(() => {});
  const updateBlockBase = useCallback(
    (blockId: string, label: string, updater: (b: CanvasBlock) => CanvasBlock) => {
      if (activePage) store.apply(label, (prev) => applyBlockUpdate(prev, activePage.id, blockId, updater));
    },
    [activePage, store],
  );

  const handleSessionSaved = useCallback(() => {
    clearDraftFromStorage(unit, report.id, displayVersion);
    setDraftBanner(null);
    setDisplayVersion((v) => v + 1);
    onSaved?.();
    if (pendingCloseRef.current) {
      pendingCloseRef.current = false;
      onClose();
    }
  }, [displayVersion, onClose, onSaved, report.id, unit]);

  const session = useCanvasSession({
    unit,
    report,
    onSaved: handleSessionSaved,
    store,
    activePage,
    selectedBlock,
    selectedBlockId,
    setActivePageId,
    setSelectedBlockId,
    onFitToWidthAfterLoad: (w) => fitRef.current(w),
    onUpdateBlock: updateBlockBase,
    onOpenProblemsPanel: () => setProblemsPanelOpen(true),
  });

  // Draft recovery check on report load
  useEffect(() => {
    if (session.loading) return;
    if (draftCheckedRef.current) return;
    draftCheckedRef.current = true;
    const draft = loadDraftFromStorage(unit, report.id, displayVersion);
    if (
      draft &&
      isDraftDifferent(draft, {
        layout,
        enabled: session.enabled,
        outputFormat: session.outputFormat,
      })
    ) {
      setDraftBanner({
        text: `Há alterações não salvas deste navegador (${formatDraftTime(draft.timestamp)}).`,
        onRestore: () => {
          store.replace(draft.layout);
          session.setEnabled(draft.enabled);
          session.setOutputFormat(draft.outputFormat);
          setDraftBanner(null);
        },
        onDiscard: () => {
          clearDraftFromStorage(unit, report.id, displayVersion);
          setDraftBanner(null);
        },
      });
    }
  }, [displayVersion, layout, report.id, session, store, unit]);

  // Debounced auto-save draft to localStorage (2 seconds, local only)
  const dirty = store.dirty || session.metaDirty;
  useEffect(() => {
    if (!dirty || session.loading || session.busy) return;
    const timer = setTimeout(() => {
      saveDraftToStorage(unit, report.id, displayVersion, {
        layout,
        enabled: session.enabled,
        outputFormat: session.outputFormat,
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [
    dirty,
    displayVersion,
    layout,
    report.id,
    session.busy,
    session.enabled,
    session.loading,
    session.outputFormat,
    unit,
  ]);

  const { zoom, setZoom, stageRef, fitToWidth } = useFitZoom({
    loading: session.loading,
    pageWidth: layout.page.width,
    leftOpen: prefs.leftOpen,
    rightOpen: prefs.rightOpen,
    leftWidth: prefs.leftWidth,
    rightWidth: prefs.rightWidth,
  });
  fitRef.current = fitToWidth;

  const visibleAssets = useMemo(
    () => session.assets.filter((asset) => !hiddenAssetIds.includes(asset.id)),
    [hiddenAssetIds, session.assets],
  );

  const actions = useLayoutActions({
    store,
    activePage,
    activePageId,
    selectedBlock,
    assets: visibleAssets,
    availableSources: session.availableSources,
    setActivePageId,
    setSelectedBlockId,
    setBanner: session.setBanner,
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const resolveKnownColumns = useCallback(
    (sourceId?: string) => selectKnownColumns(layout.sources, session.availableSources, sourceId),
    [layout.sources, session.availableSources],
  );
  const selectedKnownColumns = useMemo(
    () => resolveKnownColumns(selectedBlock?.source_id),
    [resolveKnownColumns, selectedBlock?.source_id],
  );
  const localDatasets = useMemo(
    () => selectLocalDatasets(layout.sources, session.monthlyGoals),
    [layout.sources, session.monthlyGoals],
  );

  const handleReorderBlock = useCallback(
    (blockId: string, dir: -1 | 1) => {
      if (!activePage) return;
      store.apply("Reordenar camada", (prev) => reorderBlockInLayout(prev, activePage.id, blockId, dir));
    },
    [activePage, store],
  );

  const { dragState, activeDrag, startBlockDrag, startBlockResize } = usePointerDrag({
    zoom,
    pageWidth: layout.page.width,
    pageHeight: layout.page.height,
    columns: layout.page.columns,
    blocks: activePage?.blocks || [],
    onSelectBlock: setSelectedBlockId,
    onApplyBlockDrag: (id, label, key, upd) => actions.updateBlock(id, label, upd, key),
  });

  useKeyboardShortcuts({
    selectedBlockId,
    blocks: activePage?.blocks || [],
    modalOpen: Boolean(session.sourceModal || session.previewModal || shortcutsOpen),
    onClearSelection: () => setSelectedBlockId(null),
    onSelectBlock: setSelectedBlockId,
    onDeleteBlock: actions.removeBlock,
    onNudgeBlock: actions.nudgeBlock,
    onDuplicateBlock: actions.duplicateSelectedBlock,
    onReorderBlock: handleReorderBlock,
    onUndo: store.undo,
    onRedo: store.redo,
    onSave: () => void session.handleSaveCanvas(),
    onTogglePanels: prefs.toggleLeftPanel,
    onOpenShortcuts: () => setShortcutsOpen(true),
    onZoomIn: () => setZoom((z) => round2(clamp(z + 0.1, 0.25, 2))),
    onZoomOut: () => setZoom((z) => round2(clamp(z - 0.1, 0.25, 2))),
    onZoomReset: () => setZoom(1),
    onFitToWidth: () => fitToWidth(),
  });

  const limits = useMemo(
    () => computeLimits(layout, visibleAssets.length),
    [layout, visibleAssets.length],
  );

  const problems = useMemo(
    () =>
      computeCanvasProblems({
        layout,
        enabled: session.enabled,
        availableSources: session.availableSources,
      }),
    [layout, session.availableSources, session.enabled],
  );

  const addBlockAtPosition = useCallback(
    (type: BlockType, pos: { x: number; y: number }, explicitAssetId?: string) => {
      const res = createBlockInLayout({
        layout,
        activePageId,
        type,
        explicitAssetId,
        assets: visibleAssets,
        availableSources: session.availableSources,
      });
      if (!res.ok) {
        session.setBanner({ tone: "error", text: res.error });
        return;
      }
      const targetPage = selectActivePage(res.layout, activePageId);
      const positioned = targetPage
        ? applyBlockUpdate(res.layout, targetPage.id, res.blockId, (b) => ({
            ...b,
            x: pos.x,
            y: pos.y,
          }))
        : res.layout;
      store.apply(res.label, () => positioned);
      setSelectedBlockId(res.blockId);
      setInspectorTab("content");
      prefs.openRightPanel();
      session.setBanner(null);
    },
    [activePageId, layout, prefs, session, store, visibleAssets],
  );

  const handleAddBlockCentered = useCallback(
    (type: BlockType, explicitAssetId?: string) => {
      const pos = computeVisibleCenterPosition({
        stageEl: stageRef.current,
        type,
        pageWidth: layout.page.width,
        pageHeight: layout.page.height,
        zoom,
        blockCountOnPage: activePage?.blocks.length || 0,
      });
      addBlockAtPosition(type, pos, explicitAssetId);
    },
    [activePage?.blocks.length, addBlockAtPosition, layout.page.height, layout.page.width, stageRef, zoom],
  );

  useStageBlockDrop({
    stageRef,
    zoom,
    pageWidth: layout.page.width,
    pageHeight: layout.page.height,
    disabled: session.loading,
    onDropBlock: (type, pos) => addBlockAtPosition(type, pos),
  });

  const handleDuplicatePage = useCallback(
    (pageId: string) => {
      const res = duplicatePageInLayout(layout, pageId);
      if (!res.ok) {
        session.setBanner({ tone: "error", text: res.error });
        return;
      }
      store.apply("Duplicar página", () => res.layout);
      setActivePageId(res.pageId);
      setSelectedBlockId(null);
    },
    [layout, session, store],
  );

  const handleRenamePage = useCallback(
    (pageId: string, name: string) => {
      store.apply("Renomear página", (prev) => renamePageInLayout(prev, pageId, name));
    },
    [store],
  );

  const handleFitToPage = useCallback(() => {
    const next = computeFitToPageZoom(stageRef.current, layout.page.width, layout.page.height);
    if (next !== null) setZoom(next);
  }, [layout.page.height, layout.page.width, setZoom, stageRef]);

  const handleSaveAndClose = useCallback(() => {
    pendingCloseRef.current = true;
    void session.handleSaveCanvas().finally(() => {
      pendingCloseRef.current = false;
    });
  }, [session]);

  const workspaceStyle = {
    "--cv-left-w": prefs.leftOpen ? `${prefs.leftWidth}px` : "0px",
    "--cv-right-w": prefs.rightOpen ? `${prefs.rightWidth}px` : "0px",
  } as CSSProperties;

  return (
    <>
      <EditorShell
        canSave={!session.loading && !session.busy}
        onSave={() => void session.handleSaveCanvas()}
        onToggleLeftPanel={prefs.toggleLeftPanel}
      >
        <input ref={session.fileInputRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => void session.handleFileChange(e)} />
        <TopBar
          reportName={report.name}
          version={displayVersion}
          enabled={session.enabled}
          outputFormat={session.outputFormat}
          dirty={dirty}
          loading={session.loading}
          busy={session.busy}
          saveError={session.banner && session.banner.tone !== "ok" ? session.banner.text : null}
          canUndo={store.canUndo}
          canRedo={store.canRedo}
          undoLabel={store.undoLabel}
          redoLabel={store.redoLabel}
          onUndo={store.undo}
          onRedo={store.redo}
          zoom={zoom}
          onChangeZoom={setZoom}
          onFitToWidth={() => fitToWidth()}
          onFitToPage={handleFitToPage}
          problemCount={problems.count}
          problemSeverity={problems.highestSeverity}
          problems={problems.items}
          onOpenProblems={() => setProblemsPanelOpen((open) => !open)}
          onSelectProblem={(item) => {
            if (item.pageId) setActivePageId(item.pageId);
            if (item.blockId) {
              setSelectedBlockId(item.blockId);
              prefs.openRightPanel();
            }
          }}
          dataMode={showSampleData ? "sample" : "preview"}
          onChangeDataMode={(mode) => setShowSampleData(mode === "sample")}
          onChangeEnabled={session.setEnabled}
          onChangeOutputFormat={session.setOutputFormat}
          onOpenPreview={session.openPreviewDialog}
          onSave={() => void session.handleSaveCanvas()}
          onSaveAndClose={handleSaveAndClose}
          onClose={onClose}
        />
        {draftBanner && (
          <div className="cv-banner cv-banner-conflict" role="alert">
            <div className="cv-banner-main">
              <AlertTriangle size={15} aria-hidden="true" />
              <span className="cv-banner-text">{draftBanner.text}</span>
            </div>
            <div className="cv-banner-actions">
              <button
                type="button"
                className="cv-btn cv-btn-primary"
                onClick={draftBanner.onRestore}
              >
                Restaurar
              </button>
              <button
                type="button"
                className="cv-btn"
                onClick={draftBanner.onDiscard}
              >
                Descartar
              </button>
            </div>
          </div>
        )}
        <Banner
          banner={session.banner}
          disabled={session.loading || session.busy}
          currentVersion={displayVersion}
          onReload={() => void session.loadCanvas(true)}
          onDismiss={() => session.setBanner(null)}
        />
        {session.loading ? (
          <WorkspaceSkeleton />
        ) : (
          <div className="cv-workspace" style={workspaceStyle}>
            <LeftRail
              leftOpen={prefs.leftOpen}
              libraryTab={prefs.libraryTab}
              onSelectLibrary={prefs.selectLibrary}
              onOpenTab={prefs.openLeftPanel}
              onCloseLeftPanel={prefs.closeLeftPanel}
            >
              <BlockLibrary
                active={prefs.libraryTab === "components"}
                loading={session.loading}
                onAddComponent={(type) => handleAddBlockCentered(type)}
                onClosePanel={prefs.closeLeftPanel}
              />
              <PagesPanel
                active={prefs.libraryTab === "pages"}
                pages={layout.pages}
                activePage={activePage}
                pageConfig={layout.page}
                selectedBlockId={selectedBlockId}
                sources={layout.sources}
                assets={visibleAssets}
                blockProblems={problems.byBlockId}
                onSelectPage={selectPage}
                onSelectBlock={(blockId) => {
                  setSelectedBlockId(blockId);
                  prefs.openRightPanel();
                }}
                onAddCoverPage={actions.addCoverPage}
                onAddBlankPage={actions.addBlankPage}
                onDuplicatePage={handleDuplicatePage}
                onMovePage={actions.movePage}
                onDeletePage={actions.deletePage}
                onRenamePage={handleRenamePage}
                onRenameActivePage={actions.renameActivePage}
                onReorderBlock={handleReorderBlock}
                onUpdatePageConfig={actions.updatePageConfig}
                onClosePanel={prefs.closeLeftPanel}
              />
              <div className="cv-panel-slot" hidden={prefs.libraryTab !== "data"}>
                <DataPanel
                  active={prefs.libraryTab === "data"}
                  sources={layout.sources}
                  availableSources={session.availableSources}
                  layout={layout}
                  selectedBlock={selectedBlock}
                  reportId={report.id}
                  unit={unit}
                  onCreateSource={session.openCreateSourceModal}
                  onEditSource={session.openEditSourceModal}
                  onRemoveSource={session.removeSource}
                  onSelectBlock={setSelectedBlockId}
                  onUpdateBlock={actions.updateBlock}
                />
              </div>
              <ImagesPanel
                active={prefs.libraryTab === "images"}
                assets={visibleAssets}
                assetUrls={session.assetUrls}
                uploadingAsset={session.uploadingAsset}
                pages={layout.pages}
                selectedBlock={selectedBlock}
                onTriggerUpload={() => session.triggerImageUpload()}
                onInsertImageBlock={(assetId) => handleAddBlockCentered("image", assetId)}
                onUseInSelectedBlock={(assetId) => {
                  if (!selectedBlock || selectedBlock.type !== "image") return;
                  actions.updateBlock(selectedBlock.id, "Trocar imagem", (b) => ({
                    ...b,
                    asset_id: assetId,
                  }));
                }}
                onDeleteAsset={(assetId) =>
                  setHiddenAssetIds((prev) => (prev.includes(assetId) ? prev : [...prev, assetId]))
                }
                onClosePanel={prefs.closeLeftPanel}
              />
            </LeftRail>
            {prefs.leftOpen && (
              <PanelResizer
                side="left"
                width={prefs.leftWidth}
                onChangeWidth={prefs.updateLeftWidth}
              />
            )}
            <Stage
              stageRef={stageRef}
              pages={layout.pages}
              activePageId={activePageId}
              onSelectPage={selectPage}
              pageConfig={layout.page}
              blocks={activePage?.blocks || []}
              zoom={zoom}
              onChangeZoom={setZoom}
              showGrid={showGrid}
              selectedBlockId={selectedBlockId}
              draggingBlockId={dragState?.blockId || null}
              tempGeometries={activeDrag ? { [activeDrag.blockId]: activeDrag } : undefined}
              activeGuides={activeDrag?.guides}
              blockProblems={problems.byBlockId}
              onOpenProblem={() => setProblemsPanelOpen(true)}
              sources={layout.sources}
              assets={visibleAssets}
              assetUrls={session.assetUrls}
              availableSources={session.availableSources}
              localDatasets={localDatasets}
              reportName={report.name}
              showSampleData={showSampleData}
              onAddBlock={() => prefs.openLeftPanel("components")}
              onClearSelection={() => setSelectedBlockId(null)}
              onSelectBlock={setSelectedBlockId}
              onStartDrag={startBlockDrag}
              onStartResize={startBlockResize}
            />
            {prefs.rightOpen ? (
              <PanelResizer
                side="right"
                width={prefs.rightWidth}
                onChangeWidth={prefs.updateRightWidth}
              />
            ) : (
              <button
                type="button"
                className="cv-btn-icon cv-inspector-toggle-edge"
                aria-label="Abrir inspetor de propriedades"
                title="Abrir inspetor"
                onClick={prefs.openRightPanel}
              >
                <PanelRightOpen size={16} aria-hidden="true" />
              </button>
            )}
            <Inspector rightOpen={prefs.rightOpen} selectedBlock={selectedBlock} activePage={activePage} inspectorTab={inspectorTab} pageConfig={layout.page} sources={layout.sources} assets={visibleAssets} uploadingAsset={session.uploadingAsset} knownColumns={selectedKnownColumns} resolveKnownColumns={resolveKnownColumns} onSelectBlock={setSelectedBlockId} onChangeTab={setInspectorTab} onReorderLayer={actions.reorderBlockLayer} onDuplicateBlock={actions.duplicateSelectedBlock} onRemoveBlock={actions.removeBlock} onTriggerImageUpload={(blockId) => session.triggerImageUpload(blockId)} onOpenCreateSource={session.openCreateSourceModal} onColumnWidthsValidation={session.handleColumnWidthsValidation} onUpdateBlock={actions.updateBlock} />
          </div>
        )}
        <ProblemsPanel
          open={problemsPanelOpen}
          problems={problems.items}
          activePageId={activePageId}
          onClose={() => setProblemsPanelOpen(false)}
          onSelectProblem={(item) => {
            if (item.pageId) selectPage(item.pageId);
            if (item.blockId) {
              setSelectedBlockId(item.blockId);
              prefs.openRightPanel();
            }
          }}
          onFixProblem={(item) => {
            if (item.pageId) selectPage(item.pageId);
            if (item.blockId) {
              setSelectedBlockId(item.blockId);
              prefs.openRightPanel();
            }
          }}
        />
        <StatusBar
          dirty={dirty}
          saving={session.busy}
          version={displayVersion}
          hasSampleData={showSampleData}
          selectedBlock={selectedBlock}
          limits={limits}
        />
      </EditorShell>
      <SourceDialog
        sourceModal={session.sourceModal}
        availableSources={session.availableSources}
        reportId={report.id}
        unit={unit}
        currentReportParameters={report.parameter_schema}
        monthlyGoals={session.monthlyGoals}
        existingSources={layout.sources}
        onChange={session.setSourceModal}
        onClose={() => session.setSourceModal(null)}
        onSubmit={session.handleSaveSource}
      />
      <PreviewDialog
        previewModal={session.previewModal}
        reportName={report.name}
        previewFields={session.previewFields}
        onChange={session.setPreviewModal}
        onClose={session.closePreviewDialog}
        onSubmit={(e) => void session.handleRunPreview(e)}
        onSelectBlock={(bId) => {
          setSelectedBlockId(bId);
          prefs.openRightPanel();
        }}
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
