import { useEffect, useId, useState } from "react";
import { Check } from "lucide-react";
import { HEX_COLOR_RE, SWATCH_COLORS, validColor } from "../../model";

export type ColorSwatch = string | { hex: string; label: string };

export interface ColorFieldProps {
  id?: string;
  label?: string;
  value: string;
  swatches?: readonly ColorSwatch[];
  disabled?: boolean;
  onChange: (hex: string) => void;
}

function isLightColor(hex: string): boolean {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return true;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.65;
}

export default function ColorField({
  id,
  label,
  value,
  swatches = SWATCH_COLORS,
  disabled = false,
  onChange,
}: ColorFieldProps) {
  const autoId = useId();
  const inputId = id || autoId;
  const errId = `${inputId}-err`;
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const handleTextChange = (raw: string) => {
    setDraft(raw);
    const trimmed = raw.trim();
    if (HEX_COLOR_RE.test(trimmed)) {
      setError(null);
      onChange(trimmed.toLowerCase());
    } else {
      setError("Informe uma cor hexadecimal no formato #rrggbb (ex.: #075b94).");
    }
  };

  const safeColor = validColor(value, "#075b94");

  return (
    <div className="cv-field">
      {label && (
        <label htmlFor={inputId} className="cv-label">
          {label}
        </label>
      )}
      <div className="cv-color-row">
        <input
          type="color"
          className="cv-color-picker"
          aria-label={label ? `Seletor de ${label.toLowerCase()}` : "Seletor de cor"}
          disabled={disabled}
          value={safeColor}
          onChange={(e) => {
            const hex = e.target.value.toLowerCase();
            setDraft(hex);
            setError(null);
            onChange(hex);
          }}
        />
        <input
          id={inputId}
          type="text"
          className="cv-input"
          maxLength={7}
          placeholder="#075b94"
          disabled={disabled}
          aria-label={label ? `${label} em hexadecimal` : "Código hexadecimal da cor"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          value={draft}
          onChange={(e) => handleTextChange(e.target.value)}
        />
      </div>
      {error && (
        <p id={errId} className="cv-field-error" role="alert">
          {error}
        </p>
      )}
      {swatches.length > 0 && (
        <div className="cv-swatch-list" role="group" aria-label={label ? `Amostras: ${label}` : "Amostras da paleta"}>
          {swatches.map((item) => {
            const hex = typeof item === "string" ? item : item.hex;
            const norm = hex.toLowerCase();
            const title = typeof item === "string" ? norm : `${item.label}`;
            const isSelected = safeColor === norm && !error;
            const checkColor = isLightColor(norm) ? "#0f2438" : "#ffffff";
            return (
              <button
                key={norm}
                type="button"
                disabled={disabled}
                aria-label={title}
                title={title}
                className={`cv-swatch-btn ${isSelected ? "is-selected" : ""}`.trim()}
                style={{ background: norm }}
                onClick={() => {
                  setDraft(norm);
                  setError(null);
                  onChange(norm);
                }}
              >
                {isSelected && (
                  <span className="cv-swatch-check" style={{ color: checkColor }} aria-hidden="true">
                    <Check size={13} strokeWidth={2.5} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
