import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Eye,
  Minus,
  MoreHorizontal,
  Plus,
  Redo2,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import { ThemeContext, ThemeProvider } from "../../../ThemeContext";
import { ThemeToggle } from "../../ThemeToggle";
import type { OutputFormat } from "../model";
import { clamp, round2 } from "../model";
import type { CanvasProblemItem, ProblemSeverity } from "./problems";
import {
  ConfirmEnableCanvasDialog,
  LeaveUnsavedDialog,
  MoreActionsMenu,
  ProblemsPopover,
  PublishPopover,
  ZoomMenu,
} from "./TopBarPopovers";

export type CanvasDataMode = "sample" | "preview";
type OpenPopover = "zoom" | "publish" | "more" | "problems" | null;

function useCompactTopbar(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(max-width: 1279px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 1279px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return compact;
}

export interface TopBarProps {
  reportName: string;
  version: number;
  enabled: boolean;
  outputFormat: OutputFormat;
  dirty: boolean;
  loading: boolean;
  busy: boolean;
  saveError?: string | null;
  canUndo?: boolean;
  canRedo?: boolean;
  undoLabel?: string | null;
  redoLabel?: string | null;
  onUndo?: () => void;
  onRedo?: () => void;
  zoom: number;
  onChangeZoom: (updater: (z: number) => number) => void;
  onFitToWidth: () => void;
  onFitToPage?: () => void;
  problemCount?: number;
  problemSeverity?: ProblemSeverity | null;
  problems?: CanvasProblemItem[];
  onOpenProblems?: () => void;
  onSelectProblem?: (item: CanvasProblemItem) => void;
  dataMode: CanvasDataMode;
  onChangeDataMode: (mode: CanvasDataMode) => void;
  onChangeEnabled: (enabled: boolean) => void;
  onChangeOutputFormat: (format: OutputFormat) => void;
  onOpenPreview: () => void;
  onSave: () => void;
  onSaveAndClose?: () => void;
  onClose: () => void;
}

function getToolbarButtons(root: HTMLElement | null): HTMLButtonElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")).filter(
    (btn) => !btn.closest('[data-cv-popover="true"]'),
  );
}

function ToolbarThemeToggle() {
  const ctx = useContext(ThemeContext);
  if (ctx) return <ThemeToggle className="cv-theme-toggle" />;
  return (
    <ThemeProvider>
      <ThemeToggle className="cv-theme-toggle" />
    </ThemeProvider>
  );
}

