import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { User, X } from "lucide-react";

export default function InlineDialog({
  title,
  subtitle,
  busy = false,
  onClose,
  children,
  footer,
  className = "",
}: {
  title: string;
  subtitle: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLElement>(null),
    close = useRef(onClose),
    locked = useRef(busy);
  close.current = onClose;
  locked.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (
      dialog.current?.querySelector<HTMLElement>("input,select,textarea") ||
      dialog.current?.querySelector<HTMLElement>("button")
    )?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !locked.current) close.current();
      if (event.key !== "Tab") return;
      const fields = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ) || [],
      ).filter((el) => el.offsetParent !== null);
      const first = fields[0],
        last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop observation-backdrop"
      onClick={() => !busy && onClose()}
    >
      <section
        className={`modal inline-dialog ${className}`}
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          aria-label="Fechar janela"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <header className="observation-header">
          <h2>{title}</h2>
          {subtitle && (
            <p
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <User size={14} aria-hidden="true" />
              {subtitle}
            </p>
          )}
        </header>
        <div className="inline-dialog-body">{children}</div>
        {footer && <div className="inline-dialog-actions">{footer}</div>}
      </section>
    </div>,
    document.body,
  );
}
