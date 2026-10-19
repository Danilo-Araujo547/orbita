import { useEffect, useState } from "react";
import { query, request } from "../api";
import type { Paginated, SectionPermissions } from "../types";
import FormAction from "./FormAction";
import { Panel } from "./ui";

type Grant = { unit: string; role: string; permissions: SectionPermissions };
type UserRow = { id: number; username: string; full_name: string; active: boolean; version: number; grants: Grant[]; editable: boolean; global_editable: boolean };
type Option = { slug: string; name: string; remote: boolean; instance_name?: string; editable: boolean; max_role: string; permissions: SectionPermissions };
type Options = { units: Option[]; sections: Record<string, string> };
const profiles: Record<string, string> = { admin: "Administrativo", operator: "Operador", viewer: "Consulta" };

export default function UserDirectory({unit, editable = true, onChanged}: {unit: string; editable?: boolean; onChanged?: () => Promise<void>}) {
  const [rows, setRows] = useState<UserRow[]>([]), [options, setOptions] = useState<Options>({units:[], sections:{}});
  const [revision, setRevision] = useState(0), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      const opts = await request<Options>(query("users/options", {unit}));
      const found: UserRow[] = [];
      for (let page=1;;page++) {
        const data = await request<Paginated<UserRow>>(query("users", {unit, search, page:String(page)}));
        found.push(...data.results); if (!data.next) break;
      }
      if(active) {setOptions(opts);setRows(found);}
    }
    load().catch(e=>active&&setError(e.message));
    return ()=>{active=false;};
  }, [unit, revision, search]);
  async function save(row:UserRow|undefined, body:unknown) {
    setBusy(true);setError("");
    try {
      await request(query(row ? `users/${row.id}/configure` : "users",{unit}),"POST",body);
      setRevision(v=>v+1); await onChanged?.();
    } catch(e) {setError((e as Error).message);throw e;} finally {setBusy(false);}
  }
  return <Panel title="Usuários da instância" action={editable && <UserForm key={`new:${revision}`} options={options} busy={busy} error={error} revision={revision} save={save}/> }>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <label className="op-field">Buscar usuário<input value={search} onChange={e=>setSearch(e.target.value)} /></label>
    <div className="table-scroll"><table className="directory-table"><thead><tr><th>Usuário</th><th>Unidades</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
      {rows.map(row=><tr key={row.id}><td><strong>{row.full_name||row.username}</strong><small className="directory-detail">{row.username}</small></td><td>{row.grants.map(g=><small className="directory-detail" key={g.unit}>{options.units.find(u=>u.slug===g.unit)?.name||g.unit} · {profiles[g.role]}</small>)}{!row.grants.length&&"Sem acesso"}</td><td>{row.active?"Ativo":"Desativado"}</td><td>{editable&&row.editable?<UserForm key={`${row.id}:${row.version}`} row={row} options={options} busy={busy} error={error} revision={revision} save={save}/>:"—"}</td></tr>)}
    </tbody></table></div>{!rows.length&&<p className="directory-empty">Nenhum usuário encontrado.</p>}
  </Panel>;
}

function UserForm({row, options, busy, error, revision, save}:{row?:UserRow;options:Options;busy:boolean;error:string;revision:number;save:(row:UserRow|undefined,body:unknown)=>Promise<void>}) {
  const [username,setUsername]=useState(row?.username||""),[name,setName]=useState(row?.full_name||""),[password,setPassword]=useState("");
  const [active,setActive]=useState(row?.active??true),[grants,setGrants]=useState<Grant[]>(row?.grants||[]);
  const global = !row || row.global_editable;
  const none=()=>Object.fromEntries(Object.keys(options.sections).map(k=>[k,"none"])) as SectionPermissions;
  function update(slug:string, change:Partial<Grant>) {setGrants(v=>v.map(g=>g.unit===slug?{...g,...change}:g));}
  function setRole(slug:string, role:string) {
    const grant=grants.find(g=>g.unit===slug)!;
    const permissions={...grant.permissions};
    for (const key of Object.keys(permissions)) if (permissions[key]==="write" && (role==="viewer" || (role!=="admin"&&["settings","operationsAdmin","users"].includes(key)))) permissions[key]="read";
    if(role!=="admin")permissions.users="none";
    update(slug,{role,permissions});
  }
  return <FormAction title={row?"Editar usuário":"Novo usuário"} label={row?"Editar":"Novo usuário"} busy={busy} error={error} version={revision}>
    <form className="op-form" onSubmit={e=>{e.preventDefault();void save(row,{version:row?.version||0,username,full_name:name,active,grants:grants.filter(g=>options.units.some(o=>o.slug===g.unit&&o.editable)),...(password?{password}:{})}).then(()=>setPassword("")).catch(()=>{});}}>
      <div className="op-two"><label className="op-field">Login<input required minLength={3} maxLength={150} disabled={!!row} autoComplete="off" value={username} onChange={e=>setUsername(e.target.value)}/></label>
        <label className="op-field">Nome<input maxLength={150} disabled={!global} value={name} onChange={e=>setName(e.target.value)}/></label>
        <label className="op-field">{row?"Nova senha (opcional)":"Senha inicial"}<input type="password" required={!row} minLength={12} maxLength={200} disabled={!global} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
      </div>
      <label className="checkbox-label"><input type="checkbox" disabled={!global} checked={active} onChange={e=>setActive(e.target.checked)}/>Usuário ativo</label>
      <h3>Unidades e abas</h3>
      {options.units.map(option=>{
        const grant=grants.find(g=>g.unit===option.slug);
        return <fieldset key={option.slug} className="access-grant" disabled={!option.editable}>
          <legend><label className="checkbox-label"><input type="checkbox" checked={!!grant} onChange={e=>setGrants(v=>e.target.checked?[...v,{unit:option.slug,role:"operator",permissions:none()}]:v.filter(g=>g.unit!==option.slug))}/>{option.remote?"☁ ":""}{option.name}{option.remote?` · ${option.instance_name}`:" · Local"}</label></legend>
          {grant&&<><label className="op-field">Perfil<select value={grant.role} onChange={e=>setRole(option.slug,e.target.value)}>{Object.entries(profiles).filter(([key])=>option.max_role==="admin"||key!=="admin"&&(option.max_role!=="viewer"||key==="viewer")).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
            <div className="table-scroll"><table className="directory-table"><thead><tr><th>Aba lateral</th><th>Acesso</th></tr></thead><tbody>{Object.entries(options.sections).map(([key,label])=>{
              const max=option.permissions[key]||"none";
              return <tr key={key}><td>{label}</td><td><select aria-label={`${option.name} — ${label}`} value={grant.permissions[key]||"none"} onChange={e=>update(option.slug,{permissions:{...grant.permissions,[key]:e.target.value as "none"|"read"|"write"}})}>
                <option value="none">Oculto</option>{max!=="none"&&<option value="read">Somente leitura</option>}{max==="write"&&grant.role!=="viewer"&&(grant.role==="admin"||!["settings","operationsAdmin","users"].includes(key))&&<option value="write">Ver e editar</option>}
              </select></td></tr>;
            })}</tbody></table></div></>}
        </fieldset>;
      })}
      <button type="submit" className="button primary" disabled={busy}>Salvar usuário</button>
    </form>
  </FormAction>;
}
