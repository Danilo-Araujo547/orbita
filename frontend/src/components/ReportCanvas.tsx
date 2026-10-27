import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
import type { CanvasBlock, ReportCanvasProps } from "./report-canvas/model";
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
import "./report-canvas/layout.css";
import "./report-canvas/shell.css";
import "./report-canvas/data.css";

export default function ReportCanvas({ unit, report, onClose, onSaved }: ReportCanvasProps) {
  const store = useCanvasStore();
  const { layout } = store;

  const [activePageId, setActivePageId] = useState("p1");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showGrid] = useState(false);
  const [showSampleData, setShowSampleData] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("content");
  const [displayVersion, setDisplayVersion] = useState<number>(report.version || 1);
  const pendingCloseRef = useRef(false);

  useEffect(() => {
    setDisplayVersion(report.version || 1);
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
    setDisplayVersion((v) => v + 1);
    onSaved?.();
    if (pendingCloseRef.current) {
      pendingCloseRef.current = false;
      onClose();
    }
  }, [onClose, onSaved]);

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

  const problems = useMemo(
    () =>
      computeCanvasProblems({
        layout,
        enabled: session.enabled,
        availableSources: session.availableSources,
      }),
    [layout, session.availableSources, session.enabled],
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
    "--rc-left-w": prefs.leftOpen ? `${prefs.leftWidth}px` : "0px",
    "--rc-right-w": prefs.rightOpen ? `${prefs.rightWidth}px` : "0px",
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
        <Banner banner={session.banner} disabled={session.loading || session.busy} onReload={() => void session.loadCanvas(true)} onDismiss={() => session.setBanner(null)} />
        {session.loading ? (
          <WorkspaceSkeleton />
        ) : (
          <div className="rc-workspace" style={workspaceStyle}>
            <LeftRail leftOpen={prefs.leftOpen} libraryTab={prefs.libraryTab} onSelectLibrary={prefs.selectLibrary} onCloseLeftPanel={prefs.closeLeftPanel}>
              <BlockLibrary active={prefs.libraryTab === "components"} loading={session.loading} onAddComponent={(type) => { actions.addBlock(type); setInspectorTab("content"); prefs.openRightPanel(); }} />
              <PagesPanel active={prefs.libraryTab === "pages"} pages={layout.pages} activePage={activePage} pageConfig={layout.page} onSelectPage={selectPage} onAddCoverPage={actions.addCoverPage} onAddBlankPage={actions.addBlankPage} onMovePage={actions.movePage} onDeletePage={actions.deletePage} onRenameActivePage={actions.renameActivePage} onUpdatePageConfig={actions.updatePageConfig} />
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
              <ImagesPanel active={prefs.libraryTab === "images"} assets={session.assets} assetUrls={session.assetUrls} uploadingAsset={session.uploadingAsset} onTriggerUpload={() => session.triggerImageUpload()} onInsertImageBlock={(assetId) => actions.addBlock("image", assetId)} />
            </LeftRail>
            {prefs.leftOpen && (
              <PanelResizer
                side="left"
                width={prefs.leftWidth}
                onChangeWidth={prefs.updateLeftWidth}
              />
            )}
            <Stage stageRef={stageRef} pageConfig={layout.page} blocks={activePage?.blocks || []} zoom={zoom} showGrid={showGrid} selectedBlockId={selectedBlockId} draggingBlockId={dragState?.blockId || null} sources={layout.sources} assets={session.assets} assetUrls={session.assetUrls} availableSources={session.availableSources} localDatasets={localDatasets} reportName={report.name} showSampleData={showSampleData} onClearSelection={() => setSelectedBlockId(null)} onSelectBlock={setSelectedBlockId} onStartDrag={startBlockDrag} onStartResize={startBlockResize} />
            {prefs.rightOpen && (
              <PanelResizer
                side="right"
                width={prefs.rightWidth}
                onChangeWidth={prefs.updateRightWidth}
              />
            )}
            <Inspector rightOpen={prefs.rightOpen} selectedBlock={selectedBlock} activePage={activePage} inspectorTab={inspectorTab} pageConfig={layout.page} sources={layout.sources} assets={session.assets} uploadingAsset={session.uploadingAsset} knownColumns={selectedKnownColumns} resolveKnownColumns={resolveKnownColumns} onSelectBlock={setSelectedBlockId} onChangeTab={setInspectorTab} onReorderLayer={actions.reorderBlockLayer} onDuplicateBlock={actions.duplicateSelectedBlock} onRemoveBlock={actions.removeBlock} onTriggerImageUpload={(blockId) => session.triggerImageUpload(blockId)} onOpenCreateSource={session.openCreateSourceModal} onColumnWidthsValidation={session.handleColumnWidthsValidation} onUpdateBlock={actions.updateBlock} />
          </div>
        )}
        <StatusBar />
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
      <PreviewDialog previewModal={session.previewModal} reportName={report.name} previewFields={session.previewFields} onChange={session.setPreviewModal} onClose={session.closePreviewDialog} onSubmit={(e) => void session.handleRunPreview(e)} />
    </>
  );
}
