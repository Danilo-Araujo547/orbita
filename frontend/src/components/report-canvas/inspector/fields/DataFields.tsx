import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Database,
  Eye,
  Plus,
  RefreshCw,
  Table2,
  Target,
} from "lucide-react";
import { PreviewCacheScope, getCachedSourcePreview } from "../../api/useSourcePreview";
import ColumnBadge from "../../data/ColumnBadge";
import DataDrawer from "../../data/DataDrawer";
import { formatCellValue } from "../../data/columnTypes";
import type {
  CanvasBlock,
  CanvasSource,
  CatalogSqlSource,
  ColumnInfo,
  SourcePreview,
} from "../../model";
import {
  computeSmartDefaults,
  formatSourceLineageLine,
  getSourceDisplayMeta,
  getUsedColumnsForBlock,
  hasConfiguredDataFields,
  isDateCompatibleColumn,
  remapColumnsForNewSource,
  resolveSourceColumnInfos,
  resolveSourceRows,
} from "../inspectorOps";
import CollapsibleSection from "./CollapsibleSection";

export interface DataFieldsProps {
  block: CanvasBlock;
  hidden: boolean;
  sources: CanvasSource[];
  availableSources?: readonly CatalogSqlSource[];
  monthlyGoals?: ReadonlyArray<{ year: number; month: number; value: number }>;
  preview?: SourcePreview | null;
  previewLoading?: boolean;
  previewError?: string | null;
  previewUnavailable?: boolean;
  knownColumns?: string[];
  resolveKnownColumns?: (sourceId?: string) => string[];
  onColumnWidthsValidation?: (blockId: string | null, errorMessage?: string) => void;
  onLoadPreview?: (bypassCache?: boolean) => void;
  onOpenCreateSource: () => void;
  onUpdateBlock: (
    blockId: string,
    label: string,
    updater: (b: CanvasBlock) => CanvasBlock,
    coalesceKey?: string,
  ) => void;
}

function SourceTypeIcon({ type }: { type: CanvasSource["type"] }) {
  if (type === "report") return <Database size={13} aria-hidden="true" />;
  if (type === "inline") return <Table2 size={13} aria-hidden="true" />;
  return <Target size={13} aria-hidden="true" />;
}

