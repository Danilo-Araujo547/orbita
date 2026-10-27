import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { query, request } from "../api";
import { dateOnly, dateTime } from "../format";

type Row={day:string;category:string;pricing_type:string;volume:number;cost:string};
type Costs={status:"available"|"unavailable"|"not_configured";code:string;start:string;end:string;currency:string|null;phone_number:string;total_cost:string|null;total_volume:number|null;rows:Row[];checked_at:string};
const labels:Record<string,string>={UTILITY:"Utilidade",MARKETING:"Marketing",MARKETING_LITE:"Marketing Lite",AUTHENTICATION:"Autenticação",AUTHENTICATION_INTERNATIONAL:"Autenticação internacional",SERVICE:"Serviço",FREE_CUSTOMER_SERVICE:"Gratuita na janela de atendimento",FREE_ENTRY_POINT:"Entrada gratuita",REGULAR:"Tarifa regular"};
function localDate(day:Date){return `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,"0")}-${String(day.getDate()).padStart(2,"0")}`;}
function csvValue(value:string){const safe=/^[=+@-]/.test(value)&&!/^[-+]?\d+(\.\d+)?$/.test(value)?"'"+value:value;return '"'+safe.replaceAll('"','""')+'"';}

export default function MetaCosts({unit}:{unit:string}){
  const [start,setStart]=useState(()=>localDate(new Date(new Date().getFullYear(),new Date().getMonth(),1)));
  const [end,setEnd]=useState(()=>localDate(new Date()));
  const [data,setData]=useState<Costs|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setData(null);setLoading(true);setError("");
    request<Costs>(query("meta-costs",{unit,start,end,refresh:String(revision>0)}))
      .then(value=>{if(active)setData(value);}).catch((e:Error)=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[unit,start,end,revision]);
  const currency=data?.currency;
  const money=(value:string|number)=>currency?new Intl.NumberFormat("pt-BR",{style:"currency",currency,minimumFractionDigits:2,maximumFractionDigits:4}).format(Number(value)):"—";
  const days=useMemo(()=>{
    const map=new Map<string,number>();for(const row of data?.rows??[])map.set(row.day,(map.get(row.day)??0)+Number(row.cost));
    return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([day,cost])=>({day,cost}));
  },[data]);
  const categories=useMemo(()=>{
    const map=new Map<string,{category:string;pricing_type:string;volume:number;cost:number}>();
    for(const row of data?.rows??[]){const key=row.category+":"+row.pricing_type;const item=map.get(key)??{category:row.category,pricing_type:row.pricing_type,volume:0,cost:0};item.volume+=row.volume;item.cost+=Number(row.cost);map.set(key,item);}
    return [...map.values()].sort((a,b)=>b.cost-a.cost||a.category.localeCompare(b.category));
  },[data]);
  function exportCSV(){if(!data||data.status!=="available")return;
    const lines=[["Data","Categoria","Tipo de cobrança","Mensagens","Custo","Moeda"],...data.rows.map(row=>[row.day,labels[row.category]??row.category,labels[row.pricing_type]??row.pricing_type,String(row.volume),row.cost,data.currency??""])];
    const url=URL.createObjectURL(new Blob(["\ufeff"+lines.map(row=>row.map(csvValue).join(";")).join("\r\n")],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download=`custos-meta-${unit.replace(/[^a-z0-9-]/gi,"_")}-${start}-${end}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  return <div className="operational-overview finance-workspace">
    <div className="overview-toolbar finance-toolbar">
      <div className="date-range"><input aria-label="Início do período de custos" type="date" value={start} max={end} onChange={e=>setStart(e.target.value)}/><span>até</span><input aria-label="Fim do período de custos" type="date" value={end} min={start} max={localDate(new Date())} onChange={e=>setEnd(e.target.value)}/></div>
      <div className="period-shortcuts" role="group" aria-label="Atalhos de período de custos">
        <button type="button" onClick={()=>{setStart(localDate(new Date(new Date().getFullYear(),new Date().getMonth(),1)));setEnd(localDate(new Date()));}}>Mês atual</button>
        <button type="button" onClick={()=>{const day=new Date();day.setDate(day.getDate()-29);setStart(localDate(day));setEnd(localDate(new Date()));}}>30 dias</button>
      </div>
      <div className="finance-actions"><button type="button" className="button" disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={14}/>Atualizar</button><button type="button" className="button" disabled={loading||data?.status!=="available"||!data.rows.length} onClick={exportCSV}><Download size={14}/>Exportar</button></div>
    </div>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    {loading&&<div className="operational-empty" role="status">Consultando custos…</div>}
    {!loading&&data?.status==="not_configured"&&<section className="operational-section"><div className="operational-empty">Configure a conta Meta desta unidade em Configurações.</div></section>}
    {!loading&&data?.status==="unavailable"&&<section className="operational-section"><div className="operational-empty" role="alert">{data.code==="meta_190"?"Token Meta expirado ou inválido. Atualize em Configurações.":data.code==="meta_10"||data.code==="meta_200"?"A credencial Meta não tem permissão para consultar custos.":"Não foi possível obter os custos da Meta. Tente atualizar."}<small>Código: {data.code}</small></div></section>}
    {!loading&&data?.status==="available"&&<>
      <section className="finance-summary"><div><span>Custo informado pela Meta</span><strong>{money(data.total_cost??0)}</strong><small>{data.currency} · valores aproximados</small></div><div><span>Mensagens no período</span><strong>{(data.total_volume??0).toLocaleString("pt-BR")}</strong><small>Inclui mensagens gratuitas</small></div><div className="finance-account"><span>Número</span><strong>+{data.phone_number}</strong><small>Consulta em {dateTime(data.checked_at)}</small></div></section>
      <section className="operational-section"><header><h2>Custo por dia</h2><span>{data.currency}</span></header>
        {days.length?<div className="operational-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={days} margin={{top:12,right:18,bottom:0,left:0}}><CartesianGrid stroke="var(--border-default)" vertical={false} strokeDasharray="3 4"/><XAxis dataKey="day" tickFormatter={v=>dateOnly(v+"T12:00:00")} tick={{fill:"var(--text-muted)",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"var(--text-muted)",fontSize:11}} axisLine={false} tickLine={false} width={55}/><Tooltip labelFormatter={v=>dateOnly(String(v)+"T12:00:00")} formatter={v=>money(Number(v))} contentStyle={{background:"var(--card-bg)",border:"1px solid var(--border-default)",borderRadius:6,color:"var(--text-primary)"}}/><Line dataKey="cost" name="Custo" stroke="#1684bb" strokeWidth={2} dot={days.length===1?{r:3}:false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>:<div className="operational-empty">Sem registros de cobrança no período.</div>}
      </section>
      <section className="operational-section"><header><h2>Categorias e cobranças</h2><span>{categories.length} combinações</span></header><div className="table-scroll"><table className="operational-table"><thead><tr><th>Categoria</th><th>Tipo de cobrança</th><th>Mensagens</th><th>Custo ({data.currency})</th></tr></thead><tbody>{categories.map(row=><tr key={row.category+row.pricing_type}><th scope="row">{labels[row.category]??row.category}</th><td>{labels[row.pricing_type]??row.pricing_type}</td><td>{row.volume.toLocaleString("pt-BR")}</td><td>{money(row.cost)}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Total</th><td>{(data.total_volume??0).toLocaleString("pt-BR")}</td><td>{money(data.total_cost??0)}</td></tr></tfoot></table></div></section>
    </>}
  </div>;
}
