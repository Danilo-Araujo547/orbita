import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { CanvasSaveError, useCanvasApi, validateAssetFile } from "../api/useCanvasApi";
import {
  applyRemovedSourceToLayout,
  applySavedSourceToLayout,
  createSourceModalState,
  editSourceModalState,
  parseSourceModalState,
} from "../data/sourceOps";
import { usePreviewDialog } from "../dialogs/usePreviewDialog";
import type {
  CanvasAssetMeta,
  CanvasBlock,
  CanvasLayout,
  CanvasPage,
  CanvasSource,
  CatalogSqlSource,
  OutputFormat,
  ReportCanvasProps,
  SourceDialogState,
} from "../model";
import type { BannerMessage } from "../shell/Banner";
import { validateLayoutBeforeSend } from "../stage/geometry";
import type { CanvasStore } from "../state/canvasStore";
import { useAssetUrls } from "./useAssetUrls";

export interface UseCanvasSessionParams {
  unit: string;
  report: ReportCanvasProps["report"];
  onSaved?: () => void;
  store: CanvasStore;
  activePage: CanvasPage | undefined;
  selectedBlock: CanvasBlock | null;
  selectedBlockId: string | null;
  setActivePageId: (id: string) => void;
  setSelectedBlockId: (id: string | null) => void;
  onFitToWidthAfterLoad: (targetPageWidth?: number) => void;
  onUpdateBlock: (
    blockId: string,
    label: string,
    updater: (b: CanvasBlock) => CanvasBlock,
  ) => void;
}

