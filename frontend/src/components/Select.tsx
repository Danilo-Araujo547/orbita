import {Children,isValidElement,useId,useLayoutEffect,useEffect,useRef,useState} from "react";
import type {ReactNode,SelectHTMLAttributes} from "react";
import {createPortal} from "react-dom";
import {Check,ChevronDown,Search} from "lucide-react";
import "./select.css";

type Choice={value:string;label:string;disabled:boolean;group:string};
const normalize=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
function text(node:ReactNode):string{return Children.toArray(node).map(n=>isValidElement<{children?:ReactNode}>(n)?text(n.props.children):String(n)).join("");}
function choices(nodes:ReactNode,group="",disabled=false):Choice[]{return Children.toArray(nodes).flatMap(n=>{
 if(!isValidElement<{children?:ReactNode;value?:string|number;label?:string;disabled?:boolean;"data-group"?:string}>(n))return [];
 const p=n.props;
 if(n.type === "option")return [{value:String(p.value ?? text(p.children)),label:p.label ?? text(p.children),disabled:disabled || !!p.disabled,group:p["data-group"] || group}];
 return choices(p.children,n.type === "optgroup" ? p.label || "" : group,disabled || !!p.disabled);
});}
export default function Select({children,label,...props}:SelectHTMLAttributes<HTMLSelectElement>&{label?:string}){
 const auto=useId(),id=props.id || auto;
 const native=useRef<HTMLSelectElement>(null),trigger=useRef<HTMLButtonElement>(null),popup=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
 const [open,setOpen]=useState(false),[search,setSearch]=useState(""),[active,setActive]=useState(0),[uncontrolled,setUncontrolled]=useState(String(props.defaultValue ?? "")),[accessibleLabel,setAccessibleLabel]=useState(label || props["aria-label"] || "Selecionar");
 const [position,setPosition]=useState({left:0,top:0,width:240,maxHeight:300,transform:"none"});
 const options=choices(children),value=props.value == null ? uncontrolled : String(props.value),selected=options.find(o=>o.value===value) || (props.value==null ? options[0] : undefined);
 const shown=options.filter(o=>normalize(o.label+" "+o.group).includes(normalize(search))),searchable=options.length>8;
 useLayoutEffect(()=>{
  const parent=trigger.current?.closest("label");
  const labelled=props["aria-labelledby"]?.split(" ").map(id=>document.getElementById(id)?.textContent || "").join(" ");
  const local=parent ? Array.from(parent.childNodes).filter(n=>n!==trigger.current?.parentElement).map(n=>n.textContent).join(" ").trim() : "";
  setAccessibleLabel(label || props["aria-label"] || labelled || local || props.title || "Selecionar");
 },[label,props["aria-label"],props["aria-labelledby"],props.title]);
 function place(){const r=trigger.current?.getBoundingClientRect();if(!r)return;
  const below=innerHeight-r.bottom-12,above=r.top-12,up=below<220 && above>below;
  const width=Math.min(Math.max(r.width,200),innerWidth-24);
  setPosition({left:Math.max(12,Math.min(r.left,innerWidth-width-12)),top:up?r.top-6:r.bottom+6,width,maxHeight:Math.max(90,Math.min(340,up?above:below)),transform:up?"translateY(-100%)":"none"});
 }
 function close(restore=true){setOpen(false);if(restore)trigger.current?.focus();}
 function show(){if(props.disabled)return;setSearch("");setActive(Math.max(0,options.findIndex(o=>o.value===value && !o.disabled)));place();setOpen(true);}
 function choose(o:Choice){if(o.disabled || !native.current)return;
  native.current.value=o.value;setUncontrolled(o.value);native.current.dispatchEvent(new Event("change",{bubbles:true}));close();
 }
 useEffect(()=>{if(props.disabled)setOpen(false);},[props.disabled]);
 useEffect(()=>{if(!open)return;
  (searchable?input.current:popup.current)?.focus();
  const outside=(e:PointerEvent)=>{if(!trigger.current?.contains(e.target as Node)&&!popup.current?.contains(e.target as Node))close(false);};
  document.addEventListener("pointerdown",outside);window.addEventListener("resize",place);window.addEventListener("scroll",place,true);
  return()=>{document.removeEventListener("pointerdown",outside);window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);};
 },[open]);
 useEffect(()=>{if(open)document.getElementById(`${auto}-option-${active}`)?.scrollIntoView({block:"nearest"});},[open,active,auto]);
 const onKeys=(e:React.KeyboardEvent)=>{
  if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)){
   e.preventDefault();const indices=shown.map((o,i)=>o.disabled?-1:i).filter(i=>i>=0);
   const next=e.key==="Home"?indices[0]:e.key==="End"?indices.at(-1):e.key==="ArrowDown"?indices.find(i=>i>active) ?? indices[0]:indices.slice().reverse().find(i=>i<active) ?? indices.at(-1);
   setActive(next ?? 0);
  }else if(e.key==="Enter" || e.key===" " && !searchable){e.preventDefault();if(shown[active])choose(shown[active]);}
  else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close();}
  else if(e.key==="Tab"){close();}
  else if(!searchable && e.key.length===1){const next=shown.findIndex(o=>!o.disabled&&normalize(o.label).startsWith(normalize(e.key)));if(next>=0)setActive(next);}
 };
 return <div className={`scv-select ${props.className || ""}`} style={props.style}>
  <select {...props} id={`${id}-native`} ref={native} className="scv-select-native" style={undefined} aria-hidden="true" tabIndex={-1} onInvalid={e=>{e.preventDefault();trigger.current?.focus();show();props.onInvalid?.(e);}}>{children}</select>
  <button id={id} ref={trigger} type="button" role="combobox" disabled={props.disabled} aria-label={accessibleLabel} aria-labelledby={props["aria-labelledby"]} aria-required={props.required} aria-invalid={props["aria-invalid"]} aria-describedby={props["aria-describedby"]} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?`${auto}-list`:undefined} className={`scv-select-trigger ${open?"is-open":""}`} title={selected?.label} onClick={e=>{e.preventDefault();open?close():show();}} onKeyDown={e=>{if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)){e.preventDefault();show();}}}>
   <span>{selected?.label || "Selecionar"}</span><ChevronDown size={15} aria-hidden="true"/>
  </button>
  {open && createPortal(<div ref={popup} data-select-popup="true" className="scv-select-popup" style={{position:"fixed",...position}} tabIndex={-1} onKeyDown={onKeys} onClick={e=>e.stopPropagation()}>
   {searchable && <div className="scv-select-search"><Search size={15} aria-hidden="true"/><input ref={input} role="combobox" aria-label={`Buscar em ${accessibleLabel}`} aria-expanded="true" aria-controls={`${auto}-list`} aria-activedescendant={shown[active]?`${auto}-option-${active}`:undefined} placeholder="Buscar…" value={search} onChange={e=>{setSearch(e.target.value);setActive(0);}}/></div>}
   <div id={`${auto}-list`} role="listbox" aria-label={accessibleLabel} aria-activedescendant={shown[active]?`${auto}-option-${active}`:undefined} className="scv-select-list">
    {shown.map((o,i)=><div key={`${o.value}-${i}`}>
      {o.group && shown[i-1]?.group!==o.group && <div className="scv-select-group">{o.group}</div>}
      <button type="button" role="option" id={`${auto}-option-${i}`} disabled={o.disabled} aria-selected={o.value===value} tabIndex={-1} className={`scv-select-option ${active===i?"is-active":""}`} onMouseEnter={()=>!o.disabled&&setActive(i)} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(o)}><span>{o.label}</span>{o.value===value&&<Check size={15} aria-hidden="true"/>}</button>
    </div>)}
    {!shown.length&&<p className="scv-select-empty">Nenhuma opção encontrada.</p>}
   </div>
  </div>,document.body)}
 </div>;
}
