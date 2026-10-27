import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { RefreshCw } from "lucide-react";
import CanvasShell from "./CanvasShell";
import DataPanel from "./report-canvas/data/DataPanel";
import SourceDialog from "./report-canvas/data/SourceDialog";
import PreviewDialog from "./report-canvas/dialogs/PreviewDialog";
import { useCanvasSession } from "./report-canvas/hooks/useCanvasSession";
import { useFitZoom } from "./report-canvas/hooks/useFitZoom";
import { useKeyboardShortcuts } from "./report-canvas/hooks/useKeyboardShortcuts";
import { useLayoutActions } from "./report-canvas/hooks/useLayoutActions";
import { usePersistedPrefs } from "./report-canvas/hooks/usePersistedPrefs";
import type { InspectorTab } from "./report-canvas/inspector/BlockInspector";
import Inspector from "./report-canvas/inspector/Inspector";
import BlockLibrary from "./report-canvas/library/BlockLibrary";
import ImagesPanel from "./report-canvas/library/ImagesPanel";
import PagesPanel from "./report-canvas/library/PagesPanel";
import type { CanvasBlock, ReportCanvasProps } from "./report-canvas/model";
import Banner from "./report-canvas/shell/Banner";
import LeftRail from "./report-canvas/shell/LeftRail";
import StatusBar from "./report-canvas/shell/StatusBar";
import TopBar, { CanvasHeaderControls } from "./report-canvas/shell/TopBar";
import Stage from "./report-canvas/stage/Stage";
import { applyBlockUpdate } from "./report-canvas/stage/geometry";
import { usePointerDrag } from "./report-canvas/stage/usePointerDrag";
import { useCanvasStore } from "./report-canvas/state/canvasStore";
import {
  selectActivePage,
  selectKnownColumns,
  selectLocalDatasets,
  selectSelectedBlock,
} from "./report-canvas/state/selectors";
import "./report-canvas/tokens.css";
import "./report-canvas.css";
import "./canvas-studio.css";

