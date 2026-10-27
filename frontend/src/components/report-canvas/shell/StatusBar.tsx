import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CanvasBlock } from "../model";
import type { CanvasLimitsSummary } from "../state/limits";

export interface StatusBarProps {
  dirty?: boolean;
  saving?: boolean;
  version?: number;
  hasSampleData?: boolean;
  selectedBlock?: CanvasBlock | null;
  limits?: CanvasLimitsSummary;
  children?: ReactNode;
}

export default function StatusBar({
  dirty = false,
  saving = false,
  version = 1,
  hasSampleData = false,
  selectedBlock = null,
  limits,
  children,
}: StatusBarProps) {
  const [limitsOpen, setLimitsOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!limitsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && anchorRef.current?.contains(event.target)) return;
      setLimitsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setLimitsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [limitsOpen]);

  const saveLabel = saving ? "Salvando…" : dirty ? "Alterações não salvas" : "Salvo";
  const saveModifier = saving ? "is-saving" : dirty ? "is-dirty" : "";

  const coordsText = selectedBlock
    ? `x ${Math.round(selectedBlock.x)} · y ${Math.round(selectedBlock.y)} · ${Math.round(selectedBlock.width)} × ${Math.round(selectedBlock.height)} px`
    : null;

  return (
    <footer className="cv-statusbar" aria-label="Barra de status do editor">
      <div className="cv-statusbar-left" role="status" aria-live="polite">
        <span className={`cv-save-indicator ${saveModifier}`.trim()}>{saveLabel}</span>
        <span aria-hidden="true">·</span>
        <span className="cv-version-tag">v{version}</span>
        {hasSampleData && (
          <>
            <span aria-hidden="true">·</span>
            <span className="cv-sample-indicator" title="Exibindo dados sintéticos de exemplo">
              Dados de exemplo
            </span>
          </>
        )}
        {children}
      </div>

      <div
        className="cv-statusbar-center"
        aria-label={coordsText ? "Posição e dimensões do bloco selecionado" : undefined}
      >
        {coordsText}
      </div>

      <div className="cv-statusbar-right">
        {limits && (
          <div ref={anchorRef} className="cv-popover-anchor">
            <button
              ref={triggerRef}
              type="button"
              className={`cv-limits-trigger ${limits.overallSeverity !== "ok" ? `is-${limits.overallSeverity}` : ""}`.trim()}
              aria-label="Limites de uso do relatório"
              aria-haspopup="dialog"
              aria-expanded={limitsOpen}
              onClick={() => setLimitsOpen((v) => !v)}
            >
              {limits.overallSeverity !== "ok" && (
                <span className="cv-limits-dot" aria-hidden="true" />
              )}
              <span>Limites</span>
            </button>

            {limitsOpen && (
              <div
                className="cv-popover cv-limits-popover"
                role="dialog"
                aria-label="Uso e limites do relatório"
              >
                {limits.items.map((metric) => {
                  const pct = Math.min(100, Math.max(0, Math.round(metric.ratio * 100)));
                  return (
                    <div
                      key={metric.key}
                      className={`cv-limit-row ${metric.severity !== "ok" ? `is-${metric.severity}` : ""}`.trim()}
                    >
                      <div className="cv-limit-row-top">
                        <span className="cv-limit-label">{metric.label}</span>
                        <span className="cv-limit-value">{metric.formatted}</span>
                      </div>
                      <div className="cv-limit-track" aria-hidden="true">
                        <div className="cv-limit-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </footer>
  );
}
