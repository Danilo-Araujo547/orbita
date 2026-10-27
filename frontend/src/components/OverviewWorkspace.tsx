import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import FilterSelect from "./FilterSelect";
import { dateOnly } from "../format";
import type { Indicators, PageName } from "../types";

type Props = {
  data: Indicators; unit: string; start: string; end: string; kind: string;
  kinds: Record<string,string>; isDark?: boolean;
  onFilterChange: (kind:string,start:string,end:string)=>void;
  onNavigate: (page:PageName,filter?:string,isResponse?:boolean)=>void;
};
function localDay(day:Date) {
  return `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,"0")}-${String(day.getDate()).padStart(2,"0")}`;
}
function range(days:number) {
  const end=new Date(), start=new Date(end); start.setDate(start.getDate()-days+1);
  return [localDay(start),localDay(end)];
}
const number=(n:number)=>n.toLocaleString("pt-BR");
const percentage=(value:number,total:number)=>(total?value*100/total:0).toLocaleString("pt-BR",{maximumFractionDigits:1});

export default function OverviewWorkspace({data,start,end,kind,kinds,onFilterChange,onNavigate}:Props) {
  const messages=data.messages_total??data.messages??0;
  const appointments=data.appointments_total??data.appointments??0;
  const sent=data.messages_sent??["accepted","sent","delivered","read"].reduce((n,key)=>n+(data.states?.[key]??0),0);
  const queued=data.messages_to_send??["queued","preview","sending"].reduce((n,key)=>n+(data.states?.[key]??0),0);
  const answered=data.messages_answered??0;
  const appointmentAnswers=data.appointments_answered??0;
  const period= start && end ? `${dateOnly(start+"T12:00:00")} a ${dateOnly(end+"T12:00:00")}` : start ? `Desde ${dateOnly(start+"T12:00:00")}` : end ? `Até ${dateOnly(end+"T12:00:00")}` : "Todo o período";
  const chart=useMemo(()=>data.trend??[],[data.trend]);
  const hasChart=chart.some(row=>row.messages||row.delivered||row.answered);
  const table=[
    {label:"Total", m:messages, a:appointments},
    {label:"Com envio",m:sent,a:data.appointments_sent??0},
    {label:"Respondidos",m:answered,a:appointmentAnswers},
    {label:"Sem resposta",m:data.messages_unanswered??0,a:data.appointments_unanswered??0},
    {label:"Erros ou resultado incerto",m:data.messages_invalid??0,a:data.appointments_invalid??0},
  ];
  const replies=[
    ["confirmed","Confirmadas",data.responses?.confirmed??data.confirmed??0],
    ["declined","Recusadas",data.responses?.declined??data.declined??0],
    ["no_response","Sem resposta no prazo",data.responses?.no_response??data.no_response??0],
    ["pending","Aguardando resposta",data.responses?.pending??0],
    ["not_requested","Sem envio confirmado",data.responses?.not_requested??0],
  ] as const;
  return <div className="operational-overview">
    <div className="overview-toolbar">
      <FilterSelect label="Tipo de envio" value={kind} onChange={e=>onFilterChange(e.target.value,start,end)}>
        <option value="">Todos os tipos</option>
        {Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </FilterSelect>
      <div className="period-shortcuts" role="group" aria-label="Período">
        {[[1,"Hoje"],[7,"7 dias"],[30,"30 dias"]].map(([days,label])=>{
          const [s,e]=range(Number(days));
          return <button type="button" key={days} aria-pressed={start===s&&end===e} onClick={()=>onFilterChange(kind,s,e)}>{label}</button>;
        })}
        {(start||end||kind)&&<button type="button" onClick={()=>onFilterChange("","","")}>Limpar</button>}
      </div>
      <div className="date-range"><CalendarDays size={15} aria-hidden="true" />
        <input type="date" aria-label="Data inicial" value={start} onChange={e=>onFilterChange(kind,e.target.value,end)} />
        <span>até</span><input type="date" aria-label="Data final" value={end} onChange={e=>onFilterChange(kind,start,e.target.value)} />
      </div>
    </div>
    <div className="operational-totals">
      {[
        ["Agendamentos",appointments,()=>onNavigate("appointments")],
        ["Mensagens enviadas",sent,()=>onNavigate("messages")],
        ["A enviar",queued,()=>onNavigate("messages","queued")],
        ["Pendências",data.issues??0,()=>onNavigate("issues")],
      ].map(([label,value,action])=><button type="button" key={String(label)} onClick={action as ()=>void}>
        <span>{String(label)}</span><strong>{number(Number(value))}</strong>
      </button>)}
    </div>
    <div className="overview-data-grid">
      <section className="operational-section">
        <header><h2>Atendimentos e mensagens</h2><span>{period}</span></header>
        <div className="table-scroll"><table className="operational-table">
          <thead><tr><th>Situação</th><th>Mensagens</th><th>Agendamentos</th></tr></thead>
          <tbody>{table.map(row=><tr key={row.label}><th scope="row">{row.label}</th>
            <td>{number(row.m)}{row.label!=="Total"&&<small>{percentage(row.m,messages)}% do total</small>}</td>
            <td>{number(row.a)}{row.label!=="Total"&&<small>{percentage(row.a,appointments)}% do total</small>}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
      <section className="operational-section">
        <header><h2>Respostas</h2><button type="button" className="plain-action" onClick={()=>onNavigate("messages")}>Ver mensagens</button></header>
        <dl className="operational-responses">{replies.map(([value,label,total])=><div key={value}>
          <dt>{label}</dt><dd><button type="button" className="plain-action" onClick={()=>onNavigate("messages",value,true)}>{number(total)}</button></dd>
        </div>)}</dl>
        <div className="operational-outcome"><span>Agendamentos recusados</span>
          <button type="button" className="plain-action" onClick={()=>onNavigate("appointments","declined")}>{number(data.appointments_declined??data.declined??0)}</button>
        </div>
      </section>
    </div>
    <section className="operational-section">
      <header><h2>Mensagens por dia de criação</h2><div className="chart-key"><span>Mensagens</span><span>Entregues</span><span>Respondidas</span></div></header>
      {hasChart ? <div className="operational-chart"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={chart} margin={{top:12,right:18,bottom:0,left:0}}>
          <CartesianGrid stroke="var(--border-default)" vertical={false} strokeDasharray="3 4" />
          <XAxis dataKey="day" tickFormatter={v=>dateOnly(v+"T12:00:00")} tick={{fill:"var(--text-muted)",fontSize:11}} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{fill:"var(--text-muted)",fontSize:11}} axisLine={false} tickLine={false} width={42} />
          <Tooltip labelFormatter={v=>dateOnly(String(v)+"T12:00:00")} contentStyle={{background:"var(--card-bg)",border:"1px solid var(--border-default)",borderRadius:6,color:"var(--text-primary)"}} />
          <Line dataKey="messages" name="Mensagens" stroke="#1684bb" dot={chart.length===1?{r:3}:false} strokeWidth={2} isAnimationActive={false}/>
          <Line dataKey="delivered" name="Entregues" stroke="#14b4cb" dot={chart.length===1?{r:3}:false} strokeWidth={2} isAnimationActive={false}/>
          <Line dataKey="answered" name="Respondidas" stroke="#9473cb" dot={chart.length===1?{r:3}:false} strokeWidth={2} isAnimationActive={false}/>
        </LineChart>
      </ResponsiveContainer></div> : <div className="operational-empty">Sem mensagens no período.</div>}
    </section>
  </div>;
}
