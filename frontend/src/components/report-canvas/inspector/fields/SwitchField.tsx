import { useId } from "react";

export interface SwitchFieldProps {
  id?: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  disabledReason?: string;
  description?: string;
  onChange: (checked: boolean) => void;
}

export default function SwitchField({
  id,
  label,
  checked,
  disabled = false,
  disabledReason,
  description,
  onChange,
}: SwitchFieldProps) {
  const autoId = useId();
  const btnId = id || autoId;
  const descId = `${btnId}-desc`;

  return (
    <div className="cv-field">
      <div className="cv-switch-row">
        <label htmlFor={btnId} className="cv-label">
          {label}
        </label>
        <button
          id={btnId}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-describedby={description ? descId : undefined}
          disabled={disabled}
          title={disabled && disabledReason ? disabledReason : undefined}
          className="cv-switch-btn"
          onClick={() => !disabled && onChange(!checked)}
        >
          <span className="cv-switch-thumb" aria-hidden="true" />
        </button>
      </div>
      {description && (
        <p id={descId} className="cv-field-hint">
          {description}
        </p>
      )}
    </div>
  );
}
