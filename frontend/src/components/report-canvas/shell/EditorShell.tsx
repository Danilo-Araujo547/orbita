import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface EditorShellProps {
  children: ReactNode;
  canSave?: boolean;
  onSave?: () => void;
  onToggleLeftPanel?: () => void;
}

export function computeFitToPageZoom(
  stageEl: HTMLElement | null,
  pageWidth: number,
  pageHeight: number,
): number | null {
  if (!stageEl || pageWidth <= 0 || pageHeight <= 0) return null;
  const availW = Math.max(200, stageEl.clientWidth - 64);
  const availH = Math.max(200, stageEl.clientHeight - 56);
  const ratio = Math.min(availW / pageWidth, availH / pageHeight);
  const rounded = Math.floor(ratio * 100) / 100;
  return Math.max(0.25, Math.min(1.5, rounded));
}

export default function EditorShell({
  children,
  canSave = true,
  onSave,
  onToggleLeftPanel,
}: EditorShellProps) {
  const shellRef = useRef<HTMLElement>(null);
  const saveRef = useRef(onSave);
  const canSaveRef = useRef(canSave);
  const toggleLeftRef = useRef(onToggleLeftPanel);
  saveRef.current = onSave;
  canSaveRef.current = canSave;
  toggleLeftRef.current = onToggleLeftPanel;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hasModal = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
      const mod = event.ctrlKey || event.metaKey;

      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!hasModal && canSaveRef.current) {
          saveRef.current?.();
        }
        return;
      }

      if (mod && !event.altKey && !event.shiftKey && (event.key === "\\" || event.code === "Backslash")) {
        event.preventDefault();
        if (!hasModal) {
          toggleLeftRef.current?.();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <main
      ref={shellRef}
      className="report-canvas-page cv-root"
      aria-label="Editor de relatório"
    >
      {children}
    </main>
  );
}
