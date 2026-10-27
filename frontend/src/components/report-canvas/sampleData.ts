import type {CanvasBlock, CanvasSource, CatalogSqlSource} from "./model";

export function sourceColumns(source:CanvasSource, catalog?:CatalogSqlSource): string[] {
  if(source.type === "inline")return source.columns;
  if(source.type === "goals")return ["year","month","value"];
  const selected=catalog?.datasets?.find(d=>d.id === (source.dataset || "rows"));
  return catalog?.datasets ? selected?.columns || [] : catalog?.columns || [];
}

// Editor-only data. Never inserted into layout.sources or sent to the API.
export function sampleDataset(block:CanvasBlock, source:CanvasSource, catalog?:CatalogSqlSource) {
  const options=block.options || {};
  const known=sourceColumns(source,catalog);
  const fields=options.columns?.length ? options.columns : known;
  if(block.type === "table" && !fields.length)return {columns:[],rows:[]};
  const periodColumn=/^(?:\d{4}|(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{2}|\d{2}\/\d{2}(?:\/\d{4})?)$/i;
  const x=options.x_field || fields[0] || "Período";
  const numeric=new Set([...(options.y_fields || []), ...(options.value_field ? [options.value_field] : [])]);
  if(!numeric.size){
    const amount=fields.find(c=>/total|quant|valor|media|média|percent|taxa|qtd|count|exames|atendimentos|dias/i.test(c));
    if(amount)numeric.add(amount);
    else if(block.type !== "table")numeric.add(fields[1] || "Quantidade");
  }
  const columns=block.type === "table" ? [...fields] : Array.from(new Set([x,...fields,...numeric]));
  const months=["Jan","Fev","Mar","Abr","Mai","Jun"];
  const amounts=[42,68,55,83,72,96];
  const rows=months.map((month,i)=>columns.map((column,j)=>{
    if(numeric.has(column) || periodColumn.test(column) || /total|quant|valor|media|média|percent|taxa|qtd|count|exames|atendimentos|dias|leitos|ocupa|razão|meta|^sus$|convênio|particular|sansaúde|iamspe/i.test(column))return amounts[i]+j*7;
    if(/gerado_em|generated_at/i.test(column))return "25/10/2026 09:30:00";
    if(/data|date|atualiza/i.test(column))return `${String(i+1).padStart(2,"0")}/10/2026`;
    if(/ano|year/i.test(column))return 2026;
    if(/mes|mês|month|period|períod/i.test(column) || column===x && !/nome|paciente|especial|tipo|grupo|descri/i.test(column))return month;
    if(/nome|paciente/i.test(column))return `Pessoa de exemplo ${i+1}`;
    if(/especial/i.test(column))return ["Clínica médica","Cardiologia","Ortopedia","Pediatria","Neurologia","Oftalmologia"][i];
    if(/codigo|código|^id$|^cd_/i.test(column))return 1000+i;
    return `Exemplo ${i+1}`;
  }));
  return {columns,rows};
}
