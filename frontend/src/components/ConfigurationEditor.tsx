import FormAction from "./FormAction";
type Choice = {value: string|number;label:string};
export type EditField = {key:string;label:string;type?:"text"|"number"|"time"|"checkbox"|"textarea"|"select"|"multiple"|"weekdays"|"mapping";options?:Choice[];required?:boolean};
export default function ConfigurationEditor({record, fields, path, act, busy, title="Editar configuração", label="Editar"}:{record:Record<string,unknown>;fields:EditField[];path:string;act:(path:string,data:unknown)=>Promise<unknown>;busy:boolean;title?:string;label?:string}) {
  return <FormAction title={title} label={label} busy={busy}>
    <form className="op-form" onSubmit={e=>{
      e.preventDefault();const data=new FormData(e.currentTarget);const body:Record<string,unknown>={version:record.version};
      for(const field of fields) {
        if(field.type==="checkbox")body[field.key]=data.get(field.key)==="on";
        else if(field.type==="mapping")body[field.key]=Object.fromEntries(Array.from(data.entries()).filter(([key])=>key.startsWith(`${field.key}:`)).map(([key,value])=>[key.slice(field.key.length+1),String(value)]));
        else if(field.type==="weekdays"||field.type==="multiple")body[field.key]=data.getAll(field.key).map(Number);
        else if(field.type==="number")body[field.key]=Number(data.get(field.key));
        else if(field.type==="select")body[field.key]=typeof record[field.key]==="number"?Number(data.get(field.key)):data.get(field.key);
        else body[field.key]=String(data.get(field.key)||"");
      }
      void act(path,body).catch(()=>{});
    }}>
      {fields.map(field=>{
        const value=record[field.key];
        if(field.type==="mapping")return <fieldset key={field.key}><legend>{field.label}</legend>{Object.entries((value||{}) as Record<string,string>).map(([key,v])=><label className="op-field" key={key}>{key}<input name={`${field.key}:${key}`} defaultValue={v} required/></label>)}</fieldset>;
        if(field.type==="checkbox")return <label className="checkbox-label" key={field.key}><input name={field.key} type="checkbox" defaultChecked={!!value}/>{field.label}</label>;
        if(field.type==="multiple"||field.type==="weekdays")return <fieldset key={field.key}><legend>{field.label}</legend><div className="op-checklist">{(field.type==="weekdays"?["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map((label,value)=>({value,label})):field.options||[]).map(option=><label key={option.value}><input name={field.key} type="checkbox" value={option.value} defaultChecked={Array.isArray(value)&&value.includes(Number(option.value))}/>{option.label}</label>)}</div></fieldset>;
        return <label className="op-field" key={field.key}>{field.label}{field.type==="textarea"?<textarea name={field.key} defaultValue={String(value||"")} required={field.required} maxLength={4000}/>:field.type==="select"?<select name={field.key} defaultValue={String(value??"")} required={field.required}>{field.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input name={field.key} type={field.type||"text"} required={field.required} defaultValue={field.type==="time"?String(value||"").slice(0,5):String(value??"")}/>}</label>;
      })}
      <button type="submit" className="button primary" disabled={busy}>Salvar</button>
    </form>
  </FormAction>;
}
