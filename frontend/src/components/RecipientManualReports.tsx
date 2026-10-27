import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import InlineDialog from "./InlineDialog";
import { query, request } from "../api";
import "./recipient-manual-reports.css";

type Report={id:number;name:string;code:string;enabled?:boolean;manual_enabled?:boolean;permission_active?:boolean};
type Props={unit:string;recipientId?:number;value?:number[];inactiveValue?:number[];disabled?:boolean;onChange:(ids:number[],token:string,inactive:number[])=>void};
export default function RecipientManualReports({unit,recipientId,value,inactiveValue,disabled,onChange}:Props){
  const [cache,setCache]=useState<Record<number,Report>>({});
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const [token,setToken]=useState(""),[revision,setRevision]=useState(0);
  const [picker,setPicker]=useState(false),[search,setSearch]=useState(""),[page,setPage]=useState(1);
  const [results,setResults]=useState<Report[]>([]),[next,setNext]=useState(false),[finding,setFinding]=useState(false),[findError,setFindError]=useState("");
  const change=useRef(onChange);change.current=onChange;
  useEffect(()=>{
    let alive=true;setLoading(true);setError("");
    if(!recipientId){setCache({});setToken("");change.current([],"",[]);setLoading(false);return()=>{alive=false;};}
    request<{selected:number[];inactive:number[];reports:Report[];token:string}>(query(`report-recipients/${recipientId}/manual-reports`,{unit}))
      .then(data=>{if(alive){setCache(Object.fromEntries(data.reports.map(r=>[r.id,r])));setToken(data.token);change.current(data.selected,data.token,data.inactive);}})
      .catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[unit,recipientId,revision]);
  useEffect(()=>{
    if(!picker||search.trim().length<2){setResults([]);setNext(false);setFinding(false);return;}
    let alive=true;setFinding(true);setFindError("");
    const timer=setTimeout(()=>{
      request<{results:Report[];next:string|null}>(query("report-recipients/manual-report-options",{unit,search:search.trim(),page:String(page)}))
        .then(data=>{if(alive){setResults(data.results);setNext(!!data.next);}})
        .catch(e=>{if(alive){setFindError(e.message);setResults([]);}})
        .finally(()=>{if(alive)setFinding(false);});
    },250);
    return()=>{alive=false;clearTimeout(timer);};
  },[picker,search,page,unit]);
  const active=new Set(value||[]),inactive=new Set(inactiveValue||[]);
  const ids=[...new Set([...active,...inactive])];
  const ordered=ids.map(id=>cache[id]||{id,name:`Relatório #${id}`,code:""}).sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
  function add(report:Report){setCache(current=>({...current,[report.id]:report}));onChange([...new Set([...active,report.id])],token,[...inactive].filter(id=>id!==report.id));}
  function remove(id:number){onChange([...active].filter(v=>v!==id),token,[...inactive].filter(v=>v!==id));}
  return <section className="recipient-manual-reports" aria-label="Relatórios para solicitação manual">
    <div className="recipient-manual-heading"><h3>Relatórios manuais <span>{ids.length}</span></h3>
      <button type="button" className="button" disabled={disabled||loading||!!error} onClick={()=>{setSearch("");setPage(1);setPicker(true);}}><Plus size={15}/>Adicionar relatório</button>
    </div>
    {loading?<p role="status">Carregando permissões anteriores…</p>:error?<div className="inline-error" role="alert">{error}<button type="button" className="button" onClick={()=>setRevision(v=>v+1)}>Tentar novamente</button></div>:<div className="recipient-report-cards">
      {ordered.map(report=><div className="recipient-report-card" key={report.id}>
        <div className="recipient-report-card-title"><strong>{report.name}</strong><small>{report.code}</small></div>
        {inactive.has(report.id)&&<span className="recipient-report-inactive">Permissão desativada</span>}
        {report.enabled===false&&<span className="recipient-report-inactive">Relatório desativado</span>}
        <div className="recipient-report-card-actions">
          {inactive.has(report.id)&&<button type="button" className="button" disabled={disabled||report.manual_enabled===false} onClick={()=>add(report)}>Ativar permissão</button>}
          <button type="button" className="icon-button" title="Remover relatório" aria-label={`Remover ${report.name}`} disabled={disabled} onClick={()=>remove(report.id)}><X size={15}/></button>
        </div>
      </div>)}
      {!ids.length&&<p className="recipient-manual-empty">Nenhum relatório adicionado.</p>}
    </div>}
    {picker&&<InlineDialog title="Adicionar relatório" subtitle="" className="recipient-report-picker" onClose={()=>setPicker(false)} footer={<button type="button" className="button" onClick={()=>setPicker(false)}>Concluir</button>}>
      <label className="recipient-manual-search"><Search size={16}/><input autoFocus aria-label="Pesquisar nome do relatório" placeholder="Pesquisar nome do relatório" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label>
      {findError&&<p className="inline-error" role="alert">{findError}</p>}
      {finding?<p role="status">Pesquisando…</p>:search.trim().length<2?<p className="recipient-manual-empty">Digite pelo menos 2 caracteres.</p>:<>
        <div className="recipient-report-results">{results.map(report=><div className="recipient-report-result" key={report.id}>
          <span><strong>{report.name}</strong><small>{report.code}</small></span>
          <button type="button" className="button" disabled={disabled||ids.includes(report.id)} onClick={()=>add(report)}>{ids.includes(report.id)?"Adicionado":"Adicionar"}</button>
        </div>)}{!results.length&&!findError&&<p className="recipient-manual-empty">Nenhum relatório encontrado.</p>}</div>
        <div className="recipient-report-search-pages"><button type="button" className="button" disabled={page===1} onClick={()=>setPage(v=>v-1)}>Anterior</button><span>Página {page}</span><button type="button" className="button" disabled={!next} onClick={()=>setPage(v=>v+1)}>Próxima</button></div>
      </>}
    </InlineDialog>}
  </section>;
}