export default function DataFields({
  block,
  hidden,
  sources,
  availableSources = [],
  monthlyGoals,
  preview = null,
  previewLoading = false,
  previewError = null,
  previewUnavailable = false,
  knownColumns = [],
  onLoadPreview,
  onOpenCreateSource,
  onUpdateBlock,
}: DataFieldsProps) {
  const cacheScope = useContext(PreviewCacheScope);
  const autoId = useId();
  const listId = `${autoId}-source-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [popupPos, setPopupPos] = useState({ left: 0, top: 0, width: 260, maxHeight: 260, up: false });
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Reset remap prompt when block changes
  useEffect(() => {
    setPendingSourceId(null);
  }, [block.id, block.source_id]);

  const currentSource = useMemo(
    () => (block.source_id ? sources.find((s) => s.id === block.source_id) || null : null),
    [block.source_id, sources],
  );

  const columnInfos = useMemo<ColumnInfo[]>(
    () => {
      const resolved = resolveSourceColumnInfos(currentSource, preview, availableSources, monthlyGoals);
      return resolved.length ? resolved : knownColumns.map((name) => ({ name, type: "unknown" as const }));
    },
    [availableSources, currentSource, monthlyGoals, preview, knownColumns],
  );

  const rowsMeta = useMemo(
    () => resolveSourceRows(currentSource, preview, monthlyGoals),
    [currentSource, monthlyGoals, preview],
  );

  const usedColumns = useMemo(
    () => getUsedColumnsForBlock(block, columnInfos),
    [block, columnInfos],
  );

  const pendingSource = useMemo(
    () => (pendingSourceId ? sources.find((s) => s.id === pendingSourceId) || null : null),
    [pendingSourceId, sources],
  );

  const pendingSourceColumns = useMemo(() => {
    if (!pendingSource) return [];
    const cached = getCachedSourcePreview(
      pendingSource,
      (pendingSource.type === "report" && pendingSource.parameters) || {},
      50, cacheScope,
    );
    return resolveSourceColumnInfos(pendingSource, cached, availableSources, monthlyGoals);
  }, [availableSources, monthlyGoals, pendingSource, cacheScope]);

  const pendingRemapSummary = useMemo(() => {
    if (!pendingSource) return null;
    return remapColumnsForNewSource(block, pendingSourceColumns);
  }, [block, pendingSource, pendingSourceColumns]);

  const allowUnset = block.type === "text";

  const sourceOptions = useMemo(() => {
    const mapped = sources.map((src) => ({
      source: src as CanvasSource | null,
      id: src.id,
      ...getSourceDisplayMeta(src, availableSources),
    }));
    if (allowUnset) {
      return [
        {
          source: null as CanvasSource | null,
          id: "",
          title: "Sem fonte vinculada",
          subtitle: "Usar apenas texto e parâmetros do relatório",
          kindLabel: "Nenhuma",
        },
        ...mapped,
      ];
    }
    return mapped;
  }, [allowUnset, availableSources, sources]);

  const updatePopupPos = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < 180 && above > below;
    const width = Math.min(Math.max(rect.width, 250), window.innerWidth - 24);
    setPopupPos({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: up ? rect.top - 4 : rect.bottom + 4,
      width,
      maxHeight: Math.max(120, Math.min(280, up ? above : below)),
      up,
    });
  };

  const openMenu = () => {
    if (sourceOptions.length === 0) {
      onOpenCreateSource();
      return;
    }
    const idx = sourceOptions.findIndex((o) => o.id === (block.source_id || ""));
    setActiveIdx(idx >= 0 ? idx : 0);
    updatePopupPos();
    setMenuOpen(true);
  };

  const closeMenu = (restoreFocus = true) => {
    setMenuOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!menuOpen) return;
    popupRef.current?.focus();
    const onOutside = (e: PointerEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !popupRef.current?.contains(e.target as Node)
      ) {
        closeMenu(false);
      }
    };
    const onRelayout = () => updatePopupPos();
    document.addEventListener("pointerdown", onOutside);
    window.addEventListener("resize", onRelayout);
    window.addEventListener("scroll", onRelayout, true);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      window.removeEventListener("resize", onRelayout);
      window.removeEventListener("scroll", onRelayout, true);
    };
  }, [menuOpen]);

  const applyNewSourceWithSmartDefaults = (nextSource: CanvasSource | null) => {
    if (!nextSource) {
      onUpdateBlock(block.id, "Desvincular fonte de dados", (b) => ({
        ...b,
        source_id: undefined,
      }));
      setPendingSourceId(null);
      return;
    }
    const cached = getCachedSourcePreview(
      nextSource,
      (nextSource.type === "report" && nextSource.parameters) || {},
      50, cacheScope,
    );
    const nextCols = resolveSourceColumnInfos(nextSource, cached, availableSources, monthlyGoals);
    onUpdateBlock(block.id, "Vincular fonte de dados", (b) => {
      const defaults = computeSmartDefaults(b.type, nextCols, {
        isNewChart: !b.options?.series_colors,
        existingOptions: b.options,
      });
      return {
        ...b,
        source_id: nextSource.id,
        options: {
          ...b.options,
          ...defaults,
        },
      };
    });
    setPendingSourceId(null);
  };

  const handleChooseSource = (nextSourceId: string) => {
    closeMenu(true);
    if (nextSourceId === (block.source_id || "")) {
      setPendingSourceId(null);
      return;
    }
    if (!nextSourceId) {
      applyNewSourceWithSmartDefaults(null);
      return;
    }
    const nextSrc = sources.find((s) => s.id === nextSourceId) || null;
    if (!nextSrc) return;

    if (block.source_id && hasConfiguredDataFields(block)) {
      setPendingSourceId(nextSourceId);
      return;
    }
    applyNewSourceWithSmartDefaults(nextSrc);
  };

  const handleConfirmKeepColumns = () => {
    if (!pendingSource) return;
    onUpdateBlock(block.id, "Trocar fonte mantendo colunas", (b) => {
      const remapped = remapColumnsForNewSource(b, pendingSourceColumns);
      return {
        ...b,
        source_id: pendingSource.id,
        options: remapped.options,
      };
    });
    setPendingSourceId(null);
  };

  const handlePopupKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (sourceOptions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % sourceOptions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + sourceOptions.length) % sourceOptions.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(sourceOptions.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const chosen = sourceOptions[activeIdx];
      if (chosen) handleChooseSource(chosen.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === "Tab") {
      closeMenu(false);
    }
  };

  // Mini-preview columns: prefer used columns present in schema, fallback to first 4 columns
  const miniPreviewCols = useMemo(() => {
    const colMap = new Map<string, ColumnInfo>();
    columnInfos.forEach((c) => colMap.set(c.name, c));
    const validUsed = usedColumns
      .map((name) => colMap.get(name))
      .filter((c): c is ColumnInfo => Boolean(c));
    if (validUsed.length > 0) return validUsed.slice(0, 6);
    return columnInfos.slice(0, 4);
  }, [columnInfos, usedColumns]);

  const miniPreviewColIndices = useMemo(
    () => miniPreviewCols.map((mc) => columnInfos.findIndex((c) => c.name === mc.name)),
    [columnInfos, miniPreviewCols],
  );

  // Check > 500 points limit on charts
  const isChart = block.type === "bar" || block.type === "line" || block.type === "pie";
  const overLimitPoints = useMemo(() => {
    if (!isChart || !rowsMeta.hasRows) return null;
    const opt = block.options || {};
    if (opt.x_group || opt.y_aggregate) return null;
    if (rowsMeta.totalRows > 500) return rowsMeta.totalRows;
    return null;
  }, [block.options, isChart, rowsMeta.hasRows, rowsMeta.totalRows]);

  const xColInfo = useMemo(
    () =>
      block.options?.x_field
        ? columnInfos.find((c) => c.name === block.options?.x_field)
        : columnInfos.find((c) => isDateCompatibleColumn(c)),
    [block.options?.x_field, columnInfos],
  );

  const currentSourceMeta = currentSource
    ? getSourceDisplayMeta(currentSource, availableSources)
    : null;
  const isSourceMissing = Boolean(block.source_id && !currentSource);

  const lineageText = currentSource
    ? formatSourceLineageLine({
        block,
        source: currentSource,
        columns: columnInfos,
        availableSources,
        totalRows: rowsMeta.hasRows ? rowsMeta.totalRows : null,
        isUnavailable: previewUnavailable,
      })
    : null;

  if (hidden) return null;

  if (block.type === "image") {
    return (
      <CollapsibleSection title="Fonte de dados" defaultOpen={true}>
        <p className="cv-field-hint">
          Blocos de imagem utilizam arquivos enviados na aba Conteúdo.
        </p>
      </CollapsibleSection>
    );
  }

  return (
    <>
      <CollapsibleSection
        title="Fonte de dados"
        defaultOpen={true}
        extra={
          <button
            type="button"
            className="cv-btn-compact"
            onClick={onOpenCreateSource}
            title="Adicionar nova fonte ao relatório"
          >
            <Plus size={12} aria-hidden="true" />
            Adicionar fonte
          </button>
        }
      >
        <div className="cv-field">
          <label htmlFor="insp-source-select" className="cv-label">
            Fonte vinculada
          </label>
          <div className="cv-col-select">
            <button
              id="insp-source-select"
              ref={triggerRef}
              type="button"
              role="combobox"
              aria-label="Fonte vinculada"
              aria-expanded={menuOpen}
              aria-haspopup="listbox"
              aria-controls={menuOpen ? listId : undefined}
              aria-invalid={isSourceMissing ? true : undefined}
              aria-describedby={isSourceMissing ? "insp-source-missing-err" : undefined}
              className="cv-col-select-trigger"
              onClick={() => (menuOpen ? closeMenu(true) : openMenu())}
              onKeyDown={(e) => {
                if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                  e.preventDefault();
                  openMenu();
                }
              }}
            >
              <span className="cv-col-select-val">
                {currentSource && currentSourceMeta ? (
                  <>
                    <SourceTypeIcon type={currentSource.type} />
                    <span className="cv-col-select-name">{currentSourceMeta.title}</span>
                    <span
                      className="cv-field-hint"
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      · {currentSourceMeta.subtitle}
                    </span>
                  </>
                ) : isSourceMissing ? (
                  <>
                    <span className="cv-col-select-name">{block.source_id}</span>
                    <span className="cv-col-missing-tag">Ausente</span>
                  </>
                ) : (
                  <span className="cv-col-select-placeholder">Escolher fonte…</span>
                )}
              </span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
          {isSourceMissing && (
            <p id="insp-source-missing-err" className="cv-field-error" role="alert">
              A fonte &ldquo;{block.source_id}&rdquo; foi removida. Escolha outra fonte.
            </p>
          )}
        </div>

        {menuOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={popupRef}
              className="cv-col-popup cv-root"
              style={{
                position: "fixed",
                left: popupPos.left,
                top: popupPos.top,
                width: popupPos.width,
                maxHeight: popupPos.maxHeight,
                transform: popupPos.up ? "translateY(-100%)" : "none",
              }}
              tabIndex={-1}
              onKeyDown={handlePopupKeyDown}
            >
              <div id={listId} role="listbox" aria-label="Fontes do relatório" className="cv-col-options">
                {sourceOptions.map((opt, idx) => {
                  const selected = opt.id === (block.source_id || "");
                  return (
                    <button
                      key={opt.id || "__none__"}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`cv-col-option ${idx === activeIdx ? "is-active" : ""}`.trim()}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleChooseSource(opt.id)}
                    >
                      <span
                        className="cv-col-option-left"
                        style={{ flexDirection: "column", alignItems: "flex-start", gap: "1px" }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          {opt.source && <SourceTypeIcon type={opt.source.type} />}
                          <span style={{ fontWeight: 500 }}>{opt.title}</span>
                        </span>
                        <span className="cv-col-option-reason">{opt.subtitle}</span>
                      </span>
                      {selected && <Check size={13} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )}

        {/* Estado vazio sem fonte */}
        {!block.source_id && (
          <div className="cv-empty-source-box">
            <span>
              {sources.length > 0
                ? "Selecione uma fonte existente ou adicione uma nova consulta."
                : "Nenhuma fonte cadastrada neste relatório."}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="cv-btn-compact primary"
                onClick={() => {
                  if (sources.length > 0) openMenu();
                  else onOpenCreateSource();
                }}
              >
                Escolher fonte
              </button>
              <button
                type="button"
                className="cv-btn-compact"
                onClick={onOpenCreateSource}
              >
                Adicionar fonte
              </button>
            </div>
          </div>
        )}

        {/* Confirmação de troca de fonte ("Manter colunas compatíveis?") */}
        {pendingSource && pendingRemapSummary && (
          <div className="cv-remap-prompt" role="region" aria-label="Confirmar troca de fonte">
            <strong>Manter colunas compatíveis?</strong>
            <span>
              {pendingSourceColumns.length > 0
                ? `${pendingRemapSummary.matchedCount} coluna(s) compatível(is) encontrada(s) em "${
                    pendingSource.label || pendingSource.id
                  }".${
                    pendingRemapSummary.missingColumns.length > 0
                      ? ` Não encontradas (ficarão marcadas para ajuste): ${pendingRemapSummary.missingColumns.join(", ")}.`
                      : ""
                  }`
                : `Trocar para "${
                    pendingSource.label || pendingSource.id
                  }". As colunas atuais serão preservadas para validação.`}
            </span>
            <div className="cv-remap-actions">
              <button
                type="button"
                className="cv-btn-compact primary"
                onClick={handleConfirmKeepColumns}
              >
                Manter colunas
              </button>
              <button
                type="button"
                className="cv-btn-compact"
                onClick={() => applyNewSourceWithSmartDefaults(pendingSource)}
              >
                Redefinir campos
              </button>
              <button
                type="button"
                className="cv-btn-compact"
                onClick={() => setPendingSourceId(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {currentSourceMeta && <p className="cv-source-breadcrumb">{currentSourceMeta.title} · {currentSourceMeta.subtitle}</p>}
        {/* Linhagem completa */}
        {currentSource && lineageText && (
          <div className="cv-field">
            <span className="cv-label">Linhagem</span>
            <button
              type="button"
              className="cv-lineage-btn"
              title={`${lineageText} — Clique para abrir os dados`}
              onClick={() => {
                setDrawerOpen(true);
                if (!rowsMeta.hasRows && !previewLoading && !previewUnavailable && onLoadPreview) {
                  onLoadPreview(false);
                }
              }}
            >
              <span className="cv-lineage-text">{lineageText}</span>
              <Eye size={13} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Aviso de limite de pontos (> 500) */}
        {overLimitPoints !== null && (
          <div className="cv-insp-problem is-warning" role="status">
            <div className="cv-insp-problem-body">
              <AlertTriangle size={13} aria-hidden="true" />
              <span className="cv-insp-problem-text">
                Gráfico aceita até 500 pontos — este tem {overLimitPoints.toLocaleString("pt-BR")};{" "}
                {xColInfo && (isDateCompatibleColumn(xColInfo) || xColInfo.type === "unknown")
                  ? "agrupe por mês."
                  : "agregue os valores."}
              </span>
            </div>
            <button
              type="button"
              className="cv-insp-fix-btn"
              disabled={previewUnavailable}
              title={
                previewUnavailable
                  ? "Requer atualização do servidor"
                  : "Aplicar agrupamento por mês"
              }
              onClick={() =>
                onUpdateBlock(block.id, "Agrupar gráfico por mês", (b) => ({
                  ...b,
                  options: {
                    ...b.options,
                    ...(xColInfo && !b.options?.x_field ? { x_field: xColInfo.name } : {}),
                    x_group:
                      xColInfo && (isDateCompatibleColumn(xColInfo) || xColInfo.type === "unknown")
                        ? "month"
                        : b.options?.x_group,
                    y_aggregate: b.options?.y_aggregate || "sum",
                  },
                }))
              }
            >
              Agrupar por mês
            </button>
          </div>
        )}
      </CollapsibleSection>

      {/* Mini-prévia (5 linhas x colunas usadas) */}
      {currentSource && (
        <CollapsibleSection
          title="Prévia dos dados"
          defaultOpen={true}
          extra={
            currentSource.type === "report" && onLoadPreview && !previewUnavailable ? (
              <button
                type="button"
                className="cv-icon-btn"
                style={{ width: 24, height: 24 }}
                disabled={previewLoading}
                title="Atualizar prévia da fonte"
                aria-label="Atualizar prévia da fonte"
                onClick={() => onLoadPreview(true)}
              >
                <RefreshCw size={12} className={previewLoading ? "spin" : ""} aria-hidden="true" />
              </button>
            ) : undefined
          }
        >
          {rowsMeta.hasRows && miniPreviewCols.length > 0 ? (
            <>
              <div className="cv-mini-preview-wrap">
                <table className="cv-mini-preview-table" aria-label="Mini-prévia das colunas">
                  <thead>
                    <tr>
                      {miniPreviewCols.map((col) => (
                        <th key={col.name}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <ColumnBadge type={col.type} looksLike={col.looks_like} />
                            <span>{col.name}</span>
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsMeta.rows.length === 0 ? (
                      <tr>
                        <td colSpan={miniPreviewCols.length}>Nenhuma linha retornada.</td>
                      </tr>
                    ) : (
                      rowsMeta.rows.slice(0, 5).map((row, rIdx) => (
                        <tr key={rIdx}>
                          {miniPreviewCols.map((col, mIdx) => {
                            const srcIdx = miniPreviewColIndices[mIdx];
                            const val = srcIdx >= 0 ? row[srcIdx] : null;
                            return (
                              <td key={col.name} title={formatCellValue(val, col.type)}>
                                {formatCellValue(val, col.type)}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {!hasConfiguredDataFields(block) &&
                columnInfos.some((c) => c.type !== "unknown" || Boolean(c.looks_like)) &&
                (block.type === "bar" ||
                  block.type === "line" ||
                  block.type === "pie" ||
                  block.type === "kpi") && (
                  <button
                    type="button"
                    className="cv-btn-compact"
                    onClick={() =>
                      onUpdateBlock(block.id, "Preencher colunas sugeridas", (b) => ({
                        ...b,
                        options: {
                          ...b.options,
                          ...computeSmartDefaults(b.type, columnInfos, {
                            isNewChart: !b.options?.series_colors,
                            existingOptions: b.options,
                          }),
                        },
                      }))
                    }
                  >
                    Preencher campos sugeridos
                  </button>
                )}
            </>
          ) : previewLoading ? (
            <p className="cv-field-hint">Carregando prévia…</p>
          ) : previewUnavailable ? (
            <p className="cv-field-hint">
              Prévia de dados indisponível nesta versão do servidor.
            </p>
          ) : previewError ? (
            <div className="cv-field">
              <p className="cv-field-error" role="alert">
                {previewError}
              </p>
              {onLoadPreview && (
                <button
                  type="button"
                  className="cv-btn-compact"
                  onClick={() => onLoadPreview(true)}
                >
                  Tentar novamente
                </button>
              )}
            </div>
          ) : onLoadPreview ? (
            <div className="cv-field">
              <p className="cv-field-hint">
                Carregue uma amostra de linhas para validar tipos e valores.
              </p>
              <button
                type="button"
                className="cv-btn-compact"
                onClick={() => onLoadPreview(false)}
              >
                <RefreshCw size={12} aria-hidden="true" />
                Carregar prévia
              </button>
            </div>
          ) : (
            <p className="cv-field-hint">Prévia não disponível.</p>
          )}
        </CollapsibleSection>
      )}

      {/* Gaveta Ver Dados com destaque das colunas usadas */}
      {drawerOpen && currentSource && (
        <>
          {usedColumns.length > 0 && (
            <div className="cv-drawer-used-bar cv-root" role="region" aria-label="Colunas usadas no bloco">
              <strong>Colunas usadas neste bloco:</strong>
              {usedColumns.map((colName) => {
                const info = columnInfos.find((c) => c.name === colName);
                return (
                  <span
                    key={colName}
                    className="cv-chip ready"
                    style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                  >
                    <ColumnBadge type={info?.type || "unknown"} looksLike={info?.looks_like} />
                    <span>{colName}</span>
                  </span>
                );
              })}
            </div>
          )}
          <DataDrawer
            source={currentSource}
            preview={preview}
            loading={previewLoading}
            onClose={() => setDrawerOpen(false)}
            onRefresh={onLoadPreview ? () => onLoadPreview(true) : undefined}
          />
        </>
      )}
    </>
  );
}
