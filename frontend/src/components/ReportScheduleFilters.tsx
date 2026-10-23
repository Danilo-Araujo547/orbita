import { Search } from "lucide-react";

type Option = { id: number; name: string; address?: string };
export type ScheduleFilters = { search: string; report: string; recipient: string; status: string; weekday: string; timeFrom: string; timeTo: string; recipientKind: string };
export default function ReportScheduleFilters({value, onChange, reports, recipients}: {value: ScheduleFilters; onChange: (value: ScheduleFilters) => void; reports: Option[]; recipients: Option[]}) {
  const set = (key: keyof ScheduleFilters, next: string) => onChange({...value, [key]:next});
  return <div className="report-filters">
    <div className="report-search"><Search size={16}/><input aria-label="Buscar programações" placeholder="Relatório, destinatário ou telefone" value={value.search} onChange={e=>set("search",e.target.value)}/></div>
    <label><span>Relatório</span><select value={value.report} onChange={e=>set("report",e.target.value)}><option value="">Todos os relatórios</option>{reports.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <label><span>Destinatário</span><select value={value.recipient} onChange={e=>set("recipient",e.target.value)}><option value="">Todos os destinatários</option>{recipients.map(r=><option key={r.id} value={r.id}>{r.name} · {r.address}</option>)}</select></label>
    <label><span>Situação</span><select value={value.status} onChange={e=>set("status",e.target.value)}><option value="">Todas as situações</option><option value="active">Ativas</option><option value="inactive">Desativadas</option></select></label>
    <label><span>Dia da semana</span><select value={value.weekday} onChange={e=>set("weekday",e.target.value)}><option value="">Todos os dias</option>{["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"].map((day,i)=><option key={i} value={i}>{day}</option>)}</select></label>
    <label><span>Horário inicial</span><input type="time" aria-label="Horário inicial" value={value.timeFrom} onChange={e=>set("timeFrom",e.target.value)}/></label>
    <label><span>Horário final</span><input type="time" aria-label="Horário final" value={value.timeTo} onChange={e=>set("timeTo",e.target.value)}/></label>
    <label><span>Tipo de destinatário</span><select value={value.recipientKind} onChange={e=>set("recipientKind",e.target.value)}><option value="">Telefones e grupos</option><option value="phone">Telefone</option><option value="group">Grupo</option></select></label>
    {Object.values(value).some(Boolean) && <button className="button" onClick={()=>onChange({search:"",report:"",recipient:"",status:"",weekday:"",timeFrom:"",timeTo:"",recipientKind:""})}>Limpar filtros</button>}
  </div>;
}
