import Select from "./Select";
import { useCallback, useEffect, useState } from "react";
import { Code2, Edit3, History, Play, RefreshCw } from "lucide-react";
import { query, request } from "../api";
import { dateTime } from "../format";
import FormAction from "./FormAction";
import InlineDialog from "./InlineDialog";
import { Empty } from "./ui";

type Row = Record<string, any>;
type Page = { count: number; results: Row[] };
type Options = { sources: Row[]; reports: Row[] };
const kinds: Record<string,string> = {beds:"Leitos totais",capacity:"Capacidade SUS/convênio",lives:"Vidas Sansaúde"};
const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const states: Record<string, string> = { pending: "Na fila", running: "Coletando", ready: "Coletado", failed: "Falha", missed: "Janela perdida" };
const environments: Record<string, string> = { homologation: "Homologação", production: "Produção" };
const errors: Record<string, string> = { source_unavailable: "Origem indisponível", source_changed: "Origem alterada", collection_paused: "Coleta desativada", collection_window_missed: "Janela encerrada", invalid_result: "Dados inválidos na origem", source_query_failed: "Falha na consulta", legacy_snapshot_unavailable: "Sem registro no legado" };
function seed(row?: Row) { return row ? { ...row } : { code: "", name: "", source_report: "", output_report: "", environment: "homologation", collection_time: "04:20:23", weekdays: [0,1,2,3,4,5,6], window_minutes: 60, enabled: false, dataset_kind:"beds", reference_offset_days:0, consumers:[] }; }

function ConfigurationAction({ row, unit, options, revision, saved }: { row?: Row; unit: string; options: Options; revision: number; saved: () => void }) {
  const [form, setForm] = useState<Row>(()=>seed(row));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(()=>setForm(seed(row)),[row?.id,row?.version]);
  const set = (key: string, value: unknown) => setForm(current=>({...current,[key]:value}));
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = Object.fromEntries(["code","name","source_report","output_report","environment","collection_time","weekdays","window_minutes","enabled","dataset_kind","reference_offset_days","consumers"].map(k=>[k,form[k]]));
      await request(query(row ? `report-snapshots/${row.id}/configure` : "report-snapshots",{unit}),"POST",{...data,...(row?{version:row.version}:{})});
      saved();
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <FormAction title={row ? "Editar coleta" : "Adicionar coleta"} label={row ? "Editar" : "Adicionar"} icon={row ? <Edit3 size={14}/> : undefined} className="snapshot-dialog" version={revision} busy={busy} error={error} onClose={()=>{setForm(seed(row));setError("");}}>
    <form onSubmit={save} className="snapshot-form">
      <div className="snapshot-form-grid">
        <label className="op-field">Nome<input required maxLength={150} value={form.name} onChange={e=>set("name",e.target.value)}/></label>
        <label className="op-field">Código<input required pattern="[A-Za-z0-9_-]+" maxLength={80} value={form.code} onChange={e=>set("code",e.target.value)}/></label>
        <label className="op-field">Tipo de coleta<Select value={form.dataset_kind||"beds"} onChange={e=>{set("dataset_kind",e.target.value);set("reference_offset_days",e.target.value==="lives"?-1:0);}}>{Object.entries(kinds).map(([k,label])=><option key={k} value={k}>{label}</option>)}</Select></label>
        {form.dataset_kind==="lives"&&<label className="op-field">Data de referência<Select value={form.reference_offset_days} onChange={e=>set("reference_offset_days",Number(e.target.value))}><option value={-1}>Ontem</option><option value={0}>Hoje</option></Select></label>}
        <label className="op-field">Consulta de origem<Select required value={form.source_report} onChange={e=>set("source_report",Number(e.target.value))}><option value="">Selecione</option>{options.sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.connection_name}</option>)}</Select></label>
        <label className="op-field">Relatório<Select required value={form.output_report} onChange={e=>set("output_report",Number(e.target.value))}><option value="">Selecione</option>{options.reports.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
        <label className="op-field">Ambiente<Select value={form.environment} onChange={e=>set("environment",e.target.value)}><option value="homologation">Homologação</option><option value="production">Produção</option></Select></label>
        <label className="op-field">Horário da coleta<input required type="time" step="1" value={form.collection_time} onChange={e=>set("collection_time",e.target.value)}/></label>
        <label className="op-field">Tolerância após o horário (min)<input type="number" required min={1} max={180} value={form.window_minutes} onChange={e=>set("window_minutes",Number(e.target.value))}/></label>
      </div>
      <fieldset className="snapshot-days"><legend>Também utilizado por</legend>{options.reports.filter(r=>r.id!==Number(form.output_report)).map(r=><label key={r.id} className="report-check"><input type="checkbox" checked={(form.consumers||[]).includes(r.id)} onChange={e=>set("consumers",e.target.checked?[...(form.consumers||[]),r.id]:(form.consumers||[]).filter((id:number)=>id!==r.id))}/>{r.name}</label>)}</fieldset>
      <fieldset className="snapshot-days"><legend>Dias da coleta</legend>{days.map((d,i)=><label key={d} className="report-check"><input type="checkbox" checked={form.weekdays.includes(i)} onChange={e=>set("weekdays",e.target.checked?[...form.weekdays,i].sort():form.weekdays.filter((v:number)=>v!==i))}/>{d}</label>)}</fieldset>
      <label className="report-check"><input type="checkbox" checked={form.enabled} onChange={e=>set("enabled",e.target.checked)}/>Coleta automática ativa</label>
      <button className="button primary" type="submit">Salvar</button>
    </form>
  </FormAction>;
}

