import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}

export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled = false,
  compact = false,
  className = "",
  children,
}: EmptyStateProps) {
  return (
    <div
      className={`cv-empty-state ${compact ? "is-compact" : ""} ${className}`.trim()}
      role="status"
    >
      <h3 className="cv-empty-state-title">{title}</h3>
      {description && <p className="cv-empty-state-desc">{description}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          className="cv-btn-secondary cv-empty-state-action"
          disabled={actionDisabled}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
      {children}
    </div>
  );
}
