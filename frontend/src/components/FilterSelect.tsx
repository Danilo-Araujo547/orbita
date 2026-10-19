import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

type Option = { value: string; label: string; group: string };
function text(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{children?: ReactNode}>(child) ? text(child.props.children) : String(child)).join("");
}
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

export default function FilterSelect({ value, onChange, label, children }: {
  value: string; label: string; children: ReactNode;
  onChange: (event: { target: { value: string } }) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), searchInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [search, setSearch] = useState(""), [active, setActive] = useState(0);
  const [position, setPosition] = useState({left: 0, top: 0, width: 260, maxHeight: 320, transform: "none"});
  const options = useMemo(() => Children.toArray(children).filter(isValidElement).map(child => {
    const props = child.props as {value: string; children: ReactNode; "data-group"?: string};
    return {value: String(props.value), label: text(props.children), group: props["data-group"] || ""};
  }), [children]);
  const shown = options.filter(option => normalize(option.label).includes(normalize(search)));
  const selected = options.find(option => option.value === value);
  function place() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    const upwards = below < 220 && above > below;
    const height = Math.max(120, Math.min(340, upwards ? above : below));
    const width = Math.min(Math.max(rect.width, 260), innerWidth - 24);
    setPosition({left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), top: upwards ? rect.top - 6 : rect.bottom + 6, width, maxHeight: height, transform: upwards ? "translateY(-100%)" : "none"});
  }
  function close(restore = true) { setOpen(false); if (restore) trigger.current?.focus(); }
  function choose(option: Option) { onChange({target: {value: option.value}}); close(); }
  function show() { setSearch(""); setActive(Math.max(0, options.findIndex(option => option.value === value))); place(); setOpen(true); }
  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {document.removeEventListener("pointerdown", outside);window.removeEventListener("resize", place);window.removeEventListener("scroll", place, true);};
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({block: "nearest"}); }, [active, open, id]);
  return <div className="filter-select">
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} className={`filter-select-trigger ${open ? "is-open" : ""}`} onClick={() => open ? close() : show()} onKeyDown={event => {if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {event.preventDefault();show();}}}>
      <span>{selected?.label || "Selecione"}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={popup} className="filter-select-popup" style={{position:"fixed", ...position}} onKeyDown={event => {
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        setActive(index => event.key === "Home" ? 0 : event.key === "End" ? shown.length - 1 : Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
      } else if (event.key === "Enter" && shown[active]) {event.preventDefault();choose(shown[active]);}
      else if (event.key === "Escape") {event.preventDefault();event.stopPropagation();close();}
      else if (event.key === "Tab") close();
    }}>
      <div className="filter-select-search"><Search size={15} aria-hidden="true" /><input ref={searchInput} value={search} onChange={event => {setSearch(event.target.value);setActive(0);}} aria-label={`Buscar em ${label}`} aria-controls={`${id}-list`} aria-activedescendant={shown[active] ? `${id}-option-${active}` : undefined} role="combobox" aria-expanded="true" aria-autocomplete="list" placeholder="Buscar opção" /></div>
      <div id={`${id}-list`} role="listbox" aria-label={label} className="filter-select-list">
        {shown.map((option, index) => <div key={option.value}>
          {option.group && shown[index - 1]?.group !== option.group && <div className="filter-select-group">{option.group}</div>}
          <button id={`${id}-option-${index}`} type="button" role="option" aria-selected={option.value === value} tabIndex={-1} className={`filter-select-option ${active === index ? "is-active" : ""}`} onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
            <span>{option.label}</span>{option.value === value && <Check size={16} aria-hidden="true" />}
          </button>
        </div>)}
        {!shown.length && <p className="filter-select-empty" role="status">Nenhuma opção encontrada.</p>}
      </div>
    </div>, document.body)}
  </div>;
}
