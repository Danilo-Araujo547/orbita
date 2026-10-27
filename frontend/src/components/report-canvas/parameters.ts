export interface TestParameter {
  name: string; label: string; type: string; required?: boolean;
  default?: unknown; minimum?: number; maximum?: number; not_before?: string;
  order?: number; options?: Array<{value: string; label: string}>;
}
const labels: Record<string,string> = {start:"Data inicial",start_date:"Data inicial",data_inicial:"Data inicial",end:"Data final",end_date:"Data final",data_final:"Data final",reference_date:"Data de referência",as_of:"Data de referência",date:"Data",year:"Ano",month:"Mês",patient_name:"Nome do paciente"};
export function testParameters(schema: Record<string,unknown> = {}): TestParameter[] {
  return Object.entries(schema).map(([name,raw]) => {
    const spec = (typeof raw === "string" ? {type:raw} : raw || {}) as Record<string,any>;
    const key=name.toLowerCase().replace(/^wpa_/, "");
    const fallback=key.replaceAll("_"," ");
    const choices=spec.enum || spec.choices || spec.options;
    const numeric=spec.type === "integer" || spec.type === "number";
    const prompt=String(spec.prompt || "");
    const numericLabel=numeric && /\bano\b/i.test(prompt) ? "Ano" : numeric && /mês|mes/i.test(prompt) ? "Mês" : undefined;
    return {...spec,name,type:spec.type || "string",label:spec.label || numericLabel || labels[key] || fallback.charAt(0).toUpperCase()+fallback.slice(1),options:Array.isArray(choices)?choices.map((v:any)=>typeof v === "object"?{value:String(v.value),label:String(v.label ?? v.value)}:{value:String(v),label:String(v)}):undefined};
  }).sort((a,b) => {
    const rank=(f:TestParameter)=>f.order ?? (/inicial|start/i.test(f.name)?1:/final|end/i.test(f.name)?2:100);
    return rank(a)-rank(b);
  });
}
export function displayParameter(value: unknown, type: string): string {
  if(value == null)return "";
  const text=String(value);
  if(type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(text))return text.split("-").reverse().join("/");
  return text;
}
export function collectTestParameters(fields: TestParameter[], values: Record<string,string>): Record<string,unknown> {
  const result: Record<string,unknown> = {};
  for(const field of fields) {
    const value=(values[field.name] ?? "").trim();
    if(!value){if(field.required !== false && field.default == null)throw new Error(`Informe ${field.label.toLowerCase()}.`);continue;}
    if(field.type === "date") {
      if(!/^\d{2}\/\d{2}\/\d{4}$/.test(value))throw new Error(`${field.label}: use DD/MM/AAAA.`);
      const [day,month,year]=value.split("/").map(Number);
      const date=new Date(Date.UTC(year,month-1,day));
      if(year<1000 || date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day)throw new Error(`${field.label}: data inválida.`);
      result[field.name]=`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    }else if(field.type === "integer" || field.type === "number"){
      const number=Number(value.replace(",","."));
      if(!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number)))throw new Error(`${field.label}: número inválido.`);
      if((field.minimum!=null && number<field.minimum)||(field.maximum!=null && number>field.maximum))throw new Error(`${field.label}: valor fora do intervalo permitido.`);
      result[field.name]=number;
    }else result[field.name]=value;
    if(field.options && !field.options.some(o=>o.value===value))throw new Error(`Selecione uma opção válida em ${field.label.toLowerCase()}.`);
  }
  for(const field of fields){
    if(field.not_before && result[field.name] && result[field.not_before] && String(result[field.name])<String(result[field.not_before]))throw new Error(`${field.label} deve ser igual ou posterior a ${fields.find(f=>f.name===field.not_before)?.label.toLowerCase() || field.not_before}.`);
  }
  return result;
}
