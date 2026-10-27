import {sourceColumns} from "./report-canvas/sampleData";
import Select from "./Select";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  Blocks,
  Files,
  Database,
  SlidersHorizontal,
  PanelLeftClose,
  Search,
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  Check,
  Copy,
  Download,
  Edit3,
  Eye,
  Grid,
  Hash,
  Image as ImageIcon,
  Layers,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  Plus,
  RefreshCw,
  Save,
  Scan,
  Table2,
  Trash2,
  Type,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import CanvasShell from "./CanvasShell";
import {testParameters, displayParameter, collectTestParameters} from "./report-canvas/parameters";
import InlineDialog from "./InlineDialog";
import BlockPreview from "./report-canvas/BlockPreview";
import { query, request } from "../api";
import "./report-canvas/tokens.css";
import "./report-canvas.css";
import "./canvas-studio.css";

import type { BlockType, AggregateMode, OutputFormat, BlockOptions, CanvasBlock, CanvasPage, CanvasSource, CanvasPageConfig, CanvasLayout, CatalogSqlSource, CanvasAssetMeta, CanvasGetResponse, CanvasPreviewResponse, ReportCanvasProps, SourceDialogState, DragSession } from "./report-canvas/model";
import { IDENT_RE, HEX_COLOR_RE, UUID_RE, MAX_ASSET_BYTES, SWATCH_COLORS, BLOCK_LABELS, DEFAULT_SIZES, clamp, round2, validColor, isDarkHex, makeId, createDefaultLayout, clampBlockToPage, normalizeLayout, sanitizeLayoutForApi, inferImageMime, base64ToBlob, isParameterBinding } from "./report-canvas/model";

function readPreference(key:string,fallback:string) {try{return localStorage.getItem(`scv.canvas.${key}`) ?? fallback;}catch{return fallback;}}
function writePreference(key:string,value:string|number|boolean) {try{localStorage.setItem(`scv.canvas.${key}`,String(value));}catch{/* Editor remains usable without storage. */}}

