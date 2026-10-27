export type ParameterSpec={type:string;label?:string;required?:boolean;order?:number;prompt?:string;default?:unknown;minimum?:number;maximum?:number;not_before?:string;[key:string]:unknown};
export type ParameterSchema=Record<string,ParameterSpec>;
export function readParameterSchema(value:string):ParameterSchema{
 const parsed=JSON.parse(value);if(!parsed || Array.isArray(parsed) || typeof parsed!=="object")throw new Error("Cadastro de parâmetros inválido.");
 const result:ParameterSchema={};
 for(const [key,spec] of Object.entries(parsed)){
  if(typeof spec === "string")result[key]={type:spec};
  else if(spec && typeof spec === "object" && !Array.isArray(spec) && typeof (spec as ParameterSpec).type === "string")result[key]=spec as ParameterSpec;
  else throw new Error("Definição de parâmetro inválida: "+key);
 }
 return result;
}
export function renameParameter(schema:ParameterSchema,previous:string,name:string,spec:ParameterSpec):ParameterSchema{
 if(!/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(name))throw new Error("Use um nome iniciado por letra, sem espaços ou acentos.");
 if(name!==previous && Object.hasOwn(schema,name))throw new Error("Já existe um parâmetro com esse nome.");
 if(!previous && Object.keys(schema).length>=30)throw new Error("Limite de 30 parâmetros por relatório.");
 const result:ParameterSchema={};
 for(const [key,value] of Object.entries(schema)){
  const nextKey=key===previous?name:key;
  const next={...(key===previous?spec:value)};
  if(previous && next.not_before===previous)next.not_before=name;
  result[nextKey]=next;
 }
 if(!previous)result[name]=spec;
 return result;
}
// Extract bind names without reading literals, quoted identifiers, comments or :: casts.
export function queryParameterRanges(sql:string):Array<{name:string;start:number;end:number}>{
 const ranges:Array<{name:string;start:number;end:number}>=[];let i=0;
 while(i<sql.length){
  if(sql.startsWith("--",i)){i=sql.indexOf("\n",i);if(i<0)break;continue;}
  if(sql.startsWith("/*",i)){const end=sql.indexOf("*/",i+2);i=end<0?sql.length:end+2;continue;}
  if(/[qQ]/.test(sql[i]) && sql[i+1]==="'" && sql[i+2]){
   const opener=sql[i+2],closer=({"[":"]","{":"}","(":")","<":">"} as Record<string,string>)[opener] || opener;
   const end=sql.indexOf(closer+"'",i+3);if(end>=0){i=end+2;continue;}
  }
  if(sql[i]==="'" || sql[i]==='"'){
   const quote=sql[i++];while(i<sql.length){if(sql[i++]===quote){if(sql[i]===quote)i++;else break;}}continue;
  }
  if(sql.startsWith("::",i)){i+=2;continue;}
  if(sql[i]===":" && /[A-Za-z]/.test(sql[i+1] || "")){
   const match=sql.slice(i+1).match(/^[A-Za-z][A-Za-z0-9_]*/)!;ranges.push({name:match[0],start:i,end:i+match[0].length+1});i+=match[0].length+1;continue;
  }
  i++;
 }
 return ranges;
}
export function queryParameters(sql:string):string[]{
 return [...new Set(queryParameterRanges(sql).map(item=>item.name))];
}
export function suggestedParameter(name:string,order:number):ParameterSpec{
 const key=name.toLowerCase().replace(/^wpa_/,"");
 const date=/data|date|^start$|^end$/.test(key),year=/^ano$|^year$/.test(key),month=/^mes$|^month$/.test(key);
 const labels:Record<string,string>={data_inicial:"Data inicial",start_date:"Data inicial",data_final:"Data final",end_date:"Data final",start:"Data inicial",end:"Data final",ano:"Ano",year:"Ano",mes:"Mês",month:"Mês"};
 const fallback=key.replaceAll("_"," ");const label=labels[key] || fallback.charAt(0).toUpperCase()+fallback.slice(1);
 return {type:date?"date":year||month?"integer":"string",label,required:true,order,prompt:`Informe ${label.toLowerCase()}${date?" no formato DD/MM/AAAA":""}.`,...(month?{minimum:1,maximum:12}:{})};
}
