import { useEffect, useId, useState } from "react";

export interface NumberFieldProps {
  id?: string;
  label?: string;
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  externalError?: string;
  onChange: (value: number) => void;
}

export default function NumberField({
  id,
  label,
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled = false,
  externalError,
  onChange,
}: NumberFieldProps) {
  const autoId = useId();
  const inputId = id || autoId;
  const errId = `${inputId}-err`;
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!focused) {
      setDraft(String(value));
      setLocalError(null);
    }
  }, [value, focused]);

  const validateText = (raw: string): number | null => {
    const trimmed = raw.trim().replace(",", ".");
    if (!trimmed) {
      setLocalError(`Informe um valor entre ${min} e ${max}${unit ? ` ${unit}` : ""}.`);
      return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setLocalError("Informe um número válido.");
      return null;
    }
    if (step === 1 && !Number.isInteger(parsed)) {
      setLocalError("Informe um número inteiro.");
      return null;
    }
    if (parsed < min || parsed > max) {
      setLocalError(`Deve estar entre ${min} e ${max}${unit ? ` ${unit}` : ""}.`);
      return null;
    }
    setLocalError(null);
    return parsed;
  };

  const errorMsg = localError || externalError || null;

  return (
    <div className="cv-field">
      {label && (
        <label htmlFor={inputId} className="cv-label">
          {label}
        </label>
      )}
      <div className={`cv-num-wrap ${unit ? "" : "no-unit"}`.trim()}>
        <input
          id={inputId}
          type="number"
          className="cv-input"
          aria-label={ariaLabel || label}
          aria-invalid={errorMsg ? true : undefined}
          aria-describedby={errorMsg ? errId : undefined}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={draft}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            const parsed = validateText(draft);
            if (parsed !== null && parsed !== value) {
              onChange(parsed);
            }
          }}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            const parsed = validateText(next);
            if (parsed !== null) {
              onChange(parsed);
            }
          }}
        />
        {unit && <span className="cv-num-unit">{unit}</span>}
      </div>
      {errorMsg && (
        <p id={errId} className="cv-field-error" role="alert">
          {errorMsg}
        </p>
      )}
    </div>
  );
}