export default function ReportCanvas({ unit, report, onClose, onSaved }: ReportCanvasProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const columnWidthsError = useRef<string | null>(null);
  const [uploadingAsset, setUploadingAsset] = useState(false);

  const [version, setVersion] = useState<number>(report.version || 1);
  const [layout, setLayout] = useState<CanvasLayout>(() => createDefaultLayout());
  const [enabled, setEnabled] = useState(false);
  const [monthlyGoals, setMonthlyGoals] = useState<Array<{year:number;month:number;value:number}>>(Array.isArray(report.monthly_goals) ? report.monthly_goals : []);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(
    report.output_format === "xlsx" ? "xlsx" : "pdf",
  );
  const [availableSources, setAvailableSources] = useState<CatalogSqlSource[]>([]);
  const [assets, setAssets] = useState<CanvasAssetMeta[]>([]);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});

  const [activePageId, setActivePageId] = useState("p1");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [showSampleData,setShowSampleData]=useState(true);
  const [zoom, setZoom] = useState(0.85);
  const [leftOpen,setLeftOpen]=useState(()=>readPreference("left","true")!=="false");
  const [rightOpen,setRightOpen]=useState(()=>readPreference("right","true")!=="false");
  const [leftWidth,setLeftWidth]=useState(()=>clamp(Number(readPreference("leftWidth","224")) || 224,200,360));
  const [rightWidth,setRightWidth]=useState(()=>clamp(Number(readPreference("rightWidth","280")) || 280,240,420));
  const [dirty, setDirty] = useState(false);
  const [libraryTab,setLibraryTab]=useState<"components"|"pages"|"data"|"images">("components");
  const [componentSearch,setComponentSearch]=useState("");
  const inspectorId=useId();
  const [inspectorTab,setInspectorTab]=useState<"content"|"appearance">("content");
  const componentIcons={text:Type,kpi:Hash,table:Table2,bar:BarChart3,line:LineChartIcon,pie:PieChartIcon,image:ImageIcon};
  const componentNames={text:"Texto",kpi:"Indicador",table:"Tabela",bar:"Barras",line:"Linhas",pie:"Pizza",image:"Imagem"};
  function matchesComponent(type:BlockType){
    const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
    return normalize(`${componentNames[type]} ${BLOCK_LABELS[type]} ${["bar","line","pie"].includes(type)?"Gráfico":""}`).includes(normalize(componentSearch));
  }
  function selectLibrary(tab:typeof libraryTab){
    if(leftOpen && libraryTab===tab){setLeftOpen(false);writePreference("left",false);}
    else{setLibraryTab(tab);setLeftOpen(true);writePreference("left",true);}
  }

  const [banner, setBanner] = useState<{
    tone: "error" | "conflict" | "ok";
    text: string;
  } | null>(null);

  const [sourceModal, setSourceModal] = useState<SourceDialogState | null>(null);
  const [previewModal, setPreviewModal] = useState<{
    format: OutputFormat;
    values: Record<string,string>;
    resultUrl?: string;
    resultName?: string;
    resultFormat?: string;
    busy: boolean;
    error: string;
    info: string;
  } | null>(null);

  const previewFields = useMemo(() => testParameters(report.parameter_schema || {}), [report.parameter_schema]);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAssetBlockIdRef = useRef<string | null>(null);
  const objectUrlsRef = useRef<Map<string, string>>(new Map());
  const downloadUrlsRef = useRef<Set<string>>(new Set());
  const fetchingAssetsRef = useRef<Set<string>>(new Set());
  const [dragState, setDragState] = useState<DragSession | null>(null);

  const sourceFormId = useId();
  const previewFormId = useId();

  const registerAssetBlob = useCallback((assetId: string, b64: string, filename: string, mime?: string) => {
    try {
      const blob = base64ToBlob(b64, inferImageMime(filename, b64, mime));
      const nextUrl = URL.createObjectURL(blob);
      const prevUrl = objectUrlsRef.current.get(assetId);
      if (prevUrl) URL.revokeObjectURL(prevUrl);
      objectUrlsRef.current.set(assetId, nextUrl);
      setAssetUrls((curr) => ({ ...curr, [assetId]: nextUrl }));
    } catch {
      // Ignore malformed base64 preview without crashing editor
    }
  }, []);

  // Cleanup all Blob objectURLs on unmount
  useEffect(() => {
    const assetMap = objectUrlsRef.current;
    const dlSet = downloadUrlsRef.current;
    return () => {
      for (const url of assetMap.values()) URL.revokeObjectURL(url);
      assetMap.clear();
      for (const url of dlSet.values()) URL.revokeObjectURL(url);
      dlSet.clear();
    };
  }, []);

  const pageWidthRef = useRef(layout.page.width);
  pageWidthRef.current = layout.page.width;
  const initialVersionRef = useRef(report.version || 1);
  initialVersionRef.current = report.version || 1;

  const fitToWidth = useCallback((targetPageWidth?: number) => {
    const el = stageRef.current;
    if (!el) return;
    const pw = targetPageWidth ?? pageWidthRef.current;
    const available = Math.max(200, el.clientWidth - 64);
    const computed = clamp(Math.floor((available / pw) * 100) / 100, 0.25, 1.5);
    setZoom(computed);
  }, []);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(() => fitToWidth());
    return () => cancelAnimationFrame(frame);
  }, [loading, leftOpen, rightOpen, leftWidth, rightWidth, fitToWidth]);

  useEffect(() => {
    const stage=stageRef.current;
    if (loading || !stage) return;
    let lastWidth=stage.clientWidth;
    const observer=new ResizeObserver(entries=>{
      const width=entries[0]?.contentRect.width ?? stage.clientWidth;
      if(Math.abs(width-lastWidth)>1){lastWidth=width;fitToWidth();}
    });
    observer.observe(stage);
    return ()=>observer.disconnect();
  },[loading,fitToWidth]);

  const loadCanvas = useCallback(
    async (isReload = false) => {
      setLoading(true);
      setBanner(null);
      try {
        const data = await request<CanvasGetResponse>(
          query(`reports/${report.id}/canvas`, { unit }),
        );
        const normalized = normalizeLayout(data.layout);
        if (data.port_notice) setBanner({tone:"conflict",text:data.port_notice});
        setVersion(
          typeof data.version === "number" ? data.version : initialVersionRef.current,
        );
        setLayout(normalized);
        setEnabled(Boolean(data.enabled));
        if (Array.isArray(data.monthly_goals)) setMonthlyGoals(data.monthly_goals);
        setOutputFormat(data.output_format === "xlsx" ? "xlsx" : "pdf");
        setAvailableSources(Array.isArray(data.sources) ? data.sources : []);
        const incomingAssets = Array.isArray(data.assets) ? data.assets : [];
        setAssets(incomingAssets);
        for (const a of incomingAssets) {
          if (a.content) {
            registerAssetBlob(a.id, a.content, a.filename, a.mime);
          }
        }
        setActivePageId(normalized.pages[0]?.id || "p1");
        setSelectedBlockId(null);
        setDirty(false);
        if (isReload) {
          setBanner({ tone: "ok", text: "Canvas recarregado com a versão atual." });
        }
        requestAnimationFrame(() => fitToWidth(normalized.page.width));
      } catch (e) {
        setBanner({ tone: "error", text: (e as Error).message });
      } finally {
        setLoading(false);
      }
    },
    [report.id, unit, registerAssetBlob, fitToWidth],
  );

  useEffect(() => {
    void loadCanvas(false);
  }, [loadCanvas]);

  // Lazy-fetch report-scoped asset content for thumbnails and canvas image blocks
  useEffect(() => {
    let alive = true;
    const knownIds = new Set(assets.map((a) => a.id));
    for (const p of layout.pages) {
      for (const b of p.blocks) {
        if (b.type === "image" && b.asset_id && UUID_RE.test(b.asset_id)) {
          knownIds.add(b.asset_id);
        }
      }
    }
    for (const assetId of knownIds) {
      if (objectUrlsRef.current.has(assetId) || fetchingAssetsRef.current.has(assetId)) {
        continue;
      }
      fetchingAssetsRef.current.add(assetId);
      request<CanvasAssetMeta>(
        query(`reports/${report.id}/canvas-assets`, { unit, asset_id: assetId }),
      )
        .then((res) => {
          if (alive && res?.content) {
            registerAssetBlob(res.id || assetId, res.content, res.filename || "asset.png", res.mime);
          }
        })
        .catch(() => {
          // Asset fetch error handled gracefully on block placeholder
        })
        .finally(() => {
          fetchingAssetsRef.current.delete(assetId);
        });
    }
    return () => {
      alive = false;
    };
  }, [assets, layout.pages, report.id, unit, registerAssetBlob]);

  const activePage = useMemo(
    () => layout.pages.find((p) => p.id === activePageId) || layout.pages[0],
    [layout.pages, activePageId],
  );

  const selectedBlock = useMemo(
    () => activePage?.blocks.find((b) => b.id === selectedBlockId) || null,
    [activePage, selectedBlockId],
  );

  const allBlockIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of layout.pages) {
      for (const b of p.blocks) s.add(b.id);
    }
    return s;
  }, [layout.pages]);

  const mutateLayout = useCallback((updater: (prev: CanvasLayout) => CanvasLayout) => {
    setLayout((prev) => updater(prev));
    setDirty(true);
  }, []);

  const updatePageConfig = useCallback(
    (patch: Partial<CanvasPageConfig>) => {
      mutateLayout((prev) => {
        const nextWidth =
          patch.width !== undefined ? round2(clamp(patch.width, 150, 3000)) : prev.page.width;
        const nextHeight =
          patch.height !== undefined ? round2(clamp(patch.height, 150, 3000)) : prev.page.height;
        const nextColumns =
          patch.columns !== undefined
            ? Math.round(clamp(patch.columns, 1, 48))
            : prev.page.columns;
        const nextBg =
          patch.background !== undefined
            ? validColor(patch.background, prev.page.background)
            : prev.page.background;
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
      });
    },
    [mutateLayout],
  );

  const updateBlock = useCallback(
    (blockId: string, updater: (b: CanvasBlock) => CanvasBlock) => {
      mutateLayout((prev) => ({
        ...prev,
        pages: prev.pages.map((p) =>
          p.id !== activePage.id
            ? p
            : {
                ...p,
                blocks: p.blocks.map((b) =>
                  b.id === blockId
                    ? clampBlockToPage(updater(b), prev.page.width, prev.page.height)
                    : b,
                ),
              },
        ),
      }));
    },
    [activePage?.id, mutateLayout],
  );

  const removeBlock = useCallback(
    (blockId: string) => {
      mutateLayout((prev) => ({
        ...prev,
        pages: prev.pages.map((p) => ({
          ...p,
          blocks: p.blocks.filter((b) => b.id !== blockId),
        })),
      }));
      setSelectedBlockId((curr) => (curr === blockId ? null : curr));
    },
    [mutateLayout],
  );

  const resolveKnownColumns = useCallback(
    (sourceId?: string): string[] => {
      if (!sourceId) return [];
      const src = layout.sources.find((s) => s.id === sourceId);
      if (!src) return [];
      const cat = src.type === "report" ? availableSources.find((c) => c.id === src.report_id) : undefined;
      return sourceColumns(src,cat);
    },
    [layout.sources, availableSources],
  );

  const addBlock = useCallback(
    (type: BlockType, explicitAssetId?: string) => {
      if (allBlockIds.size >= 100) {
        setBanner({ tone: "error", text: "Limite máximo de 100 blocos por relatório atingido." });
        return;
      }
      const newId = makeId("b", allBlockIds);
      const countOnPage = activePage?.blocks.length || 0;
      const offset = (countOnPage % 8) * 18;
      const size = DEFAULT_SIZES[type];
      const defaultSource = layout.sources[0];
      const knownCols = defaultSource ? resolveKnownColumns(defaultSource.id) : [];

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
      // New tables use the complete source schema; a subset is an explicit user choice.

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

      mutateLayout((prev) => ({
        ...prev,
        pages: prev.pages.map((p) =>
          p.id === activePage.id ? { ...p, blocks: [...p.blocks, created] } : p,
        ),
      }));
      setSelectedBlockId(newId);
      setBanner(null);
    },
    [
      allBlockIds,
      activePage,
      layout.sources,
      layout.page.width,
      layout.page.height,
      assets,
      resolveKnownColumns,
      mutateLayout,
    ],
  );

  const duplicateSelectedBlock = useCallback(() => {
    if (!selectedBlock) return;
    if (allBlockIds.size >= 100) {
      setBanner({ tone: "error", text: "Limite de 100 blocos atingido." });
      return;
    }
    const newId = makeId("b", allBlockIds);
    const copy: CanvasBlock = clampBlockToPage(
      {
        ...selectedBlock,
        id: newId,
        x: selectedBlock.x + 20,
        y: selectedBlock.y + 20,
        options: selectedBlock.options ? { ...selectedBlock.options } : undefined,
      },
      layout.page.width,
      layout.page.height,
    );
    mutateLayout((prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.id === activePage.id ? { ...p, blocks: [...p.blocks, copy] } : p,
      ),
    }));
    setSelectedBlockId(newId);
  }, [selectedBlock, allBlockIds, layout.page.width, layout.page.height, activePage?.id, mutateLayout]);

  const reorderBlockLayer = useCallback(
    (direction: -1 | 1) => {
      if (!selectedBlock || !activePage) return;
      const idx = activePage.blocks.findIndex((b) => b.id === selectedBlock.id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= activePage.blocks.length) return;
      mutateLayout((prev) => ({
        ...prev,
        pages: prev.pages.map((p) => {
          if (p.id !== activePage.id) return p;
          const next = [...p.blocks];
          const [moved] = next.splice(idx, 1);
          next.splice(target, 0, moved);
          return { ...p, blocks: next };
        }),
      }));
    },
    [selectedBlock, activePage, mutateLayout],
  );

  // Pointer drag & resize handling
  useEffect(() => {
    if (!dragState) return;
    const currentDrag = dragState;
    function onPointerMove(e: PointerEvent) {
      const dx = (e.clientX - currentDrag.startClientX) / zoom;
      const dy = (e.clientY - currentDrag.startClientY) / zoom;
      if (currentDrag.kind === "move") {
        const nextX = Math.round(
          clamp(currentDrag.startX + dx, 0, Math.max(0, layout.page.width - currentDrag.width)),
        );
        const nextY = Math.round(
          clamp(currentDrag.startY + dy, 0, Math.max(0, layout.page.height - currentDrag.height)),
        );
        updateBlock(currentDrag.blockId, (b) => ({ ...b, x: nextX, y: nextY }));
      } else {
        const allowX = currentDrag.handle === "se" || currentDrag.handle === "e";
        const allowY = currentDrag.handle === "se" || currentDrag.handle === "s";
        const nextW = allowX
          ? Math.round(clamp(currentDrag.startW + dx, 20, layout.page.width - currentDrag.startX))
          : currentDrag.startW;
        const nextH = allowY
          ? Math.round(clamp(currentDrag.startH + dy, 20, layout.page.height - currentDrag.startY))
          : currentDrag.startH;
        updateBlock(currentDrag.blockId, (b) => ({ ...b, width: nextW, height: nextH }));
      }
    }
    function onPointerUp() {
      setDragState(null);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragState, zoom, layout.page.width, layout.page.height, updateBlock]);

  // Keyboard move (arrows) & delete (Delete) when not focused inside form inputs
  useEffect(() => {
    if (!selectedBlockId || sourceModal || previewModal) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest('button, input, textarea, select, [role="combobox"], [role="listbox"], [data-select-popup], [contenteditable="true"]'))
      ) {
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        removeBlock(selectedBlockId!);
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        updateBlock(selectedBlockId!, (b) => ({ ...b, x: Math.max(0, b.x - step) }));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        updateBlock(selectedBlockId!, (b) => ({
          ...b,
          x: Math.min(layout.page.width - b.width, b.x + step),
        }));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        updateBlock(selectedBlockId!, (b) => ({ ...b, y: Math.max(0, b.y - step) }));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        updateBlock(selectedBlockId!, (b) => ({
          ...b,
          y: Math.min(layout.page.height - b.height, b.y + step),
        }));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedBlockId,
    sourceModal,
    previewModal,
    removeBlock,
    updateBlock,
    layout.page.width,
    layout.page.height,
  ]);
  // Pages actions
  function addBlankPage() {
    if (layout.pages.length >= 30) {
      setBanner({ tone: "error", text: "Limite de 30 páginas por relatório." });
      return;
    }
    const existing = new Set(layout.pages.map((p) => p.id));
    const pid = makeId("p", existing);
    const nextPage: CanvasPage = {
      id: pid,
      name: `Página ${layout.pages.length + 1}`,
      blocks: [],
    };
    mutateLayout((prev) => ({ ...prev, pages: [...prev.pages, nextPage] }));
    setActivePageId(pid);
    setSelectedBlockId(null);
  }

  function addCoverPage() {
    if (layout.pages.length >= 30) {
      setBanner({ tone: "error", text: "Limite de 30 páginas por relatório." });
      return;
    }
    if (allBlockIds.size + (assets[0]?.id ? 2 : 1) > 100) {
      setBanner({ tone: "error", text: "Limite de 100 blocos atingido." });
      return;
    }
    const pageIds = new Set(layout.pages.map((p) => p.id));
    const pid = makeId("capa", pageIds);
    const usedBlocks = new Set(allBlockIds);
    const coverBlocks: CanvasBlock[] = [];

    let nextY = Math.round(layout.page.height * 0.24);
    if (assets[0]?.id) {
      const imgId = makeId("b", usedBlocks);
      usedBlocks.add(imgId);
      const imgW = Math.min(220, layout.page.width - 80);
      coverBlocks.push(
        clampBlockToPage(
          {
            id: imgId,
            type: "image",
            x: Math.round((layout.page.width - imgW) / 2),
            y: Math.max(48, nextY - 120),
            width: imgW,
            height: 96,
            asset_id: assets[0].id,
            options: { color: "#075b94", font_size: 14 },
          },
          layout.page.width,
          layout.page.height,
        ),
      );
    }

    const titleId = makeId("b", usedBlocks);
    usedBlocks.add(titleId);
    const contentW = Math.max(120, layout.page.width - 120);
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
        layout.page.width,
        layout.page.height,
      ),
    );
    const coverPage: CanvasPage = {
      id: pid,
      name: "Capa",
      blocks: coverBlocks,
    };
    mutateLayout((prev) => ({ ...prev, pages: [coverPage, ...prev.pages] }));
    setActivePageId(pid);
    setSelectedBlockId(titleId);
  }

  function movePage(pageId: string, dir: -1 | 1) {
    const idx = layout.pages.findIndex((p) => p.id === pageId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= layout.pages.length) return;
    mutateLayout((prev) => {
      const next = [...prev.pages];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return { ...prev, pages: next };
    });
  }

  function deletePage(pageId: string) {
    if (layout.pages.length <= 1) return;
    const idx = layout.pages.findIndex((p) => p.id === pageId);
    const remaining = layout.pages.filter((p) => p.id !== pageId);
    mutateLayout((prev) => ({ ...prev, pages: remaining }));
    if (activePageId === pageId) {
      const fallback = remaining[Math.max(0, idx - 1)] || remaining[0];
      setActivePageId(fallback.id);
      setSelectedBlockId(null);
    }
  }

  // Sources modal actions
  function openCreateSourceModal() {
    if (layout.sources.length >= 30) {
      setBanner({ tone: "error", text: "Limite de 30 fontes por relatório." });
      return;
    }
    const existingIds = new Set(layout.sources.map((s) => s.id));
    const defaultType = availableSources.length > 0 ? "report" : "inline";
    setSourceModal({
      mode: "create",
      id: makeId(defaultType === "report" ? "dados" : "manual", existingIds),
      type: defaultType,
      reportId: availableSources[0] ? String(availableSources[0].id) : "",
      parametersJson: "{}",
      columnsJson: '["Mes", "Total"]',
      rowsJson: '[["Jan", 10], ["Fev", 20]]',
      error: "",
    });
  }

  function openEditSourceModal(src: CanvasSource) {
    setSourceModal({
      mode: "edit",
      originalId: src.id,
      id: src.id,
      type: src.type,
      reportId: src.type === "report" ? String(src.report_id) : availableSources[0] ? String(availableSources[0].id) : "",
      dataset: src.type === "report" ? src.dataset : undefined,
      parametersJson: src.type === "report" ? JSON.stringify(src.parameters || {}, null, 2) : "{}",
      columnsJson: src.type === "inline" ? JSON.stringify(src.columns) : '["Mes", "Total"]',
      rowsJson: src.type === "inline" ? JSON.stringify(src.rows, null, 2) : '[["Jan", 10], ["Fev", 20]]',
      error: "",
    });
  }

  function handleSaveSource(e: FormEvent) {
    e.preventDefault();
    if (!sourceModal) return;
    const trimmedId = sourceModal.id.trim();
    if (!IDENT_RE.test(trimmedId)) {
      setSourceModal({
        ...sourceModal,
        error: "Identificador inválido. Use letras no início e apenas letras, números, _ ou -.",
      });
      return;
    }
    const duplicate = layout.sources.some(
      (s) => s.id === trimmedId && s.id !== sourceModal.originalId,
    );
    if (duplicate) {
      setSourceModal({ ...sourceModal, error: "Já existe uma fonte com este identificador." });
      return;
    }

    let nextSource: CanvasSource;
    if (sourceModal.type === "report") {
      const rid = Number(sourceModal.reportId);
      if (!Number.isInteger(rid) || rid < 1) {
        setSourceModal({ ...sourceModal, error: "Selecione uma fonte cadastrada." });
        return;
      }
      let parsedParams: Record<string, string | number | boolean | null | { parameter: string }> = {};
      if (sourceModal.parametersJson.trim()) {
        try {
          const raw = JSON.parse(sourceModal.parametersJson);
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error("Parâmetros devem ser um objeto JSON.");
          }
          const entries = Object.entries(raw);
          if (entries.length > 30) throw new Error("Máximo de 30 parâmetros na fonte.");
          for (const [k, v] of entries) {
            if (!k || k.length > 50) throw new Error("Chave de parâmetro inválida.");
            if (
              v !== null &&
              typeof v !== "string" &&
              typeof v !== "number" &&
              typeof v !== "boolean" &&
              !isParameterBinding(v)
            ) {
              throw new Error(`Valor inválido no parâmetro "${k}". Use texto, número, booleano ou null.`);
            }
          }
          parsedParams = raw as Record<string, string | number | boolean | null | { parameter: string }>;
        } catch (err) {
          setSourceModal({ ...sourceModal, error: (err as Error).message });
          return;
        }
      }
      const catalog = availableSources.find((s) => s.id === rid);
      const dataset = sourceModal.dataset || catalog?.datasets?.[0]?.id;
      nextSource = { id: trimmedId, type: "report", report_id: rid, parameters: parsedParams, ...(dataset ? {dataset} : {}) };
    } else if (sourceModal.type === "inline") {
      let cols: string[];
      let rows: Array<Array<string | number | boolean | null>>;
      try {
        const parsedCols = JSON.parse(sourceModal.columnsJson);
        if (
          !Array.isArray(parsedCols) ||
          parsedCols.length < 1 ||
          parsedCols.length > 100 ||
          parsedCols.some((c) => typeof c !== "string" || !c.trim() || c.length > 100)
        ) {
          throw new Error("Colunas devem ser uma lista JSON de nomes não vazios.");
        }
        cols = parsedCols.map((c: string) => c.trim());
        if (new Set(cols).size !== cols.length) {
          throw new Error("Os nomes das colunas não podem se repetir.");
        }
      } catch (err) {
        setSourceModal({
          ...sourceModal,
          error: err instanceof SyntaxError ? "JSON de colunas inválido." : (err as Error).message,
        });
        return;
      }
      try {
        const parsedRows = JSON.parse(sourceModal.rowsJson);
        if (!Array.isArray(parsedRows) || parsedRows.length > 2000) {
          throw new Error("Linhas devem ser uma lista JSON (até 2000 linhas).");
        }
        for (let i = 0; i < parsedRows.length; i++) {
          const r = parsedRows[i];
          if (!Array.isArray(r) || r.length !== cols.length) {
            throw new Error(`A linha ${i + 1} deve ter exatamente ${cols.length} valores.`);
          }
          for (const cell of r) {
            if (
              cell !== null &&
              typeof cell !== "string" &&
              typeof cell !== "number" &&
              typeof cell !== "boolean"
            ) {
              throw new Error(`Valor inválido na linha ${i + 1}.`);
            }
          }
        }
        rows = parsedRows;
      } catch (err) {
        setSourceModal({
          ...sourceModal,
          error: err instanceof SyntaxError ? "JSON de linhas inválido." : (err as Error).message,
        });
        return;
      }
      nextSource = { id: trimmedId, type: "inline", columns: cols, rows };
    } else {
      nextSource = { id: trimmedId, type: "goals" };
    }

    mutateLayout((prev) => {
      const updatedSources =
        sourceModal.mode === "edit"
          ? prev.sources.map((s) => (s.id === sourceModal.originalId ? nextSource : s))
          : [...prev.sources, nextSource];
      const renamedFrom =
        sourceModal.mode === "edit" && sourceModal.originalId !== trimmedId
          ? sourceModal.originalId
          : null;
      const updatedPages = renamedFrom
        ? prev.pages.map((p) => ({
            ...p,
            blocks: p.blocks.map((b) =>
              b.source_id === renamedFrom ? { ...b, source_id: trimmedId } : b,
            ),
          }))
        : prev.pages;
      return { ...prev, sources: updatedSources, pages: updatedPages };
    });

    if (
      selectedBlock &&
      selectedBlock.type !== "text" &&
      selectedBlock.type !== "image" &&
      !selectedBlock.source_id
    ) {
      updateBlock(selectedBlock.id, (b) => ({ ...b, source_id: trimmedId }));
    }
    setSourceModal(null);
  }

  function removeSource(sourceId: string) {
    mutateLayout((prev) => ({
      ...prev,
      sources: prev.sources.filter((s) => s.id !== sourceId),
      pages: prev.pages.map((p) => ({
        ...p,
        blocks: p.blocks.map((b) =>
          b.source_id === sourceId ? { ...b, source_id: undefined } : b,
        ),
      })),
    }));
  }

  // Image upload via FileReader (PNG/JPEG <= 2MB, pure base64, no external URLs)
  function triggerImageUpload(forBlockId?: string) {
    pendingAssetBlockIdRef.current = forBlockId || null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isAllowedMime = file.type === "image/png" || file.type === "image/jpeg";
    const isAllowedExt = /\.(png|jpe?g)$/i.test(file.name);
    if (!isAllowedMime && !isAllowedExt) {
      setBanner({ tone: "error", text: "Formato inválido. Envie apenas imagens PNG ou JPEG." });
      return;
    }
    if (file.size === 0) {
      setBanner({ tone: "error", text: "Arquivo de imagem vazio." });
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      setBanner({ tone: "error", text: "A imagem excede o limite de 2 MB." });
      return;
    }

    setUploadingAsset(true);
    setBanner(null);
    const reader = new FileReader();
    reader.onerror = () => {
      setUploadingAsset(false);
      setBanner({ tone: "error", text: "Falha ao ler arquivo local." });
    };
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result || "");
        const commaIdx = dataUrl.indexOf(",");
        const pureBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        const created = await request<CanvasAssetMeta>(
          query(`reports/${report.id}/canvas-assets`, { unit }),
          "POST",
          {
            filename: file.name.slice(0, 160),
            content: pureBase64,
          },
        );
        setAssets((prev) => [created, ...prev.filter((a) => a.id !== created.id)]);
        registerAssetBlob(
          created.id,
          created.content || pureBase64,
          created.filename || file.name,
          created.mime || file.type,
        );
        const targetBlock = pendingAssetBlockIdRef.current;
        if (targetBlock) {
          updateBlock(targetBlock, (b) => ({ ...b, asset_id: created.id }));
        } else if (selectedBlock?.type === "image" && !selectedBlock.asset_id) {
          updateBlock(selectedBlock.id, (b) => ({ ...b, asset_id: created.id }));
        }
        setBanner({ tone: "ok", text: `Imagem enviada: ${created.filename}` });
      } catch (err) {
        setBanner({ tone: "error", text: (err as Error).message });
      } finally {
        pendingAssetBlockIdRef.current = null;
        setUploadingAsset(false);
      }
    };
    reader.readAsDataURL(file);
  }

  // Client-side pre-flight validation matching schema.py
  function validateBeforeSend(requireAtLeastOneBlock: boolean): CanvasLayout | null {
    const clean = sanitizeLayoutForApi(layout);
    const totalBlocks = clean.pages.reduce((acc, p) => acc + p.blocks.length, 0);
    if (requireAtLeastOneBlock && totalBlocks === 0) {
      setBanner({ tone: "error", text: "Adicione ao menos um bloco ao Canvas." });
      return null;
    }
    const sourceIds = new Set(clean.sources.map((s) => s.id));
    for (const p of clean.pages) {
      for (const b of p.blocks) {
        if (b.type !== "text" && b.type !== "image" && (!b.source_id || !sourceIds.has(b.source_id))) {
          setActivePageId(p.id);
          setSelectedBlockId(b.id);
          setBanner({
            tone: "error",
            text: `Selecione uma fonte de dados para o bloco "${b.title || BLOCK_LABELS[b.type]}" (${p.name}).`,
          });
          return null;
        }
        if (b.type === "image" && (!b.asset_id || !UUID_RE.test(b.asset_id))) {
          setActivePageId(p.id);
          setSelectedBlockId(b.id);
          setBanner({
            tone: "error",
            text: `Selecione ou envie uma imagem para o bloco em "${p.name}".`,
          });
          return null;
        }
        if (
          (b.type === "bar" || b.type === "line" || b.type === "pie") &&
          b.options?.y_fields &&
          b.options.y_fields.length > 6
        ) {
          setActivePageId(p.id);
          setSelectedBlockId(b.id);
          setBanner({ tone: "error", text: "Selecione no máximo 6 séries numéricas no gráfico." });
          return null;
        }
      }
    }
    return clean;
  }

  async function handleSaveCanvas() {
    if(columnWidthsError.current && columnWidthsError.current === selectedBlockId) {setBanner({tone:"error",text:"Corrija as larguras das colunas antes de salvar."});return;}
    const clean = validateBeforeSend(enabled);
    if (!clean) return;
    setBusy(true);
    setBanner(null);
    try {
      const saved = await request<CanvasGetResponse>(
        query(`reports/${report.id}/canvas`, { unit }),
        "POST",
        {
          version: Math.max(1, Math.round(Number(version) || 1)),
          layout: clean,
          enabled,
          output_format: outputFormat,
        },
      );
      const nextNormalized = normalizeLayout(saved.layout ?? clean);
      setVersion(typeof saved.version === "number" ? saved.version : version + 1);
      setLayout(nextNormalized);
      setEnabled(Boolean(saved.enabled));
      if (Array.isArray(saved.monthly_goals)) setMonthlyGoals(saved.monthly_goals);
      setOutputFormat(saved.output_format === "xlsx" ? "xlsx" : "pdf");
      if (Array.isArray(saved.sources)) setAvailableSources(saved.sources);
      if (Array.isArray(saved.assets)) {
        setAssets(saved.assets);
        for (const a of saved.assets) {
          if (a.content) registerAssetBlob(a.id, a.content, a.filename, a.mime);
        }
      }
      setDirty(false);
      setBanner({
        tone: "ok",
        text: saved.enabled
          ? "Canvas salvo e ativado para este relatório."
          : "Rascunho salvo.",
      });
      onSaved?.();
    } catch (e) {
      const msg = (e as Error).message || "Falha ao salvar o Canvas.";
      const isConflict = /alterado|conflito|409|atualiz|vers[aã]o/i.test(msg);
      setBanner({
        tone: isConflict ? "conflict" : "error",
        text: isConflict
          ? `${msg} Recarregue os dados do relatório antes de salvar novamente.`
          : msg,
      });
    } finally {
      setBusy(false);
    }
  }

  function closePreviewDialog() {
    if (previewModal?.busy) return;
    if (previewModal?.resultUrl) {
      URL.revokeObjectURL(previewModal.resultUrl);
      downloadUrlsRef.current.delete(previewModal.resultUrl);
    }
    setPreviewModal(null);
  }

  function openPreviewDialog() {
    const clean = validateBeforeSend(true);
    if (!clean) return;
    setPreviewModal({
      format: outputFormat,
      values: Object.fromEntries(previewFields.map(f => [f.name, displayParameter(f.default,f.type)])),
      busy: false,
      error: "",
      info: "",
    });
  }

  async function handleRunPreview(e: FormEvent) {
    e.preventDefault();
    if (!previewModal) return;
    const clean = validateBeforeSend(true);
    if (!clean) return;

    let parsedParams: Record<string, unknown>;
    try { parsedParams = collectTestParameters(previewFields, previewModal.values); }
    catch (err) {setPreviewModal({...previewModal,error:(err as Error).message});return;}

    setPreviewModal((curr) => (curr ? { ...curr, busy: true, error: "", info: "" } : null));
    try {
      const res = await request<CanvasPreviewResponse>(
        query(`reports/${report.id}/canvas-preview`, { unit }),
        "POST",
        {
          layout: clean,
          parameters: parsedParams,
          output_format: previewModal.format,
        },
      );
      const fmt = (res.format || previewModal.format).toLowerCase();
      const mime =
        fmt === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf";
      const blob = base64ToBlob(res.content, mime);
      const url = URL.createObjectURL(blob);
      downloadUrlsRef.current.add(url);
      if (previewModal.resultUrl) {
        URL.revokeObjectURL(previewModal.resultUrl);
        downloadUrlsRef.current.delete(previewModal.resultUrl);
      }
      setPreviewModal((curr) =>
        curr
          ? {
              ...curr,
              busy: false,
              resultUrl:url,
              resultName:res.filename || `previa-canvas-${report.id}.${fmt}`,
              resultFormat:fmt,
              info: res.rows === 0 ? "Nenhum dado encontrado para os parâmetros informados." : "",

            }
          : null,
      );
    } catch (err) {
      setPreviewModal((curr) =>
        curr ? { ...curr, busy: false, error: (err as Error).message } : null,
      );
    }
  }
  // Live dataset resolution for inline & goals sources (never executes SQL automatically)
  const localDatasets = useMemo(() => {
    const map = new Map<string, { columns: string[]; rows: unknown[][] }>();
    const goalsList: Array<{ year: number; month: number; value: number }> = Array.isArray(
      monthlyGoals,
    )
      ? monthlyGoals
      : [];
    for (const s of layout.sources) {
      if (s.type === "inline") {
        map.set(s.id, { columns: s.columns, rows: s.rows });
      } else if (s.type === "goals") {
        map.set(s.id, {
          columns: ["year", "month", "value"],
          rows: goalsList.map((g) => [g.year, g.month, g.value]),
        });
      }
    }
    return map;
  }, [layout.sources, monthlyGoals]);

  function startBlockDrag(e: ReactPointerEvent, block: CanvasBlock) {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelectedBlockId(block.id);
    setDragState({
      kind: "move",
      blockId: block.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: block.x,
      startY: block.y,
      width: block.width,
      height: block.height,
    });
  }

  function startBlockResize(
    e: ReactPointerEvent,
    block: CanvasBlock,
    handle: "se" | "e" | "s",
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelectedBlockId(block.id);
    setDragState({
      kind: "resize",
      handle,
      blockId: block.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: block.x,
      startY: block.y,
      startW: block.width,
      startH: block.height,
    });
  }

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);
    return () => window.removeEventListener("beforeunload",warn);
  },[dirty]);

  const selectedKnownColumns = useMemo(
    () => (selectedBlock?.source_id ? resolveKnownColumns(selectedBlock.source_id) : []),
    [selectedBlock?.source_id, resolveKnownColumns],
  );

  const isPortraitA4 = layout.page.width === 794 && layout.page.height === 1123;
  const isLandscapeA4 = layout.page.width === 1123 && layout.page.height === 794;

  function toggleMultiColumn(list: string[] | undefined, col: string, maxItems: number): string[] {
    const curr = list || [];
    if (curr.includes(col)) {
      return curr.filter((x) => x !== col);
    }
    if (curr.length >= maxItems) return curr;
    return [...curr, col];
  }
  return (
    <>
      <CanvasShell
        title={report.name}
        busy={busy}
        onClose={() => {if (!dirty || window.confirm("Sair sem salvar as alterações?")) onClose();}}
        footer={
          <div className="rc-footer-bar">
            <div className="rc-footer-left">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={loading || busy}
                  onChange={(e) => {
                    setEnabled(e.target.checked);
                    setDirty(true);
                  }}
                />
                <span>Usar Canvas</span>
              </label>
              <label className="rc-footer-select">
                <span>Formato</span>
                <Select
                  aria-label="Formato de saída do Canvas"
                  value={outputFormat}
                  disabled={loading || busy}
                  onChange={(e) => {
                    setOutputFormat(e.target.value === "xlsx" ? "xlsx" : "pdf");
                    setDirty(true);
                  }}
                >
                  <option value="pdf">PDF</option>
                  <option value="xlsx">XLSX</option>
                </Select>
              </label>
              <span className="rc-state-pill">
                {enabled
                  ? "Canvas ativo"
                  : "Rascunho"}
                {dirty ? " · Alterações não salvas" : ""}
              </span>
            </div>
            <div className="rc-footer-right">
              <label className="checkbox-label" title="Exemplos fictícios apenas no editor; não são salvos nem usados no PDF.">
                <input type="checkbox" checked={showSampleData} onChange={e=>setShowSampleData(e.target.checked)}/>
                <span>Dados de exemplo</span>
              </label>
              <button
                type="button"
                className="button"
                disabled={loading || busy}
                onClick={openPreviewDialog}
              >
                <Eye size={14} />
                Testar
              </button>

              <button
                type="button"
                className="button primary"
                disabled={loading || busy}
                onClick={() => void handleSaveCanvas()}
              >
                <Save size={14} />
                {busy ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={handleFileChange}
        />

        {/* Top Palette & View Controls */}
        <div className="rc-toolbar" role="toolbar" aria-label="Ferramentas do Canvas">
          <div className="rc-toolbar-group rc-page-navigation">
            <Files size={17} aria-hidden="true"/>
            <Select aria-label="Página atual" value={activePageId} onChange={e=>{setActivePageId(e.target.value);setSelectedBlockId(null);}}>
              {layout.pages.map(page=><option key={page.id} value={page.id}>{page.name}</option>)}
            </Select>
          </div>

          <div className="rc-toolbar-group">
            <Select aria-label="Formato da página" value={isPortraitA4 ? "portrait" : isLandscapeA4 ? "landscape" : "custom"} disabled={loading} onChange={(e) => {
              if (e.target.value === "portrait") updatePageConfig({width: 794, height: 1123});
              if (e.target.value === "landscape") updatePageConfig({width: 1123, height: 794});
            }}>
              <option value="portrait">A4 · Retrato</option>
              <option value="landscape">A4 · Paisagem</option>
              <option value="custom" disabled>Personalizado</option>
            </Select>
            <button
              type="button"
              className={`rc-tool-btn ${showGrid ? "is-active" : ""}`.trim()}
              disabled={loading}
              title="Exibir ou ocultar colunas de referência"
              onClick={() => setShowGrid((v) => !v)}
            >
              <Grid size={14} />
              Guias
            </button>

            <span className="rc-toolbar-divider" aria-hidden="true" />

            <button
              type="button"
              className="rc-tool-btn"
              aria-label="Reduzir zoom"
              onClick={() => setZoom((z) => round2(clamp(z - 0.1, 0.25, 2)))}
            >
              <ZoomOut size={14} />
            </button>
            <span className="rc-zoom-readout">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="rc-tool-btn"
              aria-label="Aumentar zoom"
              onClick={() => setZoom((z) => round2(clamp(z + 0.1, 0.25, 2)))}
            >
              <ZoomIn size={14} />
            </button>
            <button type="button" className="rc-tool-btn" onClick={() => setZoom(1)}>
              100%
            </button>
            <button type="button" className="rc-tool-btn" aria-label="Ajustar largura" title="Ajustar largura" onClick={() => fitToWidth()}>
              <Scan size={14} />
            </button>
            <button
              type="button"
              className="rc-tool-btn"
              title="Recarregar do servidor"
              disabled={loading || busy}
              onClick={() => void loadCanvas(true)}
            >
              <RefreshCw size={14} />
            </button>
            <span className="rc-toolbar-divider" aria-hidden="true" />
            <button type="button" className="rc-tool-btn" aria-expanded={rightOpen} onClick={()=>{setRightOpen(v=>!v);writePreference("right",!rightOpen);}}><SlidersHorizontal size={16}/>Propriedades</button>
            <details className="rc-panel-settings"><summary>Larguras</summary><div>
              <label>Painel esquerdo<input type="range" min="200" max="360" aria-label="Largura do painel esquerdo" value={leftWidth} onChange={e=>{const v=Number(e.target.value);setLeftWidth(v);writePreference("leftWidth",v);}}/></label>
              <label>Propriedades<input type="range" min="240" max="420" aria-label="Largura de propriedades" value={rightWidth} onChange={e=>{const v=Number(e.target.value);setRightWidth(v);writePreference("rightWidth",v);}}/></label>
            </div></details>
          </div>
        </div>

        {/* Status / Conflict / Error Banner */}
        {banner && (
          <div
            className={`rc-banner rc-banner-${banner.tone}`}
            role={banner.tone === "ok" ? "status" : "alert"}
          >
            <div className="rc-banner-content">
              {banner.tone === "ok" ? <Check size={15} /> : <AlertTriangle size={15} />}
              <span>{banner.text}</span>
            </div>
            <div className="rc-banner-actions">
              {banner.tone === "conflict" && (
                <button
                  type="button"
                  className="rc-mini-btn"
                  disabled={loading || busy}
                  onClick={() => void loadCanvas(true)}
                >
                  <RefreshCw size={13} />
                  Recarregar agora
                </button>
              )}
              <button
                type="button"
                className="rc-mini-btn"
                onClick={() => setBanner(null)}
              >
                Ocultar
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="rc-loading" role="status">
            <RefreshCw size={16} />
            Carregando estrutura do Canvas…
          </div>
        ) : (
          <div className="rc-workspace" style={{"--rc-left-w":leftOpen ? `${leftWidth}px` : "0px","--rc-right-w":rightOpen ? `${rightWidth}px` : "0px"} as CSSProperties}>
            <nav className="rc-studio-rail" aria-label="Painéis do editor" style={{gridColumn:1,gridRow:1}}>
              {([{id:"components",label:"Componentes",Icon:Blocks},{id:"pages",label:"Páginas",Icon:Files},{id:"data",label:"Dados",Icon:Database},{id:"images",label:"Imagens",Icon:ImageIcon}] as const).map(item=><button type="button" key={item.id} className="rc-rail-button" aria-label={item.label} title={item.label} aria-pressed={leftOpen && libraryTab===item.id} onClick={()=>selectLibrary(item.id)}><item.Icon size={22}/><span>{item.id==="components"?"Blocos":item.label}</span></button>)}
            </nav>
            {/* LEFT SIDEBAR: Pages, Page Config, Data Sources, Assets */}
            <aside style={{gridColumn:2,gridRow:1}} hidden={!leftOpen} className="rc-sidebar rc-sidebar-left" aria-label="Biblioteca do editor">
              <div className="rc-library-heading"><strong>{{components:"Componentes",pages:"Páginas",data:"Dados",images:"Imagens"}[libraryTab]}</strong><button type="button" className="rc-icon-btn" aria-label="Recolher painel esquerdo" onClick={()=>{setLeftOpen(false);writePreference("left",false);}}><PanelLeftClose size={17}/></button></div>
              {libraryTab === "components" && <section className="rc-library-panel">
                <label className="rc-library-search"><Search size={16}/><input aria-label="Buscar componente" placeholder="Buscar componente" value={componentSearch} onChange={e=>setComponentSearch(e.target.value)}/></label>
                {([{title:"Conteúdo",types:["text","kpi","table","image"]},{title:"Gráficos",types:["bar","line","pie"]}] as const).map(group=>{
                  const types=group.types.filter(type=>matchesComponent(type));
                  return types.length ? <div key={group.title}><h3 className="rc-library-group-title">{group.title}</h3><div className="rc-component-grid">{types.map(type=>{const Icon=componentIcons[type];return <button key={type} type="button" className="rc-component-tile" disabled={loading} onClick={()=>{addBlock(type);setInspectorTab("content");setRightOpen(true);writePreference("right",true);}}><span className="rc-component-symbol"><Icon size={30} strokeWidth={1.6}/></span><span>{componentNames[type]}</span></button>;})}</div></div>:null;
                })}
                {!(Object.keys(componentNames) as BlockType[]).some(matchesComponent) && <p className="rc-empty-note">Nenhum componente encontrado.</p>}
              </section>}
              <section className="rc-section" hidden={libraryTab!=="pages"}>
                <div className="rc-section-head">
                  <h3>Páginas ({layout.pages.length})</h3>
                  <div className="rc-section-actions">
                    <button
                      type="button"
                      className="rc-mini-btn"
                      title="Inserir página de capa com título e imagem"
                      onClick={addCoverPage}
                    >
                      <BookOpen size={12} />
                      Capa
                    </button>
                    <button type="button" className="rc-mini-btn" onClick={addBlankPage}>
                      <Plus size={12} />
                      Página
                    </button>
                  </div>
                </div>
                <div className="rc-item-list">
                  {layout.pages.map((p, idx) => (
                    <div
                      key={p.id}
                      className={`rc-list-row ${p.id === activePage?.id ? "is-active" : ""}`.trim()}
                    >
                      <button
                        type="button"
                        className="rc-list-row-main"
                        onClick={() => {
                          setActivePageId(p.id);
                          setSelectedBlockId(null);
                        }}
                      >
                        <span className="rc-list-row-title">{p.name}</span>
                        <span className="rc-list-row-sub">
                          {p.blocks.length} bloco(s) · {p.id}
                        </span>
                      </button>
                      <div className="rc-list-row-actions">
                        <button
                          type="button"
                          className="rc-icon-btn"
                          title="Mover página para cima"
                          aria-label={`Mover ${p.name} para cima`}
                          disabled={idx === 0}
                          onClick={() => movePage(p.id, -1)}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="rc-icon-btn"
                          title="Mover página para baixo"
                          aria-label={`Mover ${p.name} para baixo`}
                          disabled={idx === layout.pages.length - 1}
                          onClick={() => movePage(p.id, 1)}
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          type="button"
                          className="rc-icon-btn danger"
                          title="Remover página"
                          aria-label={`Remover ${p.name}`}
                          disabled={layout.pages.length <= 1}
                          onClick={() => deletePage(p.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {activePage && (
                  <label className="rc-field">
                    <span>Nome da página ativa</span>
                    <input
                      type="text"
                      maxLength={100}
                      value={activePage.name}
                      onChange={(e) => {
                        const val = e.target.value;
                        mutateLayout((prev) => ({
                          ...prev,
                          pages: prev.pages.map((p) =>
                            p.id === activePage.id ? { ...p, name: val } : p,
                          ),
                        }));
                      }}
                    />
                  </label>
                )}

                <div className="rc-grid-2">
                  <label className="rc-field">
                    <span>Largura (px)</span>
                    <input
                      type="number"
                      min={150}
                      max={3000}
                      value={layout.page.width}
                      onChange={(e) => updatePageConfig({ width: Number(e.target.value) })}
                    />
                  </label>
                  <label className="rc-field">
                    <span>Altura (px)</span>
                    <input
                      type="number"
                      min={150}
                      max={3000}
                      value={layout.page.height}
                      onChange={(e) => updatePageConfig({ height: Number(e.target.value) })}
                    />
                  </label>
                  <label className="rc-field">
                    <span>Colunas (1–48)</span>
                    <input
                      type="number"
                      min={1}
                      max={48}
                      step={1}
                      value={layout.page.columns}
                      onChange={(e) => updatePageConfig({ columns: Number(e.target.value) })}
                    />
                  </label>
                  <label className="rc-field">
                    <span>Fundo da página</span>
                    <div className="rc-color-control">
                      <input
                        type="color"
                        aria-label="Cor de fundo da página"
                        className="rc-color-input"
                        value={validColor(layout.page.background, "#ffffff")}
                        onChange={(e) => updatePageConfig({ background: e.target.value })}
                      />
                      <input
                        type="text"
                        maxLength={7}
                        value={layout.page.background}
                        onChange={(e) => {
                          if (HEX_COLOR_RE.test(e.target.value)) {
                            updatePageConfig({ background: e.target.value });
                          }
                        }}
                      />
                    </div>
                  </label>
                </div>
              </section>

              <section className="rc-section" hidden={libraryTab!=="data"}>
                <div className="rc-section-head">
                  <h3>Fontes de dados ({layout.sources.length})</h3>
                  <button
                    type="button"
                    className="rc-mini-btn"
                    onClick={openCreateSourceModal}
                  >
                    <Plus size={12} />
                    Adicionar
                  </button>
                </div>
                {layout.sources.length === 0 ? (
                  <p className="rc-empty-note">Nenhuma fonte configurada.</p>
                ) : (
                  <div className="rc-item-list">
                    {layout.sources.map((src) => {
                      const sqlItem =
                        src.type === "report"
                          ? availableSources.find((c) => c.id === src.report_id)
                          : undefined;
                      const detail =
                        src.type === "report"
                          ? sqlItem
                            ? `${sqlItem.name} · ${sqlItem.code}`
                            : `Fonte #${src.report_id}`
                          : src.type === "inline"
                            ? `${src.columns.length} col · ${src.rows.length} linha(s)`
                            : "Metas mensais (year, month, value)";
                      return (
                        <div key={src.id} className="rc-list-row">
                          <div className="rc-list-row-main">
                            <span className="rc-list-row-title">
                              <span className="rc-tag">
                                {src.type === "report"
                                  ? (sqlItem?.datasets ? "Dados" : "SQL")
                                  : src.type === "inline"
                                    ? "Manual"
                                    : "Metas"}
                              </span>
                              {src.id}
                            </span>
                            <span className="rc-list-row-sub" title={detail}>
                              {detail}
                            </span>
                          </div>
                          <div className="rc-list-row-actions">
                            <button
                              type="button"
                              className="rc-icon-btn"
                              title={`Editar fonte ${src.id}`}
                              aria-label={`Editar fonte ${src.id}`}
                              onClick={() => openEditSourceModal(src)}
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              type="button"
                              className="rc-icon-btn danger"
                              title={`Remover fonte ${src.id}`}
                              aria-label={`Remover fonte ${src.id}`}
                              onClick={() => removeSource(src.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="rc-section" hidden={libraryTab!=="images"}>
                <div className="rc-section-head">
                  <h3>Imagens ({assets.length})</h3>
                  <button
                    type="button"
                    className="rc-mini-btn"
                    disabled={uploadingAsset}
                    onClick={() => triggerImageUpload()}
                  >
                    <Upload size={12} />
                    {uploadingAsset ? "Enviando…" : "Enviar"}
                  </button>
                </div>
                {assets.length === 0 ? (
                  <p className="rc-empty-note">PNG ou JPEG · até 2 MB</p>
                ) : (
                  <div className="rc-item-list">
                    {assets.map((a) => (
                      <div key={a.id} className="rc-list-row">
                        <div className="rc-asset-row">
                          {assetUrls[a.id] ? (
                            <img
                              src={assetUrls[a.id]}
                              alt={a.filename}
                              className="rc-asset-thumb"
                            />
                          ) : (
                            <span className="rc-asset-thumb" aria-hidden="true" />
                          )}
                          <div className="rc-list-row-main">
                            <span className="rc-list-row-title" title={a.filename}>
                              {a.filename}
                            </span>
                            <span className="rc-list-row-sub">
                              {a.width}×{a.height} px
                            </span>
                          </div>
                        </div>
                        <div className="rc-list-row-actions">
                          <button
                            type="button"
                            className="rc-mini-btn"
                            title="Inserir bloco com esta imagem na página atual"
                            onClick={() => addBlock("image", a.id)}
                          >
                            Inserir
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </aside>

            {/* CENTER DRAFTING STAGE */}
            <div
              ref={stageRef}
              className="rc-stage"
              style={{gridColumn:3,gridRow:1}}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) setSelectedBlockId(null);
              }}
            >
              <div
                className="rc-page-frame"
                style={{
                  width: `${Math.round(layout.page.width * zoom)}px`,
                  height: `${Math.round(layout.page.height * zoom)}px`,
                }}
              >
                <div
                  className="rc-page"
                  data-page-tone={isDarkHex(layout.page.background) ? "dark" : "light"}
                  style={{
                    width: `${layout.page.width}px`,
                    height: `${layout.page.height}px`,
                    backgroundColor: layout.page.background,
                    transform: `scale(${zoom})`,
                  }}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) setSelectedBlockId(null);
                  }}
                >
                  {showGrid && (
                    <div
                      className="rc-column-grid"
                      style={{
                        gridTemplateColumns: `repeat(${layout.page.columns}, minmax(0, 1fr))`,
                      }}
                      aria-hidden="true"
                    >
                      {Array.from({ length: layout.page.columns }).map((_, i) => (
                        <div key={i} className="rc-column-guide" />
                      ))}
                    </div>
                  )}

                  {activePage?.blocks.map((block) => {
                    const isSelected = block.id === selectedBlockId;
                    const isDragging = dragState?.blockId === block.id;
                    return (
                      <div
                        key={block.id}
                        role="group"
                        tabIndex={0}
                        aria-label={`Bloco ${BLOCK_LABELS[block.type]} ${block.title || block.id}`}
                        className={`rc-block rc-block-${block.type} ${isSelected ? "is-selected" : ""} ${isDragging ? "is-dragging" : ""}`.trim()}
                        style={{
                          left: `${block.x}px`,
                          top: `${block.y}px`,
                          width: `${block.width}px`,
                          height: `${block.height}px`,
                        }}
                        onPointerDown={(e) => startBlockDrag(e, block)}
                        onFocus={() => setSelectedBlockId(block.id)}
                      >
                        {isSelected && (
                          <span className="rc-block-coords">
                            {Math.round(block.x)}, {Math.round(block.y)} · {Math.round(block.width)}×{Math.round(block.height)}
                          </span>
                        )}

                        {<BlockPreview block={block} background={layout.page.background} sources={layout.sources} assets={assets} assetUrls={assetUrls} availableSources={availableSources} localDatasets={localDatasets} reportName={report.name} showSampleData={showSampleData} />}

                        {isSelected && (
                          <>
                            <button
                              type="button"
                              tabIndex={-1}
                              aria-label="Redimensionar largura"
                              className="rc-resize-handle rc-resize-handle-e"
                              onPointerDown={(e) => startBlockResize(e, block, "e")}
                            />
                            <button
                              type="button"
                              tabIndex={-1}
                              aria-label="Redimensionar altura"
                              className="rc-resize-handle rc-resize-handle-s"
                              onPointerDown={(e) => startBlockResize(e, block, "s")}
                            />
                            <button
                              type="button"
                              tabIndex={-1}
                              aria-label="Redimensionar bloco"
                              className="rc-resize-handle rc-resize-handle-se"
                              onPointerDown={(e) => startBlockResize(e, block, "se")}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {/* RIGHT SIDEBAR: INSPECTOR */}
            <aside style={{gridColumn:4,gridRow:1}} hidden={!rightOpen} className="rc-sidebar rc-sidebar-right" aria-label="Inspetor de propriedades">
              {selectedBlock && <>
                <div className="rc-inspector-heading">{(()=>{const Icon=componentIcons[selectedBlock.type];return <Icon size={22}/>;})()}<div><strong>{componentNames[selectedBlock.type]}</strong><small>{selectedBlock.id}</small></div></div>
                    <div className="rc-inspector-actions" role="group" aria-label="Ações do bloco">
                      <div className="rc-section-actions">
                        <button
                          type="button"
                          className="rc-icon-btn"
                          title="Enviar camada para trás"
                          aria-label="Enviar camada para trás"
                          onClick={() => reorderBlockLayer(-1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          className="rc-icon-btn"
                          title="Trazer camada para frente"
                          aria-label="Trazer camada para frente"
                          onClick={() => reorderBlockLayer(1)}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="rc-icon-btn"
                          title="Duplicar bloco"
                          aria-label="Duplicar bloco"
                          onClick={duplicateSelectedBlock}
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          className="rc-icon-btn danger"
                          title="Excluir bloco (Delete)"
                          aria-label="Excluir bloco"
                          onClick={() => removeBlock(selectedBlock.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                <div className="rc-inspector-tabs" role="tablist" aria-label="Propriedades do bloco" onKeyDown={e=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(e.key)){e.preventDefault();e.stopPropagation();const next=e.key==="Home"?"content":e.key==="End"?"appearance":inspectorTab==="content"?"appearance":"content";setInspectorTab(next);(e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next==="content"?0:1])?.focus();}}}><button type="button" role="tab" id={`${inspectorId}-content`} aria-controls={`${inspectorId}-panel`} tabIndex={inspectorTab==="content"?0:-1} aria-selected={inspectorTab==="content"} className={inspectorTab==="content"?"is-active":""} onClick={()=>setInspectorTab("content")}>Conteúdo</button><button type="button" role="tab" id={`${inspectorId}-appearance`} aria-controls={`${inspectorId}-panel`} tabIndex={inspectorTab==="appearance"?0:-1} aria-selected={inspectorTab==="appearance"} className={inspectorTab==="appearance"?"is-active":""} onClick={()=>setInspectorTab("appearance")}>Aparência</button></div>
              </>}
              {selectedBlock ? (
                <div role="tabpanel" id={`${inspectorId}-panel`} aria-labelledby={`${inspectorId}-${inspectorTab}`}>
                  <section className="rc-section" hidden={inspectorTab!=="content"}>
                    <label className="rc-field">
                      <span>Título / Rótulo</span>
                      <input
                        type="text"
                        maxLength={300}
                        placeholder="Opcional"
                        value={selectedBlock.title || ""}
                        onChange={(e) =>
                          updateBlock(selectedBlock.id, (b) => ({
                            ...b,
                            title: e.target.value,
                          }))
                        }
                      />
                    </label>

                    {selectedBlock.type === "text" && (
                      <label className="rc-field">
                        <span>Conteúdo de texto</span>
                        <textarea
                          maxLength={20000}
                          rows={5}
                          placeholder="Texto livre ou variáveis como {{report_name}}"
                          value={selectedBlock.text || ""}
                          onChange={(e) =>
                            updateBlock(selectedBlock.id, (b) => ({
                              ...b,
                              text: e.target.value,
                            }))
                          }
                        />
                        <span className="rc-hint">
                          Variáveis suportadas: <code>{"{{report_name}}"}</code> ou parâmetros da execução.
                        </span>
                      </label>
                    )}
                  </section>

                  <section className="rc-section" hidden={inspectorTab!=="appearance"}>
                    <div className="rc-section-head">
                      <h3>Posição e tamanho</h3>
                      <div className="rc-section-actions">
                        <button
                          type="button"
                          className="rc-mini-btn"
                          title="Centralizar horizontalmente na página"
                          onClick={() =>
                            updateBlock(selectedBlock.id, (b) => ({
                              ...b,
                              x: Math.round((layout.page.width - b.width) / 2),
                            }))
                          }
                        >
                          Centro X
                        </button>
                        <button
                          type="button"
                          className="rc-mini-btn"
                          title="Ajustar largura às margens de 40px"
                          onClick={() =>
                            updateBlock(selectedBlock.id, (b) => ({
                              ...b,
                              x: 40,
                              width: Math.max(20, layout.page.width - 80),
                            }))
                          }
                        >
                          Largura útil
                        </button>
                      </div>
                    </div>

                    <div className="rc-grid-2">
                      <label className="rc-field">
                        <span>Posição X</span>
                        <input
                          type="number"
                          min={0}
                          max={Math.max(0, layout.page.width - selectedBlock.width)}
                          value={selectedBlock.x}
                          onChange={(e) =>
                            updateBlock(selectedBlock.id, (b) => ({
                              ...b,
                              x: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                      <label className="rc-field">
                        <span>Posição Y</span>
                        <input
                          type="number"
                          min={0}
                          max={Math.max(0, layout.page.height - selectedBlock.height)}
                          value={selectedBlock.y}
                          onChange={(e) =>
                            updateBlock(selectedBlock.id, (b) => ({
                              ...b,
                              y: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                      <label className="rc-field">
                        <span>Largura</span>
                        <input
                          type="number"
                          min={20}
                          max={layout.page.width}
                          value={selectedBlock.width}
                          onChange={(e) =>
                            updateBlock(selectedBlock.id, (b) => ({
                              ...b,
                              width: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                      <label className="rc-field">
                        <span>Altura</span>
                        <input
                          type="number"
                          min={20}
                          max={layout.page.height}
                          value={selectedBlock.height}
                          onChange={(e) =>
                            updateBlock(selectedBlock.id, (b) => ({
                              ...b,
                              height: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    </div>
                  </section>

                  <section className="rc-section" hidden={inspectorTab!=="appearance"}>
                    <div className="rc-section-head">
                      <h3>Aparência e tipografia</h3>
                    </div>
                    <div className="rc-grid-2">
                      <label className="rc-field">
                        <span>Cor principal</span>
                        <div className="rc-color-control">
                          <input
                            type="color"
                            aria-label="Cor principal do bloco"
                            className="rc-color-input"
                            value={validColor(selectedBlock.options?.color, "#075b94")}
                            onChange={(e) =>
                              updateBlock(selectedBlock.id, (b) => ({
                                ...b,
                                options: { ...b.options, color: e.target.value },
                              }))
                            }
                          />
                          <input
                            type="text"
                            maxLength={7}
                            value={selectedBlock.options?.color || "#075b94"}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (HEX_COLOR_RE.test(v)) {
                                updateBlock(selectedBlock.id, (b) => ({
                                  ...b,
                                  options: { ...b.options, color: v },
                                }));
                              }
                            }}
                          />
                        </div>
                      </label>
                      <label className="rc-field">
                        <span>Tamanho da fonte (px)</span>
                        <input
                          type="number"
                          min={6}
                          max={100}
                          value={selectedBlock.options?.font_size ?? 14}
                          onChange={(e) =>
                            updateBlock(selectedBlock.id, (b) => ({
                              ...b,
                              options: {
                                ...b.options,
                                font_size: clamp(Number(e.target.value) || 14, 6, 100),
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="rc-swatches" role="group" aria-label="Cores rápidas">
                      {SWATCH_COLORS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          aria-label={`Cor ${hex}`}
                          className={`rc-swatch ${(selectedBlock.options?.color || "#075b94").toLowerCase() === hex ? "is-selected" : ""}`.trim()}
                          style={{ background: hex }}
                          onClick={() =>
                            updateBlock(selectedBlock.id, (b) => ({
                              ...b,
                              options: { ...b.options, color: hex },
                            }))
                          }
                        />
                      ))}
                    </div>
                  </section>

                  {selectedBlock.type === "image" && (
                    <section className="rc-section" hidden={inspectorTab!=="content"}>
                      <div className="rc-section-head">
                        <h3>Imagem vinculada</h3>
                        <button
                          type="button"
                          className="rc-mini-btn"
                          disabled={uploadingAsset}
                          onClick={() => triggerImageUpload(selectedBlock.id)}
                        >
                          <Upload size={12} />
                          Enviar nova
                        </button>
                      </div>
                      <label className="rc-field">
                        <span>Arquivo do relatório</span>
                        <Select
                          value={selectedBlock.asset_id || ""}
                          onChange={(e) =>
                            updateBlock(selectedBlock.id, (b) => ({
                              ...b,
                              asset_id: e.target.value || undefined,
                            }))
                          }
                        >
                          <option value="">Selecione uma imagem enviada</option>
                          {assets.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.filename} ({a.width}×{a.height}px)
                            </option>
                          ))}
                        </Select>
                      </label>
                    </section>
                  )}
                  {selectedBlock.type !== "text" && selectedBlock.type !== "image" && (
                    <section className="rc-section" hidden={inspectorTab!=="content"}>
                      <div className="rc-section-head">
                        <h3>Fonte de dados e campos</h3>
                        <button
                          type="button"
                          className="rc-mini-btn"
                          onClick={openCreateSourceModal}
                        >
                          <Plus size={12} />
                          Nova fonte
                        </button>
                      </div>

                      <label className="rc-field">
                        <span>Fonte de dados</span>
                        <Select
                          value={selectedBlock.source_id || ""}
                          onChange={(e) => {
                            const nextSrcId = e.target.value || undefined;
                            const cols = resolveKnownColumns(nextSrcId);
                            updateBlock(selectedBlock.id, (b) => ({
                              ...b,
                              source_id: nextSrcId,
                              options: {
                                ...b.options,
                                ...(cols.length > 0 && (b.type === "bar" || b.type === "line" || b.type === "pie")
                                  ? {
                                      x_field: cols[0],
                                      y_fields: cols.length > 1 ? [cols[1]] : [cols[0]],
                                    }
                                  : {}),
                                ...(cols.length > 0 && b.type === "kpi"
                                  ? { value_field: cols[cols.length > 1 ? 1 : 0] }
                                  : {}),
                              },
                            }));
                          }}
                        >
                          <option value="">Selecione uma fonte</option>
                          {layout.sources.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.id} ({s.type === "report" ? "Dados" : s.type === "inline" ? "Manual" : "Metas"})
                            </option>
                          ))}
                        </Select>
                      </label>

                      {selectedBlock.type === "table" && (
                        <label className="rc-field"><span>Larguras das colunas</span>
                          <input aria-label="Larguras das colunas" placeholder="Ex.: 234, 54, 54" key={`${selectedBlock.id}-widths`} defaultValue={(selectedBlock.options?.column_widths || []).join(", ")} onBlur={(e) => {
                            const widths=e.target.value.trim() ? e.target.value.split(",").map((v) => Number(v.trim())) : [];
                            if (widths.some((v) => !Number.isFinite(v) || v < 1 || v > 3000)) { columnWidthsError.current=selectedBlock.id; setBanner({tone:"error",text:"Informe larguras entre 1 e 3000, separadas por vírgula."}); return; }
                            columnWidthsError.current=null;
                            if (JSON.stringify(widths) !== JSON.stringify(selectedBlock.options?.column_widths || [])) updateBlock(selectedBlock.id, (b) => ({...b,options:{...b.options,column_widths:widths}}));
                          }}/>
                        </label>
                      )}

                      {selectedBlock.type === "kpi" && (
                        <>
                          <div className="rc-grid-2">
                            <label className="rc-field">
                              <span>Agregação</span>
                              <Select
                                value={selectedBlock.options?.aggregate || "sum"}
                                onChange={(e) =>
                                  updateBlock(selectedBlock.id, (b) => ({
                                    ...b,
                                    options: {
                                      ...b.options,
                                      aggregate: e.target.value as AggregateMode,
                                    },
                                  }))
                                }
                              >
                                <option value="sum">Soma (sum)</option>
                                <option value="count">Contagem (count)</option>
                                <option value="first">Primeiro (first)</option>
                              </Select>
                            </label>
                            <label className="rc-field">
                              <span>Decimais (0–4)</span>
                              <input
                                type="number"
                                min={0}
                                max={4}
                                step={1}
                                value={selectedBlock.options?.precision ?? 0}
                                onChange={(e) =>
                                  updateBlock(selectedBlock.id, (b) => ({
                                    ...b,
                                    options: {
                                      ...b.options,
                                      precision: Math.round(clamp(Number(e.target.value) || 0, 0, 4)),
                                    },
                                  }))
                                }
                              />
                            </label>
                          </div>

                          {(selectedBlock.options?.aggregate || "sum") !== "count" && (
                            <label className="rc-field">
                              <span>Coluna numérica</span>
                              <input
                                type="text"
                                maxLength={100}
                                placeholder="Ex.: Total"
                                value={selectedBlock.options?.value_field || ""}
                                onChange={(e) =>
                                  updateBlock(selectedBlock.id, (b) => ({
                                    ...b,
                                    options: { ...b.options, value_field: e.target.value },
                                  }))
                                }
                              />
                              {selectedKnownColumns.length > 0 && (
                                <div className="rc-chips">
                                  {selectedKnownColumns.map((col) => (
                                    <button
                                      key={col}
                                      type="button"
                                      className={`rc-chip ${selectedBlock.options?.value_field === col ? "is-selected" : ""}`.trim()}
                                      onClick={() =>
                                        updateBlock(selectedBlock.id, (b) => ({
                                          ...b,
                                          options: { ...b.options, value_field: col },
                                        }))
                                      }
                                    >
                                      {col}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </label>
                          )}
                        </>
                      )}

                      {selectedBlock.type === "table" && (
                        <div className="rc-field">
                          <label className="rc-field">
                            <span>Colunas exibidas (vírgula · vazio = todas)</span>
                            <input
                              type="text"
                              placeholder="Ex.: Mes, Total"
                              value={(selectedBlock.options?.columns || []).join(", ")}
                              onChange={(e) => {
                                const parsed = e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean);
                                updateBlock(selectedBlock.id, (b) => ({
                                  ...b,
                                  options: { ...b.options, columns: parsed },
                                }));
                              }}
                            />
                          </label>
                          {selectedKnownColumns.length > 0 && (
                            <div className="rc-chips">
                              {selectedKnownColumns.map((col) => {
                                const active = (selectedBlock.options?.columns || []).includes(col);
                                return (
                                  <button
                                    key={col}
                                    type="button"
                                    className={`rc-chip ${active ? "is-selected" : ""}`.trim()}
                                    onClick={() =>
                                      updateBlock(selectedBlock.id, (b) => ({
                                        ...b,
                                        options: {
                                          ...b.options,
                                          columns: toggleMultiColumn(b.options?.columns, col, 100),
                                        },
                                      }))
                                    }
                                  >
                                    {col}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {(selectedBlock.type === "bar" ||
                        selectedBlock.type === "line" ||
                        selectedBlock.type === "pie") && (
                        <>
                          <div className="rc-field">
                            <label className="rc-field">
                              <span>
                                {selectedBlock.type === "pie" ? "Coluna de rótulo (fatia)" : "Coluna do Eixo X"}
                              </span>
                              <input
                                type="text"
                                maxLength={100}
                                placeholder="Ex.: Mes"
                                value={selectedBlock.options?.x_field || ""}
                                onChange={(e) =>
                                  updateBlock(selectedBlock.id, (b) => ({
                                    ...b,
                                    options: { ...b.options, x_field: e.target.value },
                                  }))
                                }
                              />
                            </label>
                            {selectedKnownColumns.length > 0 && (
                              <div className="rc-chips">
                                {selectedKnownColumns.map((col) => (
                                  <button
                                    key={col}
                                    type="button"
                                    className={`rc-chip ${selectedBlock.options?.x_field === col ? "is-selected" : ""}`.trim()}
                                    onClick={() =>
                                      updateBlock(selectedBlock.id, (b) => ({
                                        ...b,
                                        options: { ...b.options, x_field: col },
                                      }))
                                    }
                                  >
                                    {col}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="rc-field">
                            <label className="rc-field">
                              <span>
                                {selectedBlock.type === "pie"
                                  ? "Coluna de valor numérico"
                                  : "Séries Eixo Y (1 a 6, separadas por vírgula)"}
                              </span>
                              <input
                                type="text"
                                placeholder="Ex.: Total"
                                value={(selectedBlock.options?.y_fields || []).join(", ")}
                                onChange={(e) => {
                                  const ys = e.target.value
                                    .split(",")
                                    .map((s) => s.trim())
                                    .filter(Boolean)
                                    .slice(0, 6);
                                  updateBlock(selectedBlock.id, (b) => ({
                                    ...b,
                                    options: { ...b.options, y_fields: ys },
                                  }));
                                }}
                              />
                            </label>
                            {selectedKnownColumns.length > 0 && (
                              <div className="rc-chips">
                                {selectedKnownColumns.map((col) => {
                                  const active = (selectedBlock.options?.y_fields || []).includes(col);
                                  return (
                                    <button
                                      key={col}
                                      type="button"
                                      className={`rc-chip ${active ? "is-selected" : ""}`.trim()}
                                      onClick={() =>
                                        updateBlock(selectedBlock.id, (b) => ({
                                          ...b,
                                          options: {
                                            ...b.options,
                                            y_fields:
                                              b.type === "pie"
                                                ? [col]
                                                : toggleMultiColumn(b.options?.y_fields, col, 6),
                                          },
                                        }))
                                      }
                                    >
                                      {col}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </section>
                  )}
                </div>
              ) : (
                <section className="rc-section">
                  <div className="rc-section-head">
                    <h3>
                      <Layers size={13} style={{ verticalAlign: "-2px", marginRight: "5px" }} />
                      Blocos na página ({activePage?.blocks.length || 0})
                    </h3>
                  </div>
                  {activePage?.blocks.length ? (
                    <div className="rc-item-list">
                      {activePage.blocks.map((b) => (
                        <div key={b.id} className="rc-list-row">
                          <button
                            type="button"
                            className="rc-list-row-main"
                            onClick={() => setSelectedBlockId(b.id)}
                          >
                            <span className="rc-list-row-title">
                              <span className="rc-tag">{BLOCK_LABELS[b.type]}</span>
                              {b.title || b.id}
                            </span>
                            <span className="rc-list-row-sub">
                              x:{Math.round(b.x)} y:{Math.round(b.y)} · {Math.round(b.width)}×{Math.round(b.height)}px
                            </span>
                          </button>
                          <button
                            type="button"
                            className="rc-icon-btn danger"
                            aria-label={`Remover ${b.title || b.id}`}
                            onClick={() => removeBlock(b.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rc-empty-note">
                      Nenhum bloco nesta página.
                    </p>
                  )}
                  <p className="rc-hint">
                    Selecione um bloco para editar.
                  </p>
                </section>
              )}
            </aside>
          </div>
        )}
      </CanvasShell>

      {sourceModal && (
        <InlineDialog
          title={sourceModal.mode === "create" ? "Adicionar fonte de dados" : "Editar fonte de dados"}
          subtitle="Fontes compartilháveis entre blocos do Canvas"
          className="rc-subdialog cv-root"
          onClose={() => setSourceModal(null)}
          footer={
            <>
              <button
                type="button"
                className="button"
                onClick={() => setSourceModal(null)}
              >
                Cancelar
              </button>
              <button type="submit" form={sourceFormId} className="button primary">
                Salvar fonte
              </button>
            </>
          }
        >
          <form id={sourceFormId} className="rc-subform" onSubmit={handleSaveSource}>
            {sourceModal.error && (
              <p className="inline-error" role="alert">
                {sourceModal.error}
              </p>
            )}
            <div className="rc-grid-2">
              <label className="op-field">
                <span>Identificador</span>
                <input
                  type="text"
                  required
                  maxLength={50}
                  placeholder="Ex.: dados1"
                  value={sourceModal.id}
                  onChange={(e) => setSourceModal({ ...sourceModal, id: e.target.value })}
                />
              </label>
              <label className="op-field">
                <span>Tipo de fonte</span>
                <Select
                  value={sourceModal.type}
                  onChange={(e) => {
                    const nextType = e.target.value as "report" | "inline" | "goals";
                    setSourceModal({
                      ...sourceModal,
                      type: nextType,
                      ...(sourceModal.mode === "create" && nextType === "goals"
                        ? { id: "metas" }
                        : {}),
                    });
                  }}
                >
                  <option value="report">Fonte cadastrada</option>
                  <option value="inline">Dados manuais (inline)</option>
                  <option value="goals">Metas mensais do relatório</option>
                </Select>
              </label>
            </div>

            {sourceModal.type === "report" && (
              <>
                <label className="op-field">
                  <span>Fonte revisada da unidade</span>
                  <Select
                    required
                    value={sourceModal.reportId}
                    onChange={(e) => setSourceModal({ ...sourceModal, reportId: e.target.value, dataset: undefined })}
                  >
                    <option value="">Selecione uma fonte</option>
                    {availableSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.code}
                      </option>
                    ))}
                  </Select>
                </label>
                {!!availableSources.find((s) => s.id === Number(sourceModal.reportId))?.datasets?.length && (
                  <label className="op-field"><span>Conjunto de dados</span>
                    <Select aria-label="Conjunto de dados" value={sourceModal.dataset || availableSources.find((s) => s.id === Number(sourceModal.reportId))?.datasets?.[0]?.id || ""} onChange={(e) => setSourceModal({...sourceModal,dataset:e.target.value})}>
                      {availableSources.find((s) => s.id === Number(sourceModal.reportId))?.datasets?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </Select>
                  </label>
                )}
                <label className="op-field">
                  <span>Parâmetros padrão da fonte (JSON opcional)</span>
                  <textarea
                    rows={4}
                    className="rc-code-area"
                    value={sourceModal.parametersJson}
                    onChange={(e) =>
                      setSourceModal({ ...sourceModal, parametersJson: e.target.value })
                    }
                  />
                  <span className="rc-hint">
                    Opcional. Na geração oficial ou prévia, parâmetros informados na execução prevalecem.
                  </span>
                </label>
              </>
            )}

            {sourceModal.type === "inline" && (
              <>
                <label className="op-field">
                  <span>Colunas (JSON)</span>
                  <textarea
                    rows={2}
                    required
                    className="rc-code-area"
                    value={sourceModal.columnsJson}
                    onChange={(e) =>
                      setSourceModal({ ...sourceModal, columnsJson: e.target.value })
                    }
                  />
                </label>
                <label className="op-field">
                  <span>Linhas (JSON)</span>
                  <textarea
                    rows={6}
                    required
                    className="rc-code-area"
                    value={sourceModal.rowsJson}
                    onChange={(e) =>
                      setSourceModal({ ...sourceModal, rowsJson: e.target.value })
                    }
                  />
                </label>
              </>
            )}

            {sourceModal.type === "goals" && (
              <p className="rc-hint">
                Utiliza as metas mensais cadastradas neste relatório com as colunas <code>year</code>,{" "}
                <code>month</code> e <code>value</code>.
              </p>
            )}
          </form>
        </InlineDialog>
      )}

      {previewModal && (
        <InlineDialog
          title="Testar relatório"
          subtitle=""
          className={`rc-subdialog rc-test-dialog cv-root ${previewModal.resultUrl ? "has-preview" : ""}`}
          busy={previewModal.busy}
          onClose={closePreviewDialog}
          footer={
            <>
              <button
                type="button"
                className="button"
                disabled={previewModal.busy}
                onClick={closePreviewDialog}
              >
                Fechar
              </button>
              <button
                type="submit"
                form={previewFormId}
                className="button primary"
                disabled={previewModal.busy}
              >
                <Download size={14} />
                {previewModal.busy ? "Gerando…" : previewModal.resultUrl ? "Atualizar prévia" : "Gerar prévia"}
              </button>
            </>
          }
        >
          <div className="rc-test-layout">
          <form id={previewFormId} className="rc-subform rc-test-fields" onSubmit={(e) => void handleRunPreview(e)}>
            <strong>{report.name}</strong>
            {previewModal.error && (
              <p className="inline-error" role="alert">
                {previewModal.error}
              </p>
            )}
            {previewModal.info && (
              <div className="rc-banner rc-banner-ok" role="status">
                <div className="rc-banner-content">
                  <Check size={15} />
                  <span>{previewModal.info}</span>
                </div>
              </div>
            )}
            <label className="op-field">
              <span>Formato do arquivo</span>
              <Select
                value={previewModal.format}
                disabled={previewModal.busy}
                onChange={(e) =>
                  setPreviewModal({
                    ...previewModal,
                    format: e.target.value === "xlsx" ? "xlsx" : "pdf",
                  })
                }
              >
                <option value="pdf">PDF</option>
                <option value="xlsx">Excel (XLSX)</option>
              </Select>
            </label>
            <div className="rc-test-parameter-grid">
              {previewFields.map(field => <label className="op-field" key={field.name}>
                <span>{field.label}{field.required === false ? <small> · Opcional</small> : null}</span>
                {field.options ? <Select disabled={previewModal.busy} value={previewModal.values[field.name] || ""} onChange={e=>setPreviewModal({...previewModal,values:{...previewModal.values,[field.name]:e.target.value},error:""})}>
                  <option value="">Selecionar</option>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
                </Select> : <input
                  type={field.type === "integer" || field.type === "number" ? "number" : field.type === "time" ? "time" : "text"}
                  inputMode={field.type === "date" ? "numeric" : undefined}
                  placeholder={field.type === "date" ? "DD/MM/AAAA" : undefined}
                  maxLength={field.type === "date" ? 10 : 2000}
                  min={field.minimum} max={field.maximum} step={field.type === "number" ? "any" : field.type === "integer" ? 1 : undefined}
                  disabled={previewModal.busy}
                  value={previewModal.values[field.name] || ""}
                  onChange={e=>setPreviewModal({...previewModal,values:{...previewModal.values,[field.name]:e.target.value},error:""})}
                />}
              </label>)}
            </div>
            {!previewFields.length && <p className="rc-test-empty">Este relatório não exige parâmetros.</p>}
          </form>
          {previewModal.resultUrl && <section className="rc-test-result" aria-label="Prévia gerada">
            <div className="rc-test-result-bar"><span>{previewModal.resultName}</span><a className="button" href={previewModal.resultUrl} download={previewModal.resultName}><Download size={14}/>Baixar</a></div>
            {previewModal.resultFormat === "pdf" ? <iframe title="Prévia do relatório" src={previewModal.resultUrl}/> : <div className="rc-test-empty">Planilha gerada. Use Baixar para abrir no Excel.</div>}
          </section>}
          </div>
        </InlineDialog>
      )}
    </>
  );
}
