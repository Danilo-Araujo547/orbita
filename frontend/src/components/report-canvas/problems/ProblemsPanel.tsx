import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AlertCircle, AlertTriangle, ArrowRight, Wrench, X } from "lucide-react";
import type { CanvasProblemItem } from "../shell/problems";

export interface ProblemsPanelProps {
  open: boolean;
  problems: CanvasProblemItem[];
  activePageId?: string;
  onClose: () => void;
  onSelectProblem: (item: CanvasProblemItem) => void;
  onFixProblem?: (item: CanvasProblemItem) => void;
}

export default function ProblemsPanel({
  open,
  problems,
  onClose,
  onSelectProblem,
  onFixProblem,
}: ProblemsPanelProps) {
  const [height, setHeight] = useState(220);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHRef = useRef(220);

  const errorCount = useMemo(
    () => problems.filter((p) => p.severity === "error").length,
    [problems],
  );
  const warningCount = useMemo(
    () => problems.filter((p) => p.severity === "warning").length,
    [problems],
  );

  const groupedByPage = useMemo(() => {
    const map = new Map<string, { pageName: string; items: CanvasProblemItem[] }>();
    for (const item of problems) {
      const key = item.pageId || "general";
      const pageName = item.pageName || (item.pageId ? `Página ${item.pageId}` : "Geral");
      let grp = map.get(key);
      if (!grp) {
        grp = { pageName, items: [] };
        map.set(key, grp);
      }
      grp.items.push(item);
    }
    return Array.from(map.entries());
  }, [problems]);

  const handleResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      isResizingRef.current = true;
      startYRef.current = e.clientY;
      startHRef.current = height;

      function onPointerMove(moveEvent: PointerEvent) {
        if (!isResizingRef.current) return;
        const delta = startYRef.current - moveEvent.clientY;
        const next = Math.max(140, Math.min(500, startHRef.current + delta));
        setHeight(next);
      }

      function onPointerUp() {
        isResizingRef.current = false;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      }

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [height],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="cv-problems-panel cv-root"
      style={{ height: `${height}px` }}
      role="region"
      aria-label="Painel de Problemas do Relatório"
    >
      {/* Top Resizer Handle */}
      <div
        className="cv-problems-resizer"
        onPointerDown={handleResizeStart}
        title="Arrastar para redimensionar painel de problemas"
        aria-hidden="true"
      />

      {/* Header */}
      <div className="cv-problems-panel-header">
        <div className="cv-problems-panel-title">
          <strong>Problemas</strong>
          <span className="cv-problems-count">({problems.length})</span>
          {errorCount > 0 && (
            <span className="cv-problems-badge-pill is-error">
              <AlertCircle size={12} aria-hidden="true" />
              {errorCount} {errorCount === 1 ? "erro" : "erros"}
            </span>
          )}
          {warningCount > 0 && (
            <span className="cv-problems-badge-pill is-warning">
              <AlertTriangle size={12} aria-hidden="true" />
              {warningCount} {warningCount === 1 ? "aviso" : "avisos"}
            </span>
          )}
        </div>

        <button
          type="button"
          className="cv-btn-icon cv-problems-panel-close"
          aria-label="Fechar painel de problemas"
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      {/* Content list */}
      <div className="cv-problems-panel-content">
        {problems.length === 0 ? (
          <div className="cv-problems-empty">
            <p>Nenhum problema encontrado neste relatório.</p>
          </div>
        ) : (
          groupedByPage.map(([pageKey, group]) => (
            <div key={pageKey} className="cv-problems-page-group">
              <div className="cv-problems-page-title">{group.pageName}</div>
              <div className="cv-problems-page-items">
                {group.items.map((item) => (
                  <div
                    key={item.id}
                    className={`cv-problems-item-card is-${item.severity}`}
                    onClick={() => onSelectProblem(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectProblem(item);
                      }
                    }}
                  >
                    <div className="cv-problems-item-icon">
                      {item.severity === "error" ? (
                        <AlertCircle size={15} aria-hidden="true" />
                      ) : (
                        <AlertTriangle size={15} aria-hidden="true" />
                      )}
                    </div>

                    <div className="cv-problems-item-body">
                      {item.blockTitle && (
                        <span className="cv-problems-item-block">{item.blockTitle}</span>
                      )}
                      <p className="cv-problems-item-msg">{item.message}</p>
                    </div>

                    {item.blockId && (
                      <button
                        type="button"
                        className="cv-btn cv-problems-item-fix"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onFixProblem) onFixProblem(item);
                          else onSelectProblem(item);
                        }}
                      >
                        <Wrench size={12} aria-hidden="true" />
                        <span>Corrigir</span>
                      </button>
                    )}

                    <div className="cv-problems-item-arrow" aria-hidden="true">
                      <ArrowRight size={14} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