export default function ReportCanvas({ unit, report, onClose, onSaved }: ReportCanvasProps) {
  const store = useCanvasStore();
  const { layout } = store;

  const [activePageId, setActivePageId] = useState("p1");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [showSampleData, setShowSampleData] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("content");

  const prefs = usePersistedPrefs();
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

  const session = useCanvasSession({
    unit,
    report,
    onSaved,
    store,
    activePage,
    selectedBlock,
    selectedBlockId,
    setActivePageId,
    setSelectedBlockId,
    onFitToWidthAfterLoad: (w) => fitRef.current(w),
    onUpdateBlock: updateBlockBase,
  });

  const { zoom, setZoom, stageRef, fitToWidth } = useFitZoom({
    loading: session.loading,
    pageWidth: layout.page.width,
    leftOpen: prefs.leftOpen,
    rightOpen: prefs.rightOpen,
    leftWidth: prefs.leftWidth,
    rightWidth: prefs.rightWidth,
  });
  fitRef.current = fitToWidth;

  const actions = useLayoutActions({
    store,
    activePage,
    activePageId,
    selectedBlock,
    assets: session.assets,
    availableSources: session.availableSources,
    setActivePageId,
    setSelectedBlockId,
    setBanner: session.setBanner,
  });

  const dirty = store.dirty || session.metaDirty;
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

  const { dragState, startBlockDrag, startBlockResize } = usePointerDrag({
    zoom,
    pageWidth: layout.page.width,
    pageHeight: layout.page.height,
    onSelectBlock: setSelectedBlockId,
    onApplyBlockDrag: (id, label, key, upd) => actions.updateBlock(id, label, upd, key),
  });

  useKeyboardShortcuts({
    selectedBlockId,
    modalOpen: Boolean(session.sourceModal || session.previewModal),
    onDeleteBlock: actions.removeBlock,
    onNudgeBlock: actions.nudgeBlock,
    onUndo: store.undo,
    onRedo: store.redo,
  });

  const workspaceStyle = {
    "--rc-left-w": prefs.leftOpen ? `${prefs.leftWidth}px` : "0px",
    "--rc-right-w": prefs.rightOpen ? `${prefs.rightWidth}px` : "0px",
  } as CSSProperties;

  return (
    <>
      <CanvasShell
        title={report.name}
        busy={session.busy}
        onClose={() => (!dirty || window.confirm("Sair sem salvar as alterações?")) && onClose()}
        footer={
          <CanvasHeaderControls
            enabled={session.enabled}
            outputFormat={session.outputFormat}
            dirty={dirty}
            loading={session.loading}
            busy={session.busy}
            showSampleData={showSampleData}
            onChangeEnabled={session.setEnabled}
            onChangeOutputFormat={session.setOutputFormat}
            onChangeShowSampleData={setShowSampleData}
            onOpenPreview={session.openPreviewDialog}
            onSave={() => void session.handleSaveCanvas()}
          />
        }
      >
        <input ref={session.fileInputRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => void session.handleFileChange(e)} />
        <TopBar
          pages={layout.pages}
          activePageId={activePageId}
          pageConfig={layout.page}
          loading={session.loading}
          busy={session.busy}
          showGrid={showGrid}
          zoom={zoom}
          rightOpen={prefs.rightOpen}
          leftWidth={prefs.leftWidth}
          rightWidth={prefs.rightWidth}
          onSelectPage={selectPage}
          onUpdatePageConfig={(patch) => actions.updatePageConfig(patch)}
          onToggleGrid={() => setShowGrid((v) => !v)}
          onChangeZoom={setZoom}
          onFitToWidth={() => fitToWidth()}
          onReload={() => void session.loadCanvas(true)}
          onToggleRightPanel={prefs.toggleRightPanel}
          onChangeLeftWidth={prefs.updateLeftWidth}
          onChangeRightWidth={prefs.updateRightWidth}
        />
        <Banner banner={session.banner} disabled={session.loading || session.busy} onReload={() => void session.loadCanvas(true)} onDismiss={() => session.setBanner(null)} />
        {session.loading ? (
          <div className="rc-loading" role="status"><RefreshCw size={16} />Carregando estrutura do Canvas…</div>
        ) : (
          <div className="rc-workspace" style={workspaceStyle}>
            <LeftRail leftOpen={prefs.leftOpen} libraryTab={prefs.libraryTab} onSelectLibrary={prefs.selectLibrary} onCloseLeftPanel={prefs.closeLeftPanel}>
              <BlockLibrary active={prefs.libraryTab === "components"} loading={session.loading} onAddComponent={(type) => { actions.addBlock(type); setInspectorTab("content"); prefs.openRightPanel(); }} />
              <PagesPanel active={prefs.libraryTab === "pages"} pages={layout.pages} activePage={activePage} pageConfig={layout.page} onSelectPage={selectPage} onAddCoverPage={actions.addCoverPage} onAddBlankPage={actions.addBlankPage} onMovePage={actions.movePage} onDeletePage={actions.deletePage} onRenameActivePage={actions.renameActivePage} onUpdatePageConfig={actions.updatePageConfig} />
              <DataPanel active={prefs.libraryTab === "data"} sources={layout.sources} availableSources={session.availableSources} onCreateSource={session.openCreateSourceModal} onEditSource={session.openEditSourceModal} onRemoveSource={session.removeSource} />
              <ImagesPanel active={prefs.libraryTab === "images"} assets={session.assets} assetUrls={session.assetUrls} uploadingAsset={session.uploadingAsset} onTriggerUpload={() => session.triggerImageUpload()} onInsertImageBlock={(assetId) => actions.addBlock("image", assetId)} />
            </LeftRail>
            <Stage stageRef={stageRef} pageConfig={layout.page} blocks={activePage?.blocks || []} zoom={zoom} showGrid={showGrid} selectedBlockId={selectedBlockId} draggingBlockId={dragState?.blockId || null} sources={layout.sources} assets={session.assets} assetUrls={session.assetUrls} availableSources={session.availableSources} localDatasets={localDatasets} reportName={report.name} showSampleData={showSampleData} onClearSelection={() => setSelectedBlockId(null)} onSelectBlock={setSelectedBlockId} onStartDrag={startBlockDrag} onStartResize={startBlockResize} />
            <Inspector rightOpen={prefs.rightOpen} selectedBlock={selectedBlock} activePage={activePage} inspectorTab={inspectorTab} pageConfig={layout.page} sources={layout.sources} assets={session.assets} uploadingAsset={session.uploadingAsset} knownColumns={selectedKnownColumns} resolveKnownColumns={resolveKnownColumns} onSelectBlock={setSelectedBlockId} onChangeTab={setInspectorTab} onReorderLayer={actions.reorderBlockLayer} onDuplicateBlock={actions.duplicateSelectedBlock} onRemoveBlock={actions.removeBlock} onTriggerImageUpload={(blockId) => session.triggerImageUpload(blockId)} onOpenCreateSource={session.openCreateSourceModal} onColumnWidthsValidation={session.handleColumnWidthsValidation} onUpdateBlock={actions.updateBlock} />
          </div>
        )}
        <StatusBar />
      </CanvasShell>
      <SourceDialog sourceModal={session.sourceModal} availableSources={session.availableSources} onChange={session.setSourceModal} onClose={() => session.setSourceModal(null)} onSubmit={session.handleSaveSource} />
      <PreviewDialog previewModal={session.previewModal} reportName={report.name} previewFields={session.previewFields} onChange={session.setPreviewModal} onClose={session.closePreviewDialog} onSubmit={(e) => void session.handleRunPreview(e)} />
    </>
  );
}
