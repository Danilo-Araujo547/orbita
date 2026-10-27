import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export default function CanvasShell({
  onClose,
  title,
  children,
  footer,
  busy = false,
}: {
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
  busy?: boolean;
}) {
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOpenPopovers = (target?: EventTarget | null) => {
      const root = shellRef.current;
      if (!root) return;
      const openDetails = root.querySelectorAll<HTMLDetailsElement>(
        "details.cv-panel-settings[open]",
      );
      openDetails.forEach((el) => {
        if (!target || !(target instanceof Node) || !el.contains(target)) {
          el.open = false;
        }
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      closeOpenPopovers(event.target);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      closeOpenPopovers();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <main
      ref={shellRef}
      className="report-canvas-page cv-root"
      aria-label="Editor de relatório"
    >
      <header className="cv-page-header">
        <div className="cv-header-nav">
          <button
            type="button"
            className="cv-back"
            onClick={onClose}
            disabled={busy}
          >
            <ArrowLeft size={15} aria-hidden="true" />
            <span>Voltar</span>
          </button>
          <span className="cv-document-title" title={title}>{title}</span>
        </div>
        <div className="cv-header-main">{footer}</div>
      </header>
      <div className="cv-shell-body">{children}</div>
    </main>
  );
}