export function useCanvasSession({
  unit,
  report,
  onSaved,
  store,
  activePage,
  selectedBlock,
  selectedBlockId,
  setActivePageId,
  setSelectedBlockId,
  onFitToWidthAfterLoad,
  onUpdateBlock,
}: UseCanvasSessionParams) {
  const api = useCanvasApi({ reportId: report.id, unit });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [version, setVersion] = useState<number>(report.version || 1);
  const initialOutputFormat: OutputFormat = report.output_format === "xlsx" ? "xlsx" : "pdf";
  const [enabled, setEnabled] = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(initialOutputFormat);
  const [savedMeta, setSavedMeta] = useState<{ enabled: boolean; outputFormat: OutputFormat }>({
    enabled: false,
    outputFormat: initialOutputFormat,
  });
  const [monthlyGoals, setMonthlyGoals] = useState<
    Array<{ year: number; month: number; value: number }>
  >(Array.isArray(report.monthly_goals) ? report.monthly_goals : []);
  const [availableSources, setAvailableSources] = useState<CatalogSqlSource[]>([]);
  const [assets, setAssets] = useState<CanvasAssetMeta[]>([]);
  const [banner, setBanner] = useState<BannerMessage | null>(null);
  const [sourceModal, setSourceModal] = useState<SourceDialogState | null>(null);

  const assetState = useAssetUrls({
    reportId: report.id,
    unit,
    assets,
    pages: store.layout.pages,
  });

  const columnWidthsErrorRef = useRef<string | null>(null);
  const pendingAssetBlockIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialVersionRef = useRef(report.version || 1);
  initialVersionRef.current = report.version || 1;
  const fitRef = useRef(onFitToWidthAfterLoad);
  fitRef.current = onFitToWidthAfterLoad;

  const loadCanvas = useCallback(
    async (isReload = false) => {
      setLoading(true);
      setBanner(null);
      try {
        const { data, normalizedLayout } = await api.fetchCanvas();
        if (data.port_notice) setBanner({ tone: "conflict", text: data.port_notice });
        const nextEnabled = Boolean(data.enabled);
        const nextFormat: OutputFormat = data.output_format === "xlsx" ? "xlsx" : "pdf";
        setVersion(typeof data.version === "number" ? data.version : initialVersionRef.current);
        store.replace(normalizedLayout);
        setEnabled(nextEnabled);
        setOutputFormat(nextFormat);
        setSavedMeta({ enabled: nextEnabled, outputFormat: nextFormat });
        if (Array.isArray(data.monthly_goals)) setMonthlyGoals(data.monthly_goals);
        setAvailableSources(Array.isArray(data.sources) ? data.sources : []);
        const incomingAssets = Array.isArray(data.assets) ? data.assets : [];
        setAssets(incomingAssets);
        assetState.registerAssetsBatch(incomingAssets);
        setActivePageId(normalizedLayout.pages[0]?.id || "p1");
        setSelectedBlockId(null);
        columnWidthsErrorRef.current = null;
        if (isReload) {
          setBanner({ tone: "ok", text: "Canvas recarregado com a versão atual." });
        }
        requestAnimationFrame(() => fitRef.current(normalizedLayout.page.width));
      } catch (e) {
        setBanner({ tone: "error", text: (e as Error).message });
      } finally {
        setLoading(false);
      }
    },
    [api, assetState.registerAssetsBatch, setActivePageId, setSelectedBlockId, store.replace],
  );

  useEffect(() => {
    void loadCanvas(false);
  }, [loadCanvas]);

  const validateBeforeSend = useCallback(
    (requireAtLeastOneBlock: boolean): CanvasLayout | null => {
      const check = validateLayoutBeforeSend(store.layout, requireAtLeastOneBlock);
      if (!check.ok) {
        if (check.pageId) setActivePageId(check.pageId);
        if (check.blockId) setSelectedBlockId(check.blockId);
        setBanner({ tone: "error", text: check.error });
        return null;
      }
      return check.layout;
    },
    [store.layout, setActivePageId, setSelectedBlockId],
  );

  const handleSaveCanvas = useCallback(async () => {
    if (columnWidthsErrorRef.current && columnWidthsErrorRef.current === selectedBlockId) {
      setBanner({ tone: "error", text: "Corrija as larguras das colunas antes de salvar." });
      return;
    }
    const clean = validateBeforeSend(enabled);
    if (!clean) return;
    setBusy(true);
    setBanner(null);
    try {
      const { saved, normalizedLayout } = await api.saveCanvas({
        version,
        layout: clean,
        enabled,
        outputFormat,
      });
      const savedEnabled = Boolean(saved.enabled);
      const savedFormat: OutputFormat = saved.output_format === "xlsx" ? "xlsx" : "pdf";
      setVersion(typeof saved.version === "number" ? saved.version : version + 1);
      store.markSaved(normalizedLayout);
      setEnabled(savedEnabled);
      setOutputFormat(savedFormat);
      setSavedMeta({ enabled: savedEnabled, outputFormat: savedFormat });
      if (Array.isArray(saved.monthly_goals)) setMonthlyGoals(saved.monthly_goals);
      if (Array.isArray(saved.sources)) setAvailableSources(saved.sources);
      if (Array.isArray(saved.assets)) {
        setAssets(saved.assets);
        assetState.registerAssetsBatch(saved.assets);
      }
      setBanner({
        tone: "ok",
        text: savedEnabled ? "Canvas salvo e ativado para este relatório." : "Rascunho salvo.",
      });
      onSaved?.();
    } catch (e) {
      const isConflict = e instanceof CanvasSaveError && e.isConflict;
      setBanner({
        tone: isConflict ? "conflict" : "error",
        text: (e as Error).message || "Falha ao salvar o Canvas.",
      });
    } finally {
      setBusy(false);
    }
  }, [
    api,
    assetState.registerAssetsBatch,
    enabled,
    onSaved,
    outputFormat,
    selectedBlockId,
    store.markSaved,
    validateBeforeSend,
    version,
  ]);

  const preview = usePreviewDialog({
    parameterSchema: report.parameter_schema,
    outputFormat,
    validateBeforeSend,
    previewCanvas: api.previewCanvas,
    trackDownloadUrl: assetState.trackDownloadUrl,
    revokeDownloadUrl: assetState.revokeDownloadUrl,
  });

  const triggerImageUpload = useCallback((forBlockId?: string) => {
    pendingAssetBlockIdRef.current = forBlockId || null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }, []);

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const fileErr = validateAssetFile(file);
      if (fileErr) {
        setBanner({ tone: "error", text: fileErr });
        return;
      }
      setUploadingAsset(true);
      setBanner(null);
      try {
        const { created, fallbackBase64, fallbackMime } = await api.uploadAsset(file);
        setAssets((prev) => [created, ...prev.filter((a) => a.id !== created.id)]);
        assetState.registerAssetBlob(
          created.id,
          created.content || fallbackBase64,
          created.filename || file.name,
          created.mime || fallbackMime,
        );
        const targetBlock = pendingAssetBlockIdRef.current;
        if (targetBlock) {
          onUpdateBlock(targetBlock, "Vincular imagem ao bloco", (b) => ({
            ...b,
            asset_id: created.id,
          }));
        } else if (selectedBlock?.type === "image" && !selectedBlock.asset_id) {
          onUpdateBlock(selectedBlock.id, "Vincular imagem ao bloco", (b) => ({
            ...b,
            asset_id: created.id,
          }));
        }
        setBanner({ tone: "ok", text: `Imagem enviada: ${created.filename}` });
      } catch (err) {
        setBanner({ tone: "error", text: (err as Error).message });
      } finally {
        pendingAssetBlockIdRef.current = null;
        setUploadingAsset(false);
      }
    },
    [api, assetState.registerAssetBlob, onUpdateBlock, selectedBlock],
  );

  const openCreateSourceModal = useCallback(() => {
    const res = createSourceModalState(store.layout.sources, availableSources);
    if (!res.ok) return setBanner({ tone: "error", text: res.error });
    setSourceModal(res.state);
  }, [availableSources, store.layout.sources]);

  const openEditSourceModal = useCallback(
    (src: CanvasSource) => setSourceModal(editSourceModalState(src, availableSources)),
    [availableSources],
  );

  const handleSaveSource = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!sourceModal) return;
      const parsed = parseSourceModalState(sourceModal, store.layout.sources, availableSources);
      if (!parsed.ok) return setSourceModal({ ...sourceModal, error: parsed.error });
      const autoBind =
        selectedBlock &&
        selectedBlock.type !== "text" &&
        selectedBlock.type !== "image" &&
        !selectedBlock.source_id &&
        activePage
          ? { pageId: activePage.id, blockId: selectedBlock.id }
          : null;
      store.apply(
        sourceModal.mode === "edit" ? "Editar fonte de dados" : "Adicionar fonte de dados",
        (prev) => applySavedSourceToLayout(prev, sourceModal, parsed.source, autoBind),
      );
      setSourceModal(null);
    },
    [activePage, availableSources, selectedBlock, sourceModal, store],
  );

  const removeSource = useCallback(
    (sourceId: string) =>
      store.apply("Remover fonte de dados", (prev) => applyRemovedSourceToLayout(prev, sourceId)),
    [store],
  );

  const handleColumnWidthsValidation = useCallback(
    (blockId: string | null, errorMessage?: string) => {
      columnWidthsErrorRef.current = blockId;
      if (blockId && errorMessage) setBanner({ tone: "error", text: errorMessage });
    },
    [],
  );

  return {
    loading,
    busy,
    uploadingAsset,
    enabled,
    setEnabled,
    outputFormat,
    setOutputFormat,
    metaDirty: enabled !== savedMeta.enabled || outputFormat !== savedMeta.outputFormat,
    monthlyGoals,
    availableSources,
    assets,
    assetUrls: assetState.assetUrls,
    banner,
    setBanner,
    sourceModal,
    setSourceModal,
    ...preview,
    fileInputRef,
    loadCanvas,
    handleSaveCanvas,
    triggerImageUpload,
    handleFileChange,
    openCreateSourceModal,
    openEditSourceModal,
    handleSaveSource,
    removeSource,
    handleColumnWidthsValidation,
  };
}
