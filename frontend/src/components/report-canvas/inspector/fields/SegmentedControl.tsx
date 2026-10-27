import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  id?: string;
  ariaLabel: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (value: T) => void;
}

export default function SegmentedControl<T extends string>({
  id,
  ariaLabel,
  options,
  value,
  disabled = false,
  disabledReason,
  onChange,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const enabledIndices = options
      .map((opt, idx) => (!disabled && !opt.disabled ? idx : -1))
      .filter((idx) => idx >= 0);
    if (!enabledIndices.length) return;

    const currentPos = enabledIndices.indexOf(options.findIndex((o) => o.value === value));
    let nextIdx = enabledIndices[0];
    if (e.key === "Home") {
      nextIdx = enabledIndices[0];
    } else if (e.key === "End") {
      nextIdx = enabledIndices[enabledIndices.length - 1];
    } else if (e.key === "ArrowRight") {
      nextIdx = enabledIndices[(currentPos + 1) % enabledIndices.length];
    } else if (e.key === "ArrowLeft") {
      nextIdx = enabledIndices[(currentPos - 1 + enabledIndices.length) % enabledIndices.length];
    }

    const chosen = options[nextIdx];
    if (chosen) {
      onChange(chosen.value);
      const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]');
      buttons?.[nextIdx]?.focus();
    }
  };

  const activeIdx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  return (
    <div
      id={id}
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      title={disabled && disabledReason ? disabledReason : undefined}
      className={`cv-seg-group ${disabled ? "is-disabled" : ""}`.trim()}
      onKeyDown={handleKeyDown}
    >
      {options.map((opt, idx) => {
        const checked = opt.value === value;
        const itemDisabled = disabled || Boolean(opt.disabled);
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={itemDisabled}
            tabIndex={idx === activeIdx ? 0 : -1}
            title={
              disabled
                ? disabledReason || "Controle desabilitado"
                : opt.disabled
                  ? opt.title || "Opção desabilitada"
                  : opt.title || opt.label
            }
            className="cv-seg-item"
            onClick={() => !itemDisabled && onChange(opt.value)}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