export default function TopBar({
  reportName,
  version,
  enabled,
  outputFormat,
  dirty,
  loading,
  busy,
  saveError,
  canUndo = false,
  canRedo = false,
  undoLabel = null,
  redoLabel = null,
  onUndo,
  onRedo,
  zoom,
  onChangeZoom,
  onFitToWidth,
  onFitToPage,
  problemCount = 0,
  problemSeverity = null,
  problems = [],
  onOpenProblems,
  onSelectProblem,
  dataMode,
  onChangeDataMode,
  onChangeEnabled,
  onChangeOutputFormat,
  onOpenPreview,
  onSave,
  onSaveAndClose,
  onClose,
}: TopBarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);
  const compact = useCompactTopbar();

  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [enableConfirmOpen, setEnableConfirmOpen] = useState(false);

  const zoomPercent = Math.round(zoom * 100);
  const undoTooltip =
    canUndo && undoLabel ? `Desfazer: ${undoLabel} (Ctrl+Z)` : "Desfazer (Ctrl+Z)";
  const redoTooltip =
    canRedo && redoLabel ? `Refazer: ${redoLabel} (Ctrl+Shift+Z)` : "Refazer (Ctrl+Shift+Z)";

  useEffect(() => {
    if (!dirty && leaveDialogOpen && !busy) {
      setLeaveDialogOpen(false);
    }
  }, [busy, dirty, leaveDialogOpen]);

  // Preserve natural Tab order; arrow keys remain available within the toolbar.
  useEffect(() => {
    const buttons = getToolbarButtons(toolbarRef.current);
    if (buttons.length === 0) return;
    const current =
      activeButtonRef.current && buttons.includes(activeButtonRef.current)
        ? activeButtonRef.current
        : buttons[0];
    activeButtonRef.current = current;
    buttons.forEach((btn) => {
      btn.tabIndex = 0;
    });
  });

  useEffect(() => {
    if (!openPopover) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolbarRef.current?.contains(target)) {
        const insideAnchor = (target as HTMLElement).closest?.("[data-cv-anchor]");
        if (insideAnchor) return;
      }
      setOpenPopover(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      setOpenPopover(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openPopover]);

  const handleToolbarFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.closest('[data-cv-popover="true"]')) return;
    activeButtonRef.current = target;
    const buttons = getToolbarButtons(toolbarRef.current);
    buttons.forEach((btn) => {
      btn.tabIndex = 0;
    });
  }, []);

  const handleToolbarKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-cv-popover="true"]')) return;
    if (
      event.key !== "ArrowRight" &&
      event.key !== "ArrowLeft" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const buttons = getToolbarButtons(toolbarRef.current);
    if (buttons.length === 0) return;
    event.preventDefault();
    const currentIdx = Math.max(
      0,
      buttons.findIndex((b) => b === document.activeElement || b === activeButtonRef.current),
    );
    let nextIdx = currentIdx;
    if (event.key === "ArrowRight") nextIdx = (currentIdx + 1) % buttons.length;
    else if (event.key === "ArrowLeft") nextIdx = (currentIdx - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") nextIdx = 0;
    else if (event.key === "End") nextIdx = buttons.length - 1;

    const nextBtn = buttons[nextIdx];
    if (nextBtn) {
      activeButtonRef.current = nextBtn;
      buttons.forEach((btn) => {
        btn.tabIndex = btn === nextBtn ? 0 : -1;
      });
      nextBtn.focus();
    }
  }, []);

  const handleBackClick = () => {
    if (dirty) {
      setLeaveDialogOpen(true);
    } else {
      onClose();
    }
  };

  const handleToggleEnabled = (next: boolean) => {
    if (next && !enabled) {
      setOpenPopover(null);
      setEnableConfirmOpen(true);
    } else {
      onChangeEnabled(next);
    }
  };

  const hasProblems = problemCount > 0;
  const resolvedSeverity: ProblemSeverity = problemSeverity === "warning" ? "warning" : "error";

  return (
    <>
      <header className="cv-topbar">
        <div
          ref={toolbarRef}
          className="cv-topbar-toolbar"
          role="toolbar"
          aria-label="Barra superior do editor"
          onFocus={handleToolbarFocus}
          onKeyDown={handleToolbarKeyDown}
        >
          <div className="cv-topbar-left">
            <button
              type="button"
              tabIndex={0}
              className="cv-btn cv-back-btn"
              aria-label="Voltar para Relatórios"
              disabled={busy}
              onClick={handleBackClick}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              <span>Relatórios</span>
            </button>

            <div className="cv-topbar-identity">
              <span className="cv-report-title" tabIndex={0} title={reportName}>
                {reportName}
              </span>
              <span
                className={`cv-status-chip ${enabled ? "is-active" : "is-draft"}`}
                aria-label={enabled ? "Estado: Ativo" : "Estado: Rascunho"}
              >
                {enabled ? "Ativo" : "Rascunho"}
              </span>
              <span className="cv-version-tag" title={`Versão ${version}`}>
                v{version}
              </span>
            </div>
          </div>

          <div className="cv-topbar-center">
            <div className="cv-topbar-cluster">
              <button
                type="button"
                tabIndex={0}
                className="cv-btn-icon"
                aria-label={undoTooltip}
                title={undoTooltip}
                disabled={!canUndo || loading || busy}
                onClick={() => onUndo?.()}
              >
                <Undo2 size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                tabIndex={0}
                className="cv-btn-icon"
                aria-label={redoTooltip}
                title={redoTooltip}
                disabled={!canRedo || loading || busy}
                onClick={() => onRedo?.()}
              >
                <Redo2 size={15} aria-hidden="true" />
              </button>
            </div>

            <span className="cv-topbar-sep" aria-hidden="true" />

            <div className="cv-topbar-cluster cv-zoom-cluster" data-cv-anchor="zoom">
              <button
                type="button"
                tabIndex={0}
                className="cv-btn-icon"
                aria-label="Reduzir zoom"
                title="Reduzir zoom"
                disabled={loading || zoom <= 0.25}
                onClick={() => onChangeZoom((z) => round2(clamp(z - 0.1, 0.25, 2)))}
              >
                <Minus size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                tabIndex={0}
                className="cv-btn cv-zoom-trigger"
                aria-label={`Zoom ${zoomPercent}%. Abrir menu de zoom`}
                aria-haspopup="menu"
                aria-expanded={openPopover === "zoom"}
                disabled={loading}
                onClick={() => setOpenPopover((p) => (p === "zoom" ? null : "zoom"))}
              >
                <span className="cv-mono">{zoomPercent} %</span>
              </button>
              <button
                type="button"
                tabIndex={0}
                className="cv-btn-icon"
                aria-label="Aumentar zoom"
                title="Aumentar zoom"
                disabled={loading || zoom >= 2}
                onClick={() => onChangeZoom((z) => round2(clamp(z + 0.1, 0.25, 2)))}
              >
                <Plus size={14} aria-hidden="true" />
              </button>

              {openPopover === "zoom" && (
                <ZoomMenu
                  zoomPercent={zoomPercent}
                  onSelectPreset={(pct) => onChangeZoom(() => pct / 100)}
                  onFitToWidth={onFitToWidth}
                  onFitToPage={onFitToPage ?? onFitToWidth}
                  onClose={() => setOpenPopover(null)}
                />
              )}
            </div>
          </div>

          <div className="cv-topbar-right">
            {hasProblems && (
              <div className="cv-popover-anchor" data-cv-anchor="problems">
                <button
                  type="button"
                  tabIndex={0}
                  className={`cv-btn cv-problems-btn is-${resolvedSeverity}`}
                  aria-label={`Problemas: ${problemCount}`}
                  aria-expanded={problems.length > 0 ? openPopover === "problems" : undefined}
                  onClick={() => {
                    onOpenProblems?.();
                    if (problems.length > 0) {
                      setOpenPopover((p) => (p === "problems" ? null : "problems"));
                    }
                  }}
                >
                  {resolvedSeverity === "error" ? (
                    <AlertCircle size={14} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={14} aria-hidden="true" />
                  )}
                  <span className="cv-problems-label">Problemas</span>
                  <span className="cv-problems-badge">{problemCount}</span>
                </button>
                {openPopover === "problems" && problems.length > 0 && (
                  <ProblemsPopover
                    problems={problems}
                    onSelectProblem={onSelectProblem}
                    onClose={() => setOpenPopover(null)}
                  />
                )}
              </div>
            )}

            <div className="cv-data-mode" role="group" aria-label="Dados exibidos nos blocos">
              <span className="cv-data-mode-prefix" aria-hidden="true">
                Dados:
              </span>
              <div className="cv-segmented">
                <button
                  type="button"
                  tabIndex={0}
                  aria-label="Dados: Exemplo"
                  aria-pressed={dataMode === "sample"}
                  title="Exemplo: os blocos exibem estrutura e valores sintéticos para montagem visual sem consultar a fonte real."
                  className={`cv-seg-btn ${dataMode === "sample" ? "is-active" : ""}`.trim()}
                  onClick={() => onChangeDataMode("sample")}
                >
                  Exemplo
                </button>
                <button
                  type="button"
                  tabIndex={0}
                  aria-label="Dados: Prévia"
                  aria-pressed={dataMode === "preview"}
                  title="Prévia: os blocos exibem dados reais carregados das fontes ou metas configuradas, sem valores fictícios."
                  className={`cv-seg-btn ${dataMode === "preview" ? "is-active" : ""}`.trim()}
                  onClick={() => onChangeDataMode("preview")}
                >
                  Prévia
                </button>
              </div>
            </div>

            {compact ? (
              <div className="cv-popover-anchor" data-cv-anchor="more">
                <button
                  type="button"
                  tabIndex={0}
                  className="cv-btn"
                  aria-label="Mais ações"
                  aria-haspopup="menu"
                  aria-expanded={openPopover === "more" || openPopover === "publish"}
                  onClick={() =>
                    setOpenPopover((p) => (p === "more" || p === "publish" ? null : "more"))
                  }
                >
                  <MoreHorizontal size={15} aria-hidden="true" />
                  <span>Mais</span>
                </button>
                {openPopover === "more" && (
                  <MoreActionsMenu
                    disabled={loading || busy}
                    onOpenPreview={onOpenPreview}
                    onOpenPublish={() => setOpenPopover("publish")}
                    onClose={() => setOpenPopover(null)}
                  />
                )}
                {openPopover === "publish" && (
                  <PublishPopover
                    enabled={enabled}
                    outputFormat={outputFormat}
                    disabled={loading || busy}
                    onToggleEnabled={handleToggleEnabled}
                    onChangeOutputFormat={onChangeOutputFormat}
                  />
                )}
              </div>
            ) : (
              <>
                <div className="cv-popover-anchor" data-cv-anchor="publish">
                  <button
                    type="button"
                    tabIndex={0}
                    className={`cv-btn ${openPopover === "publish" ? "is-open" : ""}`.trim()}
                    aria-label="Publicação"
                    aria-haspopup="dialog"
                    aria-expanded={openPopover === "publish"}
                    onClick={() => setOpenPopover((p) => (p === "publish" ? null : "publish"))}
                  >
                    <SlidersHorizontal size={14} aria-hidden="true" />
                    <span>Publicação</span>
                  </button>
                  {openPopover === "publish" && (
                    <PublishPopover
                      enabled={enabled}
                      outputFormat={outputFormat}
                      disabled={loading || busy}
                      onToggleEnabled={handleToggleEnabled}
                      onChangeOutputFormat={onChangeOutputFormat}
                    />
                  )}
                </div>

                <button
                  type="button"
                  tabIndex={0}
                  className="cv-btn"
                  aria-label="Gerar prévia do relatório"
                  disabled={loading || busy}
                  onClick={onOpenPreview}
                >
                  <Eye size={14} aria-hidden="true" />
                  <span>Prévia</span>
                </button>
              </>
            )}

            <ToolbarThemeToggle />

            <button
              type="button"
              tabIndex={0}
              className="cv-btn cv-btn-primary cv-save-btn"
              aria-label={dirty ? "Salvar alterações não salvas (Ctrl+S)" : "Salvar (Ctrl+S)"}
              title={dirty ? "Salvar alterações não salvas (Ctrl+S)" : "Salvar (Ctrl+S)"}
              disabled={loading || busy}
              onClick={onSave}
            >
              <span className="cv-save-dot-slot" aria-hidden="true">{dirty && <span className="cv-unsaved-dot" />}</span>
              <span>{busy ? "Salvando…" : "Salvar"}</span>
            </button>
          </div>
        </div>
      </header>

      <LeaveUnsavedDialog
        open={leaveDialogOpen}
        busy={busy}
        saveError={saveError}
        onCancel={() => setLeaveDialogOpen(false)}
        onDiscardAndLeave={() => {
          setLeaveDialogOpen(false);
          onClose();
        }}
        onSaveAndLeave={() => {
          if (onSaveAndClose) onSaveAndClose();
          else onSave();
        }}
      />

      <ConfirmEnableCanvasDialog
        open={enableConfirmOpen}
        outputFormat={outputFormat}
        onCancel={() => setEnableConfirmOpen(false)}
        onConfirm={() => {
          setEnableConfirmOpen(false);
          onChangeEnabled(true);
        }}
      />
    </>
  );
}
