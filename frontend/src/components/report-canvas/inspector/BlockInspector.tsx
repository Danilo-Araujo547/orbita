import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Copy,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useSourcePreview } from "../api/useSourcePreview";
import { COMPONENT_ICONS, COMPONENT_NAMES } from "../library/BlockLibrary";
import type {
  CanvasAssetMeta,
  CanvasBlock,
  CanvasLayout,
  CanvasPage,
  CanvasPageConfig,
  CanvasSource,
  CatalogSqlSource,
  SourcePreview,
} from "../model";
import { computeProblems } from "../problems";
import type { Problem } from "../problems";
import AppearanceFields from "./fields/AppearanceFields";
import ContentFields from "./fields/ContentFields";
import DataFields from "./fields/DataFields";
import GeometryFields from "./fields/GeometryFields";
import { resolveSourceColumnInfos, resolveSourceRows } from "./inspectorOps";

export type InspectorTab = "content" | "appearance" | "data";

export interface BlockInspectorProps {
  block: CanvasBlock;
  activePage?: CanvasPage;
  layout?: CanvasLayout;
  inspectorTab: InspectorTab;
  pageConfig: CanvasPageConfig;
  sources: CanvasSource[];
  availableSources?: readonly CatalogSqlSource[];
  monthlyGoals?: ReadonlyArray<{ year: number; month: number; value: number }>;
  assets: CanvasAssetMeta[];
  assetUrls?: Record<string, string>;
  uploadingAsset: boolean;
  knownColumns: string[];
  resolveKnownColumns: (sourceId?: string) => string[];
  reportId?: number;
  unit?: string;
  reportName?: string;
  parameterSchema?: Record<string, unknown>;
  sourcePreviews?: Record<string, SourcePreview | null | undefined>;
  forcePreviewUnavailable?: boolean;
  onChangeTab: (tab: InspectorTab) => void;
  onReorderLayer: (dir: -1 | 1) => void;
  onDuplicateBlock: () => void;
  onRemoveBlock: (blockId: string) => void;
  onTriggerImageUpload: (blockId: string) => void;
  onOpenCreateSource: () => void;
  onColumnWidthsValidation: (blockId: string | null, errorMessage?: string) => void;
  onApplyLayoutFix?: (label: string, updater: (prev: CanvasLayout) => CanvasLayout) => void;
  onUpdateBlock: (
    blockId: string,
    label: string,
    updater: (b: CanvasBlock) => CanvasBlock,
    coalesceKey?: string,
  ) => void;
}

function renderFormattedProblemMessage(raw: string): ReactNode {
  const parts = raw.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, idx) =>
    idx % 2 === 1 ? <strong key={idx}>{part}</strong> : <span key={idx}>{part}</span>,
  );
}

