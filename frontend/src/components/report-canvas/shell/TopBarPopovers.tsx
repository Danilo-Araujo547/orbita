import { AlertCircle, AlertTriangle, Check, Eye, SlidersHorizontal } from "lucide-react";
import InlineDialog from "../../InlineDialog";
import type { OutputFormat } from "../model";
import type { CanvasProblemItem } from "./problems";

export const ZOOM_PRESETS = [50, 75, 100, 125, 150] as const;

export function ZoomMenu({
  zoomPercent,
  onSelectPreset,
  onFitToWidth,
  onFitToPage,
  onClose,
}: {
  zoomPercent: number;
  onSelectPreset: (pct: number) => void;
  onFitToWidth: () => void;
  onFitToPage: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="cv-popover cv-zoom-menu"
      role="menu"
      aria-label="Opções de zoom"
      data-cv-popover="true"
    >
      {ZOOM_PRESETS.map((pct) => {
        const active = zoomPercent === pct;
        return (
          <button
            key={pct}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            aria-label={`Zoom ${pct}%`}
            className={`cv-menu-item ${active ? "is-active" : ""}`.trim()}
            onClick={() => {
              onSelectPreset(pct);
              onClose();
            }}
          >
            <span className="cv-mono">{pct} %</span>
            {active && <Check size={13} aria-hidden="true" />}
          </button>
        );
      })}
      <div className="cv-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        aria-label="Ajustar à largura"
        className="cv-menu-item"
        onClick={() => {
          onFitToWidth();
          onClose();
        }}
      >
        <span>Ajustar à largura</span>
      </button>
      <button
        type="button"
        role="menuitem"
        aria-label="Ajustar à página"
        className="cv-menu-item"
        onClick={() => {
          onFitToPage();
          onClose();
        }}
      >
        <span>Ajustar à página</span>
      </button>
    </div>
  );
}

export function PublishPopover({
  enabled,
  outputFormat,
  disabled,
  onToggleEnabled,
  onChangeOutputFormat,
}: {
  enabled: boolean;
  outputFormat: OutputFormat;
  disabled: boolean;
  onToggleEnabled: (next: boolean) => void;
  onChangeOutputFormat: (fmt: OutputFormat) => void;
}) {
  return (
    <div
      className="cv-popover cv-publish-popover"
      role="dialog"
      aria-label="Configurações de publicação"
      data-cv-popover="true"
    >
      <label className="cv-publish-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          aria-label="Usar este canvas para gerar o relatório"
          onChange={(e) => onToggleEnabled(e.target.checked)}
        />
        <span>Usar este canvas para gerar o relatório</span>
      </label>

      <div className="cv-publish-format">
        <span className="cv-field-label">Formato de saída</span>
        <div className="cv-segmented" role="group" aria-label="Formato de saída do relatório">
          <button
            type="button"
            aria-label="Formato PDF"
            aria-pressed={outputFormat === "pdf"}
            disabled={disabled}
            className={`cv-seg-btn ${outputFormat === "pdf" ? "is-active" : ""}`.trim()}
            onClick={() => onChangeOutputFormat("pdf")}
          >
            PDF
          </button>
          <button
            type="button"
            aria-label="Formato XLSX"
            aria-pressed={outputFormat === "xlsx"}
            disabled={disabled}
            className={`cv-seg-btn ${outputFormat === "xlsx" ? "is-active" : ""}`.trim()}
            onClick={() => onChangeOutputFormat("xlsx")}
          >
            XLSX
          </button>
        </div>
      </div>
    </div>
  );
}

export function MoreActionsMenu({
  disabled,
  onOpenPreview,
  onOpenPublish,
  onClose,
}: {
  disabled: boolean;
  onOpenPreview: () => void;
  onOpenPublish: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="cv-popover cv-more-menu"
      role="menu"
      aria-label="Mais ações"
      data-cv-popover="true"
    >
      <button
        type="button"
        role="menuitem"
        aria-label="Publicação"
        className="cv-menu-item"
        onClick={onOpenPublish}
      >
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span>Publicação</span>
      </button>
      <button
        type="button"
        role="menuitem"
        aria-label="Prévia"
        disabled={disabled}
        className="cv-menu-item"
        onClick={() => {
          onClose();
          onOpenPreview();
        }}
      >
        <Eye size={14} aria-hidden="true" />
        <span>Prévia</span>
      </button>
    </div>
  );
}

export function ProblemsPopover({
  problems,
  onSelectProblem,
  onClose,
}: {
  problems: CanvasProblemItem[];
  onSelectProblem?: (item: CanvasProblemItem) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="cv-popover cv-problems-popover"
      role="dialog"
      aria-label="Problemas detectados no relatório"
      data-cv-popover="true"
    >
      <div className="cv-popover-head">
        <strong>Problemas ({problems.length})</strong>
      </div>
      <div className="cv-problems-list">
        {problems.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.message}
            className={`cv-problem-row is-${item.severity}`}
            onClick={() => {
              onSelectProblem?.(item);
              onClose();
            }}
          >
            {item.severity === "error" ? (
              <AlertCircle size={14} aria-hidden="true" />
            ) : (
              <AlertTriangle size={14} aria-hidden="true" />
            )}
            <span>{item.message}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LeaveUnsavedDialog({
  open,
  busy,
  saveError,
  onCancel,
  onDiscardAndLeave,
  onSaveAndLeave,
}: {
  open: boolean;
  busy: boolean;
  saveError?: string | null;
  onCancel: () => void;
  onDiscardAndLeave: () => void;
  onSaveAndLeave: () => void;
}) {
  if (!open) return null;
  return (
    <InlineDialog
      title="Sair sem salvar?"
      subtitle=""
      busy={busy}
      onClose={onCancel}
      className="cv-root cv-dialog"
      footer={
        <>
          <button
            type="button"
            className="cv-btn"
            aria-label="Cancelar e continuar editando"
            disabled={busy}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="cv-btn cv-btn-danger"
            aria-label="Sair sem salvar alterações"
            disabled={busy}
            onClick={onDiscardAndLeave}
          >
            Sair sem salvar
          </button>
          <button
            type="button"
            className="cv-btn cv-btn-primary"
            aria-label="Salvar alterações e sair"
            disabled={busy}
            onClick={onSaveAndLeave}
          >
            {busy ? "Salvando…" : "Salvar e sair"}
          </button>
        </>
      }
    >
      <div className="cv-dialog-stack">
        <p className="cv-dialog-text">
          Existem alterações não salvas neste relatório. Salve antes de voltar à lista ou descarte as mudanças locais.
        </p>
        {saveError && (
          <p className="cv-dialog-alert" role="alert">
            {saveError}
          </p>
        )}
      </div>
    </InlineDialog>
  );
}

export function ConfirmEnableCanvasDialog({
  open,
  outputFormat,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  outputFormat: OutputFormat;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <InlineDialog
      title="Usar este canvas para gerar o relatório?"
      subtitle=""
      onClose={onCancel}
      className="cv-root cv-dialog"
      footer={
        <>
          <button
            type="button"
            className="cv-btn"
            aria-label="Cancelar ativação"
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="cv-btn cv-btn-primary"
            aria-label="Confirmar geração por este canvas"
            onClick={onConfirm}
          >
            Ativar ao salvar
          </button>
        </>
      }
    >
      <p className="cv-dialog-text">
        Ao salvar o relatório, as próximas execuções e envios passarão a ser gerados por este Canvas no formato{" "}
        <strong>{outputFormat.toUpperCase()}</strong>.
      </p>
    </InlineDialog>
  );
}
