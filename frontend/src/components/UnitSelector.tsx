import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Cloud, Building2, Check } from "lucide-react";
import type { Unit } from "../types";

export default function UnitSelector({
  units,
  value,
  onChange,
  label,
  sidebar = false,
}: {
  units: Unit[];
  value: string;
  onChange: (slug: string) => void;
  label: string;
  sidebar?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 260,
    maxHeight: 350,
  });
  const chosen = units.find((u) => u.slug === value);
  function place() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 24);
    const top = rect.bottom + 8;
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top,
      width,
      maxHeight: Math.max(100, Math.min(350, window.innerHeight - top - 12)),
    });
  }
  function show() {
    place();
    setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (
        !container.current?.contains(e.target as Node) &&
        !menu.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    menu.current
      ?.querySelector<HTMLButtonElement>(`[aria-selected="true"]`)
      ?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  return (
    <div
      className={`unit-select ${sidebar ? "sidebar-unit-selector" : ""}`}
      ref={container}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
        if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const options = Array.from(
            menu.current?.querySelectorAll<HTMLButtonElement>(
              '[role="option"]',
            ) || [],
          );
          const current = options.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const index =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? options.length - 1
                : (current +
                    (e.key === "ArrowDown" ? 1 : -1) +
                    options.length) %
                  options.length;
          options[index]?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="unit-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={chosen?.name || value}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (!open && e.key === "ArrowDown") {
            e.preventDefault();
            show();
          }
        }}
      >
        {sidebar ? (
          <>
            <span className={`unit-avatar ${chosen?.logo ? "has-logo" : ""}`}>
              {chosen?.logo ? (
                <img src={chosen.logo} alt="" className="unit-logo-img" />
              ) : chosen?.remote ? (
                <Cloud size={18} aria-label="Instância remota" />
              ) : (
                chosen?.name.slice(0, 1) || "A"
              )}
            </span>
            <span className="unit-select-name">
              <strong>{chosen?.name || value}</strong>
              <small>
                {chosen?.remote ? `${chosen.instance_name} · Remota` : "Local"}
              </small>
            </span>
          </>
        ) : (
          <>
            {chosen?.logo ? (
              <span className="unit-logo-badge">
                <img src={chosen.logo} alt="" className="unit-logo-img" />
              </span>
            ) : chosen?.remote ? (
              <Cloud size={16} aria-label="Instância remota" />
            ) : (
              <Building2 size={15} />
            )}
            <span>{chosen?.name || value}</span>
          </>
        )}
        <ChevronDown size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="unit-select-options"
            style={{ position: "fixed", ...position, minWidth: 0 }}
            role="listbox"
            aria-label={label}
          >
            {units.map((u) => (
              <button
                type="button"
                key={u.slug}
                role="option"
                aria-selected={u.slug === value}
                onClick={() => {
                  onChange(u.slug);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                {u.logo ? (
                  <span className="unit-logo-badge">
                    <img src={u.logo} alt="" className="unit-logo-img" />
                  </span>
                ) : u.remote ? (
                  <Cloud size={17} aria-label="Instância remota" />
                ) : (
                  <Building2 size={17} />
                )}
                <span>
                  <strong>{u.name}</strong>
                  <small>
                    {u.remote
                      ? `${u.instance_name} · Remota${u.connection_state === "unavailable" ? " · Indisponível" : ""}`
                      : "Local"}
                  </small>
                </span>
                {u.slug === value && <Check size={15} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
