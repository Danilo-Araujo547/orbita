import {useId,useState} from "react";
import {Plus,Pencil,Trash2,ScanSearch} from "lucide-react";
import Select from "./Select";
import InlineDialog from "./InlineDialog";
import {readParameterSchema,renameParameter,queryParameters,suggestedParameter} from "./reportParameters";
import type {ParameterSpec,ParameterSchema} from "./reportParameters";
import {displayParameter,collectTestParameters} from "./report-canvas/parameters";
import "./report-parameter-editor.css";
const kinds:Record<string,string>={date:"Data",integer:"Número inteiro",number:"Número decimal",string:"Texto"};
type Draft={previous:string;name:string;spec:ParameterSpec;defaultValue:string};
export default function ReportParameterEditor({value,onChange,sql=""}:{value:string;onChange:(value:string)=>void;sql?:string}){
 const [draft,setDraft]=useState<Draft|null>(null),[error,setError]=useState("");const formId=useId();
 let schema:ParameterSchema;try{schema=readParameterSchema(value);}catch{return <p className="inline-error">Não foi possível ler os parâmetros cadastrados.</p>;}
 const entries=Object.entries(schema).sort((a,b)=>(a[1].order ?? 100)-(b[1].order ?? 100));
 const missing=queryParameters(sql).filter(name=>!Object.hasOwn(schema,name));
 function edit(name="",spec:ParameterSpec={type:"string",required:true,order:entries.length+1}){setError("");setDraft({previous:name,name,spec:{...spec},defaultValue:displayParameter(spec.default,spec.type)});}
 function patch(next:Partial<ParameterSpec>){if(draft)setDraft({...draft,spec:{...draft.spec,...next}});}
 function save(e:React.FormEvent){e.preventDefault();e.stopPropagation();if(!draft)return;
  try{
   const spec={...draft.spec,label:draft.spec.label?.trim() || draft.name,order:Number(draft.spec.order)||entries.length+1};
   if(spec.minimum!=null&&spec.maximum!=null&&spec.minimum>spec.maximum)throw new Error("O mínimo deve ser menor ou igual ao máximo.");
   if(spec.not_before===draft.name)throw new Error("A data de referência deve ser outro parâmetro.");
   if(spec.type!=="date")delete spec.not_before;
   if(!["integer","number"].includes(spec.type)){delete spec.minimum;delete spec.maximum;}
   if(draft.defaultValue.trim())spec.default=collectTestParameters([{...spec,name:draft.name,label:spec.label,required:false,not_before:undefined}],{[draft.name]:draft.defaultValue})[draft.name];
   else delete spec.default;
   onChange(JSON.stringify(renameParameter(schema,draft.previous,draft.name.trim(),spec),null,2));setDraft(null);
  }catch(e){setError((e as Error).message);}
 }
 return <section className="report-parameter-editor" aria-label="Cadastro de parâmetros">
  <div className="rpe-heading"><strong>Parâmetros <small>{entries.length}</small></strong><div>
   {sql.trim()&&<button type="button" className="button" disabled={!missing.length} onClick={()=>{
    const next={...schema};missing.forEach((name,i)=>{next[name]=suggestedParameter(name,entries.length+i+1);});
    if(Object.keys(next).length>30){setError("A consulta excede o limite de 30 parâmetros.");return;}
    onChange(JSON.stringify(next,null,2));setError("");
   }}><ScanSearch size={14}/>Identificar na query{missing.length?` (${missing.length})`:""}</button>}
   <button type="button" className="button" onClick={()=>edit()}><Plus size={14}/>Adicionar parâmetro</button>
  </div></div>
  {error&&!draft&&<p className="inline-error" role="alert">{error}</p>}
  {!entries.length?<p className="rpe-empty">Nenhum parâmetro cadastrado.</p>:<div className="rpe-list">
   {entries.map(([name,spec],i)=><div className="rpe-row" key={name}>
    <span className="rpe-order">{spec.order || i+1}</span><div className="rpe-name"><strong>{spec.label || name}</strong><code>:{name}</code></div>
    <span className="rpe-type">{kinds[spec.type] || spec.type}</span><span className="rpe-required">{spec.required===false?"Opcional":"Obrigatório"}</span>
    <button type="button" className="icon-button" aria-label={`Editar parâmetro ${name}`} onClick={()=>edit(name,spec)}><Pencil size={14}/></button>
    <button type="button" className="icon-button" aria-label={`Remover parâmetro ${name}`} onClick={()=>{
     const next={...schema};delete next[name];for(const [key,s] of Object.entries(next)){if(s.not_before===name){next[key]={...s};delete next[key].not_before;}}
     onChange(JSON.stringify(next,null,2));
    }}><Trash2 size={14}/></button>
   </div>)}
  </div>}
  {draft&&<InlineDialog title={draft.previous?"Editar parâmetro":"Adicionar parâmetro"} subtitle="" className="rpe-dialog" onClose={()=>setDraft(null)} footer={<><button type="button" className="button" onClick={()=>setDraft(null)}>Cancelar</button><button type="submit" form={formId} className="button primary">Aplicar parâmetro</button></>}>
   <form id={formId} className="rpe-form" onSubmit={save}>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="rpe-grid">
     <label className="op-field"><span>Nome na query</span><input autoFocus required maxLength={50} value={draft.name} placeholder="data_inicial" onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
     <label className="op-field"><span>Nome exibido</span><input maxLength={100} value={draft.spec.label || ""} placeholder="Data inicial" onChange={e=>patch({label:e.target.value})}/></label>
     <label className="op-field"><span>Tipo</span><Select value={draft.spec.type} onChange={e=>{const type=e.target.value;setDraft({...draft,spec:{...draft.spec,type},defaultValue:""});}}>{Object.entries(kinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></label>
     <label className="op-field"><span>Ordem de solicitação</span><input type="number" required min={1} max={10000} value={draft.spec.order ?? 1} onChange={e=>patch({order:Number(e.target.value)})}/></label>
     <label className="op-field"><span>Valor padrão · Opcional</span><input value={draft.defaultValue} placeholder={draft.spec.type==="date"?"DD/MM/AAAA":undefined} onChange={e=>setDraft({...draft,defaultValue:e.target.value})}/></label>
     {draft.spec.type==="date"&&<label className="op-field"><span>Não anterior a</span><Select value={draft.spec.not_before || ""} onChange={e=>patch({not_before:e.target.value || undefined})}><option value="">Sem restrição</option>{entries.filter(([name,s])=>name!==draft.previous&&s.type==="date").map(([name,s])=><option key={name} value={name}>{s.label || name}</option>)}</Select></label>}
     {["integer","number"].includes(draft.spec.type)&&<><label className="op-field"><span>Mínimo · Opcional</span><input type="number" step={draft.spec.type==="integer"?1:"any"} value={draft.spec.minimum ?? ""} onChange={e=>patch({minimum:e.target.value===""?undefined:Number(e.target.value)})}/></label><label className="op-field"><span>Máximo · Opcional</span><input type="number" step={draft.spec.type==="integer"?1:"any"} value={draft.spec.maximum ?? ""} onChange={e=>patch({maximum:e.target.value===""?undefined:Number(e.target.value)})}/></label></>}
    </div>
    <label className="op-field"><span>Mensagem de solicitação no WhatsApp</span><textarea rows={2} maxLength={1000} value={draft.spec.prompt || ""} placeholder={draft.spec.type==="date"?"Informe a data no formato DD/MM/AAAA.":"Informe o valor."} onChange={e=>patch({prompt:e.target.value})}/></label>
    <label className="checkbox-label"><input type="checkbox" checked={draft.spec.required!==false} onChange={e=>patch({required:e.target.checked})}/>Obrigatório</label>
   </form>
  </InlineDialog>}
 </section>;
}
