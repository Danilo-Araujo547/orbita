import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { previewParameters, previewError } from "./hooks/useStagePreviews";
import { collectTestParameters } from "./parameters";
import BlockFrame from "./stage/BlockFrame";
import type { BlockFrameProps } from "./stage/BlockFrame";
import type { CanvasSource } from "./model";

const source: CanvasSource = {id:"s",type:"report",report_id:6,parameters:{start:{parameter:"date"},year:2026}};
const props: BlockFrameProps = {block:{id:"b",type:"table",source_id:"s",x:0,y:0,width:500,height:300},background:"#ffffff",sources:[source],assets:[],assetUrls:{},availableSources:[],localDatasets:new Map(),reportName:"QA",showSampleData:false,isSelected:false,isDragging:false,onStartDrag:()=>{},onStartResize:()=>{},onFocusBlock:()=>{}};
describe("Tarefa 10: prévia da folha",()=>{
  it("resolve os parâmetros da fonte com defaults do relatório e preserva o layout",()=>{
    const before=JSON.stringify(source);
    const result=previewParameters(source,{start:{type:"date"},year:{type:"integer"},month:{type:"integer",default:10}}, {date:{default:"2026-10-01"}});
    expect(result.values).toEqual({start:"01/10/2026",year:"2026",month:"10"});
    expect(collectTestParameters(result.fields,result.values)).toEqual({start:"2026-10-01",year:2026,month:10});
    expect(JSON.stringify(source)).toBe(before);
  });
  it("não considera um binding como valor preenchido e exige sua resolução",()=>{
    const result=previewParameters(source,{start:{type:"date",required:false}});
    expect(result.fields[0].required).toBe(true);
    expect(result.values.start).toBe("");
    expect(()=>collectTestParameters(result.fields,result.values)).toThrow(/Informe/);
  });
  it.each(["table","kpi","bar","line","pie"] as const)("explica resultado vazio em %s", type=>{
    const html=renderToStaticMarkup(<BlockFrame {...props} block={{...props.block,type}} localDatasets={new Map([["s",{columns:["X","Y"],rows:[]}]])} />);
    expect(html).toContain("A fonte não retornou linhas para estes parâmetros");
    expect(html).toContain("Prévia · 0 linhas");
  });
  it("mostra carregamento antes de receber o primeiro estado",()=>{
    expect(renderToStaticMarkup(<BlockFrame {...props} />)).toContain("Carregando prévia");
  });
  it("apresenta parâmetros no bloco sem ação de salvar",()=>{
    const html=renderToStaticMarkup(<BlockFrame {...props} previewState={{status:"idle",data:null,error:"Preencha os parâmetros: Ano.",loadedAt:null,fields:[{name:"year",label:"Ano",type:"integer"}],values:{year:""}}} />);
    expect(html).toContain("Ano");
    expect(html).toContain("<input");
    expect(html).toContain("Tentar de novo");
    expect(html).not.toContain("Salvar");
  });
  it.each(["Not found.","Permission denied.","CSRF Failed"])("traduz falhas de acesso: %s", message=>{
    expect(previewError(message)).toMatch(/Fonte ou rota|Sem permissão/);
    expect(previewError(message)).not.toContain(message);
  });
});
