import { Calendar, Clock } from "lucide-react";
import type { ColumnDataType } from "../model";
import { formatColumnTypeLabel, getColumnTypeAriaLabel } from "./columnTypes";

export interface ColumnBadgeProps {
  type?: ColumnDataType;
  looksLike?: string;
  className?: string;
}

export default function ColumnBadge({ type = "unknown", looksLike, className = "" }: ColumnBadgeProps) {
  const ariaLabel = getColumnTypeAriaLabel(type, looksLike);
  const title = formatColumnTypeLabel(type, looksLike);
  const modClass = `is-${type}`;

  return (
    <span
      className={`cv-type-badge ${modClass} ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
      title={title}
    >
      {type === "number" && (
        <span className="cv-type-glyph num" aria-hidden="true">
          123
        </span>
      )}
      {type === "date" && <Calendar size={12} aria-hidden="true" />}
      {type === "datetime" && <Clock size={12} aria-hidden="true" />}
      {type === "boolean" && (
        <span className="cv-type-glyph bool" aria-hidden="true">
          ✓/✗
        </span>
      )}
      {type === "text" && (
        <span className="cv-type-glyph txt" aria-hidden="true">
          Aa
        </span>
      )}
      {type === "unknown" && (
        <span className="cv-type-glyph unk" aria-hidden="true">
          —
        </span>
      )}
    </span>
  );
}