export default function ReportSnapshots({unit}:{unit:string}) {
  const [rows,setRows]=useState<Row[]>([]),[options,setOptions]=useState<Options>({sources:[],reports:[]});
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[revision,setRevision]=useState(0);
  const [page,setPage]=useState(1),[count,setCount]=useState(0);
  const [history,setHistory]=useState<Row|null>(null),[historyPage,setHistoryPage]=useState(1),[runs,setRuns]=useState<Page>({count:0,results:[]}),[historyLoading,setHistoryLoading]=useState(false);
  const [historyEnvironment,setHistoryEnvironment]=useState(""),[historyPeriod,setHistoryPeriod]=useState("");
  const [selectedRun,setSelectedRun]=useState<Row|null>(null),[recordPage,setRecordPage]=useState(1),[records,setRecords]=useState<Page>({count:0,results:[]}),[recordsLoading,setRecordsLoading]=useState(false);
  const [notice,setNotice]=useState("");
  const [querySource,setQuerySource]=useState<Row|null>(null),[querySql,setQuerySql]=useState(""),[queryBusy,setQueryBusy]=useState(false),[queryError,setQueryError]=useState("");
  async function editQuery(row:Row) {
    setBusy(true);setError("");setQueryError("");
    try {
      const source=await request<Row>(query(`reports/${row.source_report}`,{unit}));
      setQuerySql(source.query_sql || "");setQuerySource(source);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  async function saveQuery(event:React.FormEvent) {
    event.preventDefault();if(!querySource)return;
    setQueryBusy(true);setQueryError("");
    try {
      await request(query(`reports/${querySource.id}/configure`,{unit}),"POST",{version:querySource.version,query_sql:querySql});
      setQuerySource(null);setNotice("Query de coleta atualizada.");setRevision(v=>v+1);
    } catch(e) {setQueryError((e as Error).message);} finally {setQueryBusy(false);}
  }
  const load=useCallback(async(silent=false)=>{
    if(!silent)setLoading(true);
    try {const data=await request<Page>(query("report-snapshots",{unit,page:String(page)}));setRows(data.results);setCount(data.count);}
    catch(e){setError((e as Error).message);}finally{if(!silent)setLoading(false);}
  },[unit,page]);
  useEffect(()=>{void load();},[load,revision]);
  useEffect(()=>{let alive=true;request<Options>(query("report-snapshots/options",{unit})).then(d=>{if(alive)setOptions(d);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[unit,revision]);
  const historyState=rows.find(r=>r.id===history?.id)?.latest_run?.state;
  useEffect(()=>{
    if(!history)return;let alive=true;setHistoryLoading(true);
    request<Page>(query("report-snapshot-runs",{unit,configuration:String(history.id),page:String(historyPage),environment:historyEnvironment,period_type:historyPeriod})).then(d=>{if(alive)setRuns(d);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setHistoryLoading(false);});
    return()=>{alive=false;};
  },[unit,history?.id,historyPage,revision,historyState,historyEnvironment,historyPeriod]);
  useEffect(()=>{
    if(!selectedRun)return;let alive=true;setRecordsLoading(true);
    request<Page>(query(`report-snapshot-runs/${selectedRun.id}/records`,{unit,page:String(recordPage)})).then(d=>{if(alive)setRecords(d);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setRecordsLoading(false);});
    return()=>{alive=false;};
  },[unit,selectedRun?.id,recordPage]);
  const pending=rows.some(r=>["pending","running"].includes(r.latest_run?.state));
  useEffect(()=>{if(!pending)return;const timer=setTimeout(()=>void load(true),3000);return()=>clearTimeout(timer);},[pending,rows,load]);
  const saved=()=>{setRevision(v=>v+1);setError("");};
  async function collect(row:Row){
    setBusy(true);setError("");setNotice("");
    try {const run=await request<Row>(query(`report-snapshots/${row.id}/collect`,{unit}),"POST",{version:row.version});setNotice(run.state==="ready"?"A snapshot de hoje já foi coletada.":"Coleta solicitada.");void load(true);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const status=(run?:Row)=><span className={`snapshot-status snapshot-${run?.state||"empty"}`}>{run?(run.origin==="legacy"&&run.state==="missed"?"Sem registro":states[run.state]||run.state):"Sem coleta"}</span>;
  return <section className="panel snapshot-workspace">
    <div className="report-list-heading"><div><h2>Coleta</h2><span>{count} registros</span></div><div className="report-actions"><button className="button" aria-label="Atualizar coletas" onClick={()=>{setError("");setRevision(v=>v+1);}}><RefreshCw size={15}/></button><ConfigurationAction unit={unit} options={options} revision={revision} saved={saved}/></div></div>
    {error&&<p className="inline-error" role="alert">{error}</p>}{notice&&<p className="snapshot-notice" role="status">{notice}</p>}
    {loading?<div className="empty">Carregando…</div>:!rows.length?<Empty text="Nenhuma coleta cadastrada."/>:<div className="report-table-scroll"><table className="report-table"><thead><tr><th>Componente</th><th>Origem</th><th>Programação</th><th>Última coleta</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}>
      <td><strong>{row.name}</strong><small>{kinds[row.dataset_kind]||"Coleta"} · {row.source_name}</small><small>{row.output_name}</small></td><td>{row.connection_name}<small>{environments[row.environment]}</small></td><td>{row.collection_time}<small>{row.weekdays.map((d:number)=>days[d]).join(" · ")}</small><small>{row.enabled?"Ativa":"Pausada"} · {row.timezone}</small></td>
      <td>{row.latest_run?.captured_at?dateTime(row.latest_run.captured_at):"—"}<small>{row.latest_run?.row_count||0} registros</small></td><td>{row.pending_items?.length?<><span className="snapshot-status snapshot-failed">Pendente</span><small>{row.pending_items[0]}</small></>:status(row.latest_run)}</td>
      <td><div className="report-actions"><button className="button" disabled={busy} onClick={()=>void editQuery(row)}><Code2 size={14}/>Editar query</button><ConfigurationAction row={row} unit={unit} options={options} revision={revision} saved={saved}/><button className="button" disabled={busy||["pending","running"].includes(row.latest_run?.state)} onClick={()=>void collect(row)}><Play size={14}/>Coletar agora</button><button className="button" onClick={()=>{setHistory(row);setHistoryEnvironment("");setHistoryPeriod("");setHistoryPage(1);setRuns({count:0,results:[]});}}><History size={14}/>Histórico</button></div></td>
    </tr>)}</tbody></table></div>}
    {count>rows.length&&<div className="report-actions"><button className="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page}</span><button className="button" disabled={page*50>=count} onClick={()=>setPage(p=>p+1)}>Próxima</button></div>}
    {querySource&&<InlineDialog title="Query de coleta" subtitle={querySource.name} className="snapshot-dialog" onClose={()=>{if(!queryBusy)setQuerySource(null);}} footer={<div className="report-actions"><button className="button" disabled={queryBusy} onClick={()=>setQuerySource(null)}>Cancelar</button><button className="button primary" type="submit" form="collection-query-form" disabled={queryBusy}>Salvar</button></div>}>
      {queryError&&<p className="inline-error" role="alert">{queryError}</p>}
      <form id="collection-query-form" onSubmit={saveQuery}>
        <label className="op-field">Conexão<input readOnly value={querySource.connection_name || ""}/></label>
        <label className="op-field">Query SQL<textarea required rows={18} spellCheck={false} value={querySql} onChange={e=>setQuerySql(e.target.value)} style={{fontFamily:"monospace",resize:"vertical"}}/></label>
      </form>
    </InlineDialog>}
    {history&&<InlineDialog title="Histórico de coletas" subtitle={history.name} className="snapshot-dialog snapshot-history" onClose={()=>setHistory(null)} footer={<div className="report-actions"><button className="button" onClick={()=>setHistory(null)}>Fechar</button><button className="button" disabled={historyPage<=1} onClick={()=>setHistoryPage(p=>p-1)}>Anterior</button><span>Página {historyPage}</span><button className="button" disabled={historyPage*50>=runs.count} onClick={()=>setHistoryPage(p=>p+1)}>Próxima</button></div>}>
      <div className="report-actions"><label className="op-field">Ambiente<Select value={historyEnvironment} onChange={e=>{setHistoryEnvironment(e.target.value);setHistoryPage(1);}}><option value="">Todos</option><option value="production">Produção</option><option value="homologation">Homologação</option></Select></label><label className="op-field">Período<Select value={historyPeriod} onChange={e=>{setHistoryPeriod(e.target.value);setHistoryPage(1);}}><option value="">Todos</option><option value="day">Diário</option><option value="month">Mensal</option></Select></label></div>
      {error&&<p className="inline-error" role="alert">{error}</p>}{historyLoading?<div className="empty">Carregando…</div>:<div className="report-table-scroll"><table className="report-table"><thead><tr><th>Data</th><th>Programado</th><th>Coletado</th><th>Origem</th><th>Registros</th><th>Situação</th><th/></tr></thead><tbody>{runs.results.map(run=><tr key={run.id}><td>{run.period_type==="month"?run.reference_date.slice(0,7).split("-").reverse().join("/"):run.reference_date.split("-").reverse().join("/")}</td><td>{run.scheduled_for?dateTime(run.scheduled_for):"—"}</td><td>{run.captured_at?dateTime(run.captured_at):"—"}</td><td>{environments[run.environment]}<small>{run.origin==="scheduled"?"Automática":run.origin==="legacy"?"Legado":"Manual"}</small></td><td>{run.row_count}</td><td>{status(run)}{run.error_code&&<small>{errors[run.error_code]||run.error_code}</small>}</td><td><button className="button" disabled={run.state!=="ready"} onClick={()=>{setSelectedRun(run);setRecordPage(1);setRecords({count:0,results:[]});}}>Ver registros</button></td></tr>)}</tbody></table>{!runs.results.length&&<Empty text="Nenhuma coleta registrada."/>}</div>}
    </InlineDialog>}
    {selectedRun&&<InlineDialog title="Registros da snapshot" subtitle={selectedRun.period_type==="month"?selectedRun.reference_date.slice(0,7).split("-").reverse().join("/"):selectedRun.reference_date.split("-").reverse().join("/")} className="snapshot-dialog snapshot-history" onClose={()=>setSelectedRun(null)} footer={<div className="report-actions"><button className="button" onClick={()=>setSelectedRun(null)}>Fechar</button><button className="button" disabled={recordPage<=1} onClick={()=>setRecordPage(p=>p-1)}>Anterior</button><span>Página {recordPage}</span><button className="button" disabled={recordPage*50>=records.count} onClick={()=>setRecordPage(p=>p+1)}>Próxima</button></div>}>
      {recordsLoading?<div className="empty">Carregando…</div>:selectedRun.dataset_kind && selectedRun.dataset_kind!=="beds"?<AggregateRecords kind={selectedRun.dataset_kind} rows={records.results}/>:<div className="report-table-scroll"><table className="report-table"><thead><tr><th>Código</th><th>Unidade de internação</th><th>Quantidade</th><th>Data na origem</th></tr></thead><tbody>{records.results.map(row=><tr key={row.ward_code}><td>{row.ward_code}</td><td>{row.ward_name}</td><td>{row.quantity}</td><td>{selectedRun.origin==="legacy"?row.source_at.slice(0,10).split("-").reverse().join("/"):dateTime(row.source_at)}</td></tr>)}</tbody></table></div>}
    </InlineDialog>}
  </section>;
}


function AggregateRecords({kind,rows}:{kind:string;rows:Row[]}) {
  const columns=kind==="lives"?[["contract","Contrato"],["active","Situação"],["period","Referência"],["total","Total"]]:[["ward_code","Código"],["ward_name","Setor"],["sus","SUS"],["convenio","Convênio"],["total","Total"],["period","Referência"]];
  function value(payload:Row,key:string) {
    if(key==="period")return payload.period?payload.period.split("-").reverse().join("/"):payload.date?.split("-").reverse().join("/");
    if(key==="contract")return ({E:"Empresarial",I:"Individual",A:"Adesão"} as Row)[payload[key]]||payload[key];
    if(key==="active")return payload[key]==="S"?"Ativo":"Inativo";
    return payload[key]??"—";
  }
  return <div className="report-table-scroll"><table className="report-table"><thead><tr>{columns.map(([key,label])=><th key={key}>{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.record_key}>{columns.map(([key])=><td key={key}>{value(row.payload,key)}</td>)}</tr>)}</tbody></table></div>;
}
