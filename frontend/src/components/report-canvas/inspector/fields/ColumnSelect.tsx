import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronDown, Search } from "lucide-react";
import ColumnBadge from "../../data/ColumnBadge";
import type { ColumnDataType, ColumnInfo } from "../../model";

export function isNumericColumnAllowed(col: ColumnInfo): boolean {
  return col.type === "number" || col.type === "unknown" || col.looks_like === "number";
}

export function getDisabledNumericReason(type: ColumnDataType, looksLike?: string): string | null {
  if (type === "number" || type === "unknown" || looksLike === "number") return null;
  if (type === "date") return "Data — não pode ser somada";
  if (type === "datetime") return "Data e hora — não pode ser somada";
  if (type === "boolean") return "Booleano — não pode ser somado";
  return "Texto — não pode ser somado";
}

function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export interface ColumnSelectProps {
  id?: string;
  label?: string;
  ariaLabel?: string;
  value: string;
  columns: readonly ColumnInfo[];
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  onlyNumeric?: boolean;
  disabled?: boolean;
  error?: string;
  hideWarn?: boolean;
  onChange: (columnName: string) => void;
}

export default function ColumnSelect({
  id,
  label,
  ariaLabel,
  value,
  columns,
  placeholder = "Selecionar coluna…",
  allowEmpty = false,
  emptyLabel = "Nenhuma",
  onlyNumeric = false,
  disabled = false,
  error,
  hideWarn = false,
  onChange,
}: ColumnSelectProps) {
  const autoId = useId();
  const triggerId = id || autoId;
  const errId = `${triggerId}-err`;
  const warnId = `${triggerId}-warn`;
  const listId = `${autoId}-listbox`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [dropOver, setDropOver] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 240, maxHeight: 260, up: false });

  const selectedCol = useMemo(
    () => columns.find((c) => c.name === value) || null,
    [columns, value],
  );
  const isMissing = Boolean(value && columns.length > 0 && !selectedCol);
  const showUnknownWarn = Boolean(
    onlyNumeric && selectedCol && selectedCol.type === "unknown" && !error && !isMissing,
  );

  const items = useMemo(() => {
    const base = columns.map((c) => {
      const reason = onlyNumeric ? getDisabledNumericReason(c.type, c.looks_like) : null;
      return {
        col: c,
        value: c.name,
        label: c.name,
        disabled: Boolean(reason),
        reason,
      };
    });
    const list = allowEmpty
      ? [
          {
            col: null as ColumnInfo | null,
            value: "",
            label: emptyLabel,
            disabled: false,
            reason: null as string | null,
          },
          ...base,
        ]
      : base;
    if (!search.trim()) return list;
    const q = normalizeSearch(search);
    return list.filter((it) => normalizeSearch(it.label).includes(q));
  }, [allowEmpty, columns, emptyLabel, onlyNumeric, search]);

  const searchable = columns.length > 8;

  const updatePos = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < 200 && above > below;
    const width = Math.min(Math.max(rect.width, 232), window.innerWidth - 24);
    setPos({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: up ? rect.top - 4 : rect.bottom + 4,
      width,
      maxHeight: Math.max(110, Math.min(280, up ? above : below)),
      up,
    });
  };

  const openPopup = () => {
    if (disabled) return;
    setSearch("");
    const currentIdx = items.findIndex((i) => i.value === value && !i.disabled);
    const firstEnabled = items.findIndex((i) => !i.disabled);
    setActiveIdx(currentIdx >= 0 ? currentIdx : Math.max(0, firstEnabled));
    updatePos();
    setOpen(true);
  };

  const closePopup = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    (searchable ? searchInputRef.current : popupRef.current)?.focus();
    const onOutside = (e: PointerEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !popupRef.current?.contains(e.target as Node)
      ) {
        closePopup(false);
      }
    };
    const onRelayout = () => updatePos();
    document.addEventListener("pointerdown", onOutside);
    window.addEventListener("resize", onRelayout);
    window.addEventListener("scroll", onRelayout, true);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      window.removeEventListener("resize", onRelayout);
      window.removeEventListener("scroll", onRelayout, true);
    };
  }, [open, searchable]);

  const handlePopupKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const enabled = items.map((it, idx) => (it.disabled ? -1 : idx)).filter((idx) => idx >= 0);
      if (!enabled.length) return;
      if (e.key === "Home") setActiveIdx(enabled[0]);
      else if (e.key === "End") setActiveIdx(enabled[enabled.length - 1]);
      else if (e.key === "ArrowDown") {
        const next = enabled.find((idx) => idx > activeIdx) ?? enabled[0];
        setActiveIdx(next);
      } else {
        const prev = [...enabled].reverse().find((idx) => idx < activeIdx) ?? enabled[enabled.length - 1];
        setActiveIdx(prev);
      }
    } else if (e.key === "Enter" || (e.key === " " && !searchable)) {
      e.preventDefault();
      const item = items[activeIdx];
      if (item && !item.disabled) {
        onChange(item.value);
        closePopup(true);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePopup(true);
    } else if (e.key === "Tab") {
      closePopup(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDropOver(false);
    if (disabled) return;
    const raw = e.dataTransfer.getData("application/x-canvas-column");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as { column?: string; type?: ColumnDataType };
      if (!payload.column) return;
      const colInfo = columns.find((c) => c.name === payload.column) || {
        name: payload.column,
        type: payload.type || "unknown",
      };
      if (onlyNumeric && !isNumericColumnAllowed(colInfo)) return;
      onChange(payload.column);
    } catch {
      // Ignore malformed drag payload
    }
  };

  const effectiveError =
    error || (isMissing ? `A coluna "${value}" não existe na fonte atual.` : null);
  const describedBy = effectiveError ? errId : showUnknownWarn ? warnId : undefined;

  const wrapper = (
    <>
      <div className="cv-col-select">
        <button
          id={triggerId}
          ref={triggerRef}
          type="button"
          role="combobox"
          disabled={disabled}
          aria-label={ariaLabel || label || placeholder}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          aria-invalid={effectiveError ? true : undefined}
          aria-describedby={describedBy}
          className={`cv-col-select-trigger ${dropOver ? "is-drop-over" : ""}`.trim()}
          onClick={() => (open ? closePopup(true) : openPopup())}
          onKeyDown={(e) => {
            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              openPopup();
            }
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/x-canvas-column")) {
              e.preventDefault();
              setDropOver(true);
            }
          }}
          onDragLeave={() => setDropOver(false)}
          onDrop={handleDrop}
        >
          <span className="cv-col-select-val">
            {value ? (
              <>
                <ColumnBadge
                  type={selectedCol?.type || "unknown"}
                  looksLike={selectedCol?.looks_like}
                />
                <span className="cv-col-select-name">{value}</span>
                {isMissing && <span className="cv-col-missing-tag">Ausente</span>}
              </>
            ) : (
              <span className="cv-col-select-placeholder">{placeholder}</span>
            )}
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popupRef}
            className="cv-col-popup cv-root"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              maxHeight: pos.maxHeight,
              transform: pos.up ? "translateY(-100%)" : "none",
            }}
            tabIndex={-1}
            onKeyDown={handlePopupKeyDown}
          >
            {searchable && (
              <div className="cv-col-search">
                <Search size={13} aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Filtrar colunas…"
                  aria-label="Filtrar colunas"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setActiveIdx(0);
                  }}
                />
              </div>
            )}
            <div id={listId} role="listbox" aria-label={ariaLabel || label || "Colunas"} className="cv-col-options">
              {items.length === 0 ? (
                <div className="cv-field-hint" style={{ padding: "8px" }}>
                  {columns.length === 0
                    ? "Nenhuma coluna conhecida. Carregue a prévia na aba Dados."
                    : "Nenhuma coluna encontrada."}
                </div>
              ) : (
                items.map((it, idx) => {
                  const selected = it.value === value;
                  return (
                    <button
                      key={`${it.value || "__empty__"}-${idx}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      aria-disabled={it.disabled || undefined}
                      disabled={it.disabled}
                      title={
                        it.reason ||
                        (it.col?.type === "unknown" && onlyNumeric
                          ? "Tipo desconhecido, carregue a prévia"
                          : it.label)
                      }
                      className={`cv-col-option ${idx === activeIdx ? "is-active" : ""} ${
                        it.disabled ? "is-disabled" : ""
                      }`.trim()}
                      onMouseEnter={() => !it.disabled && setActiveIdx(idx)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (it.disabled) return;
                        onChange(it.value);
                        closePopup(true);
                      }}
                    >
                      <span className="cv-col-option-left">
                        {it.col && (
                          <ColumnBadge type={it.col.type} looksLike={it.col.looks_like} />
                        )}
                        <span className="cv-col-select-name">{it.label}</span>
                      </span>
                      {it.reason ? (
                        <span className="cv-col-option-reason">{it.reason}</span>
                      ) : selected ? (
                        <Check size={13} aria-hidden="true" />
                      ) : it.col?.sample?.[0] ? (
                        <span className="cv-col-option-reason">{it.col.sample[0]}</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );

  if (!label && !effectiveError && (!showUnknownWarn || hideWarn)) {
    return wrapper;
  }

  return (
    <div className="cv-field">
      {label && (
        <label htmlFor={triggerId} className="cv-label">
          {label}
        </label>
      )}
      {wrapper}
      {effectiveError && (
        <p id={errId} className="cv-field-error" role="alert">
          {effectiveError}
        </p>
      )}
      {showUnknownWarn && !hideWarn && (
        <p id={warnId} className="cv-field-warn">
          <AlertTriangle size={12} aria-hidden="true" />
          <span>Tipo desconhecido — carregue a prévia na aba Dados</span>
        </p>
      )}
    </div>
  );
}
