import { useId, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  hidden?: boolean;
  extra?: ReactNode;
  children: ReactNode;
}

export default function CollapsibleSection({
  title,
  defaultOpen = true,
  hidden = false,
  extra,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  if (hidden) return null;

  return (
    <section className="cv-insp-section">
      <div className="cv-insp-section-head">
        <button
          type="button"
          className="cv-insp-section-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronRight
            size={13}
            aria-hidden="true"
            className={`cv-insp-section-chevron ${open ? "is-open" : ""}`}
          />
          <span>{title}</span>
        </button>
        {extra && <div className="cv-insp-section-extra">{extra}</div>}
      </div>
      {open && (
        <div id={bodyId} className="cv-insp-section-body">
          {children}
        </div>
      )}
    </section>
  );
}