export default function BlockInspector({
  block,
  activePage,
  layout,
  inspectorTab,
  pageConfig,
  sources,
  availableSources = [],
  monthlyGoals,
  assets,
  assetUrls,
  uploadingAsset,
  knownColumns,
  reportId,
  unit,
  reportName,
  parameterSchema,
  sourcePreviews,
  forcePreviewUnavailable = false,
  onChangeTab,
  onReorderLayer,
  onDuplicateBlock,
  onRemoveBlock,
  onTriggerImageUpload,
  onOpenCreateSource,
  onColumnWidthsValidation,
  onApplyLayoutFix,
  onUpdateBlock,
}: BlockInspectorProps) {
  const inspectorId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const Icon = COMPONENT_ICONS[block.type];
  const isImageBlock = block.type === "image";
  const effectiveTab: InspectorTab =
    isImageBlock && inspectorTab === "data" ? "content" : inspectorTab;

  useEffect(() => {
    setMenuOpen(false);
  }, [block.id]);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  const currentSource = useMemo(
    () => (block.source_id ? sources.find((s) => s.id === block.source_id) || null : null),
    [block.source_id, sources],
  );

  const previewHook = useSourcePreview({
    reportId,
    unit,
    source: currentSource,
    parameters: (currentSource?.type === "report" && currentSource.parameters) || {},
    autoLoad: Boolean(reportId && unit && currentSource?.type === "report"),
  });

  const externalPreview =
    currentSource && sourcePreviews ? sourcePreviews[currentSource.id] ?? null : null;
  const activePreview = externalPreview || previewHook.data;
  const isPreviewUnavailable = forcePreviewUnavailable || previewHook.isUnavailable;

  // Merge columnInfos: if neither preview nor catalog had columns, fall back to knownColumns prop
  const columnInfos = useMemo(() => {
    const resolved = resolveSourceColumnInfos(
      currentSource,
      activePreview,
      availableSources,
      monthlyGoals,
    );
    if (resolved.length > 0) return resolved;
    if (knownColumns.length > 0) {
      return knownColumns.map((name) => ({ name, type: "unknown" as const }));
    }
    return [];
  }, [activePreview, availableSources, currentSource, knownColumns, monthlyGoals]);

  const rowsMeta = useMemo(
    () => resolveSourceRows(currentSource, activePreview, monthlyGoals),
    [activePreview, currentSource, monthlyGoals],
  );

  // Build effective layout & previews map for computeProblems
  const effectiveLayout = useMemo<CanvasLayout>(() => {
    if (layout) return layout;
    return {
      schema_version: 1,
      page: pageConfig,
      sources,
      pages: [
        activePage || {
          id: "p1",
          name: "Página 1",
          blocks: [block],
        },
      ],
    };
  }, [activePage, block, layout, pageConfig, sources]);

  const mergedPreviews = useMemo(() => {
    const map: Record<string, SourcePreview | null | undefined> = {
      ...(sourcePreviews || {}),
    };
    if (currentSource && activePreview) {
      map[currentSource.id] = activePreview;
    }
    return map;
  }, [activePreview, currentSource, sourcePreviews]);

  const blockProblems = useMemo(
    () =>
      computeProblems(effectiveLayout, mergedPreviews, availableSources, {
        assets,
        monthlyGoals,
      }).filter((p) => p.blockId === block.id),
    [assets, availableSources, block.id, effectiveLayout, mergedPreviews, monthlyGoals],
  );

  const tabSeverity = useMemo(() => {
    const res: Partial<Record<InspectorTab, "error" | "warning">> = {};
    for (const p of blockProblems) {
      const t = p.fix?.targetTab || "content";
      if (p.severity === "error" || !res[t]) {
        res[t] = p.severity;
      }
    }
    return res;
  }, [blockProblems]);

  const handleClickFix = (problem: Problem) => {
    const fix = problem.fix;
    const targetTab = fix?.targetTab || effectiveTab;
    if (targetTab !== effectiveTab && !(isImageBlock && targetTab === "data")) {
      onChangeTab(targetTab);
    }

    if (fix?.apply) {
      if (onApplyLayoutFix) {
        onApplyLayoutFix(fix.label, fix.apply);
      } else {
        const patchedLayout = fix.apply(effectiveLayout);
        let patchedBlock: CanvasBlock | undefined;
        for (const p of patchedLayout.pages) {
          const found = p.blocks.find((b) => b.id === block.id);
          if (found) {
            patchedBlock = found;
            break;
          }
        }
        if (patchedBlock) {
          const snapshot = patchedBlock;
          onUpdateBlock(block.id, fix.label, () => snapshot);
        }
      }
    }

    // Move focus to target field or first error control inside inspector
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = panelRef.current;
        if (!container) return;
        if (fix?.targetFieldId) {
          const targetEl = document.getElementById(fix.targetFieldId);
          if (targetEl && container.contains(targetEl)) {
            targetEl.focus();
            return;
          }
        }
        const firstInvalid = container.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (firstInvalid) {
          firstInvalid.focus();
          return;
        }
        const firstControl = container.querySelector<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        );
        firstControl?.focus();
      });
    });
  };

  const enabledTabs: InspectorTab[] = isImageBlock
    ? ["content", "appearance"]
    : ["content", "appearance", "data"];

  const handleTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const currIdx = Math.max(0, enabledTabs.indexOf(effectiveTab));
    let nextTab = enabledTabs[0];
    if (e.key === "Home") {
      nextTab = enabledTabs[0];
    } else if (e.key === "End") {
      nextTab = enabledTabs[enabledTabs.length - 1];
    } else if (e.key === "ArrowRight") {
      nextTab = enabledTabs[(currIdx + 1) % enabledTabs.length];
    } else if (e.key === "ArrowLeft") {
      nextTab = enabledTabs[(currIdx - 1 + enabledTabs.length) % enabledTabs.length];
    }
    onChangeTab(nextTab);
    const tabMap: Record<InspectorTab, number> = { content: 0, appearance: 1, data: 2 };
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]')[tabMap[nextTab]]?.focus();
  };

  return (
    <>
      {/* Cabeçalho do bloco: ícone + título editável + menu … */}
      <div className="cv-insp-header">
        <span className="cv-insp-type-badge" title={COMPONENT_NAMES[block.type]} aria-hidden="true">
          <Icon size={15} />
        </span>
        <div className="cv-insp-title-wrap">
          <input
            type="text"
            className="cv-insp-title-input"
            aria-label="Nome do bloco"
            maxLength={300}
            placeholder={COMPONENT_NAMES[block.type]}
            value={block.title || ""}
            onChange={(e) =>
              onUpdateBlock(
                block.id,
                "Editar nome do bloco",
                (b) => ({ ...b, title: e.target.value }),
                `title:${block.id}`,
              )
            }
          />
        </div>
        <div ref={menuRef} className="cv-insp-menu-anchor">
          <button
            type="button"
            className="cv-icon-btn"
            aria-label="Ações do bloco"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Ações do bloco"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="cv-insp-menu" role="menu" aria-label="Menu do bloco">
              <button
                type="button"
                role="menuitem"
                className="cv-insp-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onDuplicateBlock();
                }}
              >
                <Copy size={13} aria-hidden="true" />
                <span>Duplicar</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="cv-insp-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onReorderLayer(1);
                }}
              >
                <ArrowUp size={13} aria-hidden="true" />
                <span>Trazer para frente</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="cv-insp-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onReorderLayer(-1);
                }}
              >
                <ArrowDown size={13} aria-hidden="true" />
                <span>Enviar para trás</span>
              </button>
              <div className="cv-insp-menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="cv-insp-menu-item is-danger"
                onClick={() => {
                  setMenuOpen(false);
                  onRemoveBlock(block.id);
                }}
              >
                <Trash2 size={13} aria-hidden="true" />
                <span>Excluir</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Problemas do bloco no topo */}
      {blockProblems.length > 0 && (
        <div className="cv-insp-problems" role="region" aria-label="Problemas deste bloco">
          {blockProblems.map((p, idx) => (
            <div key={`${p.code}-${idx}`} className={`cv-insp-problem is-${p.severity}`}>
              <div className="cv-insp-problem-body">
                {p.severity === "error" ? (
                  <AlertCircle size={13} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={13} aria-hidden="true" />
                )}
                <span className="cv-insp-problem-text">
                  {renderFormattedProblemMessage(p.message)}
                </span>
              </div>
              {p.fix && (
                <button
                  type="button"
                  className="cv-insp-fix-btn"
                  aria-label={
                    p.fix.label.toLowerCase().startsWith("corrigir")
                      ? p.fix.label
                      : `Corrigir: ${p.fix.label}`
                  }
                  onClick={() => handleClickFix(p)}
                >
                  {p.fix.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Três abas: Conteúdo · Aparência · Dados */}
      <div
        className="cv-insp-tabs"
        role="tablist"
        aria-label="Propriedades do bloco"
        onKeyDown={handleTabKeyDown}
      >
        <button
          type="button"
          role="tab"
          id={`${inspectorId}-content`}
          aria-controls={`${inspectorId}-panel`}
          tabIndex={effectiveTab === "content" ? 0 : -1}
          aria-selected={effectiveTab === "content"}
          className={`cv-insp-tab ${effectiveTab === "content" ? "is-active" : ""}`.trim()}
          onClick={() => onChangeTab("content")}
        >
          <span>Conteúdo</span>
          {tabSeverity.content && (
            <span
              className={`cv-insp-tab-dot ${
                tabSeverity.content === "warning" ? "is-warning" : ""
              }`.trim()}
              aria-hidden="true"
            />
          )}
        </button>

        <button
          type="button"
          role="tab"
          id={`${inspectorId}-appearance`}
          aria-controls={`${inspectorId}-panel`}
          tabIndex={effectiveTab === "appearance" ? 0 : -1}
          aria-selected={effectiveTab === "appearance"}
          className={`cv-insp-tab ${effectiveTab === "appearance" ? "is-active" : ""}`.trim()}
          onClick={() => onChangeTab("appearance")}
        >
          <span>Aparência</span>
          {tabSeverity.appearance && (
            <span
              className={`cv-insp-tab-dot ${
                tabSeverity.appearance === "warning" ? "is-warning" : ""
              }`.trim()}
              aria-hidden="true"
            />
          )}
        </button>

        <button
          type="button"
          role="tab"
          id={`${inspectorId}-data`}
          aria-controls={`${inspectorId}-panel`}
          disabled={isImageBlock}
          title={isImageBlock ? "Blocos de imagem não utilizam fonte de dados" : undefined}
          tabIndex={effectiveTab === "data" ? 0 : -1}
          aria-selected={effectiveTab === "data"}
          className={`cv-insp-tab ${effectiveTab === "data" ? "is-active" : ""}`.trim()}
          onClick={() => !isImageBlock && onChangeTab("data")}
        >
          <span>Dados</span>
          {tabSeverity.data && (
            <span
              className={`cv-insp-tab-dot ${
                tabSeverity.data === "warning" ? "is-warning" : ""
              }`.trim()}
              aria-hidden="true"
            />
          )}
        </button>
      </div>

      {/* Corpo rolável do inspetor */}
      <div
        ref={panelRef}
        role="tabpanel"
        id={`${inspectorId}-panel`}
        aria-labelledby={`${inspectorId}-${effectiveTab}`}
        className="cv-inspector-scroll"
      >
        <ContentFields
          block={block}
          hidden={effectiveTab !== "content"}
          layout={effectiveLayout}
          sources={sources}
          columnInfos={columnInfos}
          rows={rowsMeta.rows}
          totalRows={rowsMeta.totalRows}
          hasRows={rowsMeta.hasRows}
          previewUnavailable={isPreviewUnavailable}
          assets={assets}
          assetUrls={assetUrls}
          uploadingAsset={uploadingAsset}
          reportName={reportName}
          parameterSchema={parameterSchema}
          sourcePreviews={mergedPreviews}
          onTriggerImageUpload={onTriggerImageUpload}
          onColumnWidthsValidation={onColumnWidthsValidation}
          onUpdateBlock={onUpdateBlock}
        />

        <AppearanceFields
          block={block}
          hidden={effectiveTab !== "appearance"}
          onUpdateBlock={onUpdateBlock}
        />

        <GeometryFields
          block={block}
          pageConfig={pageConfig}
          hidden={effectiveTab !== "appearance"}
          onUpdateBlock={onUpdateBlock}
        />

        <DataFields
          block={block}
          hidden={effectiveTab !== "data"}
          sources={sources}
          availableSources={availableSources}
          monthlyGoals={monthlyGoals}
          preview={activePreview}
          previewLoading={previewHook.isLoading}
          previewError={previewHook.error}
          previewUnavailable={isPreviewUnavailable}
          onLoadPreview={
            reportId && unit
              ? (bypassCache) => {
                  if (currentSource) {
                    void previewHook.loadPreview(currentSource, undefined, { bypassCache });
                  }
                }
              : undefined
          }
          onOpenCreateSource={onOpenCreateSource}
          onUpdateBlock={onUpdateBlock}
        />
      </div>
    </>
  );
}
