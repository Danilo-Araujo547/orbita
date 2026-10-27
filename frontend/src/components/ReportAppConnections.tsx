import RemoteInstances from "./RemoteInstances";
import {useEffect,useState} from "react";
import {Plus,Pencil,Cloud,Database} from "lucide-react";
import InlineDialog from "./InlineDialog";
import Select from "./Select";
import {Empty} from "./ui";
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>;}
import {request,query} from "../api";

type Connection={id:number;name:string;mode:"local"|"remote";local_unit:number|null;remote_instance:string|null;source_name:string;enabled:boolean;version:number;state:string};
type Options={units:{id:number;name:string}[];remote_instances:{id:string;name:string;state:string;remote_unit_slug:string}[]};
export default function ReportAppConnections({unit}:{unit:string}) {
 const [remoteSetup,setRemoteSetup]=useState(false);
 const [rows,setRows]=useState<Connection[]>([]),[options,setOptions]=useState<Options>({units:[],remote_instances:[]}),[form,setForm]=useState<Partial<Connection>|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{let alive=true;Promise.all([request<{results:Connection[]}>(query("report-app-connections",{unit,page_size:"500"})),request<Options>(query("report-app-connections/options",{unit}))]).then(([r,o])=>{if(alive){setRows(r.results);setOptions(o);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[unit,revision]);
 async function save(e:React.FormEvent){
  e.preventDefault();if(!form)return;setBusy(true);setError("");
  try{
   await request(query(`report-app-connections${form.id?`/${form.id}/configure`:""}`,{unit}),"POST",{
    name:form.name,mode:form.mode,local_unit:form.mode==="local"?form.local_unit||null:null,
    remote_instance:form.mode==="remote"?form.remote_instance||null:null,enabled:!!form.enabled,
    ...(form.id?{version:form.version}:{})
   });
   setForm(null);setRevision(r=>r+1);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section>
  <div className="report-toolbar"><button className="button primary" onClick={()=>{setError("");setForm({name:"",mode:"local",local_unit:null,remote_instance:null,enabled:false});}}><Plus size={16}/>Adicionar conexão</button></div>
  {error&&!form&&<div className="inline-error" role="alert">{error}</div>}
  {rows.length?<div className="report-table-scroll"><table className="report-table"><thead><tr><th>Nome</th><th>Instância</th><th>Origem</th><th>Situação</th><th/></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.mode==="remote"?<Cloud size={15}/>:<Database size={15}/>} {r.mode==="remote"?"Remota":"Local"}</td><td>{r.source_name}</td><td>{r.enabled?r.state==="connected"||r.state==="local"?"Ativa":"Pendente":"Desativada"}</td><td><button className="button" onClick={()=>{setError("");setForm({...r});}}><Pencil size={14}/>Editar</button></td></tr>)}</tbody></table></div>:<Empty text="Nenhuma conexão do app."/>}
  {form&&<InlineDialog subtitle="" busy={busy} title={form.id?"Editar conexão do app":"Adicionar conexão do app"} onClose={()=>setForm(null)} footer={<><button className="button" onClick={()=>setForm(null)}>Cancelar</button><button className="button primary" disabled={busy} type="submit" form="report-app-source">Salvar</button></>}>
   <form id="report-app-source" onSubmit={save} className="report-form">
    {error&&<div className="inline-error" role="alert">{error}</div>}
    <Field label="Nome"><input required maxLength={150} value={form.name||""} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
    <Field label="Instância"><Select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value as "local"|"remote",local_unit:null,remote_instance:null})}><option value="local">Local</option><option value="remote">Remota</option></Select></Field>
    {form.mode==="local"?<Field label="Unidade de origem"><Select value={form.local_unit||""} onChange={e=>setForm({...form,local_unit:e.target.value?Number(e.target.value):null})}><option value="">Selecionar</option>{options.units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>:<Field label="Conexão remota"><Select value={form.remote_instance||""} onChange={e=>setForm({...form,remote_instance:e.target.value||null})}><option value="">Selecionar</option>{options.remote_instances.map(r=><option key={r.id} value={r.id}>{r.name} · {r.remote_unit_slug}</option>)}</Select><button type="button" className="button" onClick={()=>setRemoteSetup(true)}>Conectar instância por URL e chave</button></Field>}
    <label className="checkbox"><input type="checkbox" checked={!!form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>Ativa</label>
   </form>
  </InlineDialog>}
  {remoteSetup&&<InlineDialog title="Instâncias remotas" subtitle="" onClose={()=>setRemoteSetup(false)}><RemoteInstances unit={unit} onChanged={async()=>{setRevision(r=>r+1);}}/></InlineDialog>}
 </section>;
}
