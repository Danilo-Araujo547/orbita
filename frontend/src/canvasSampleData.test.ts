import {describe,it,expect} from "vitest";
import {sampleDataset} from "./components/report-canvas/sampleData";
import type {CanvasBlock,CanvasSource} from "./components/report-canvas/model";
describe("Editor sample data",()=>{
 it("uses configured axes and series without changing source/layout",()=>{
  const source:CanvasSource={id:"sql",type:"report",report_id:50};
  const block:CanvasBlock={id:"b",type:"bar",x:0,y:0,width:200,height:200,options:{x_field:"MES",y_fields:["EXAMES","ATENDIMENTOS"]}};
  const before=JSON.stringify({source,block});const dataset=sampleDataset(block,source);
  expect(dataset.columns).toEqual(["MES","EXAMES","ATENDIMENTOS"]);
  expect(dataset.rows).toHaveLength(6);
  expect(dataset.rows.every(row=>typeof row[1] === "number" && typeof row[2] === "number")).toBe(true);
  expect(JSON.stringify({source,block})).toBe(before);
  expect(sampleDataset(block,source)).toEqual(dataset);
 });
 it("fills selected table columns and KPI values",()=>{
  const source:CanvasSource={id:"s",type:"report",report_id:1};
  const block:CanvasBlock={id:"b",type:"table",x:0,y:0,width:200,height:200,options:{columns:["NM_PACIENTE","DATA","TOTAL"]}};
  const data=sampleDataset(block,source);
  expect(data.rows[0][0]).toBe("Exemplo 1");
  expect(data.rows[0][1]).toBe("Exemplo 1");
  expect(typeof data.rows[0][2]).toBe("number");
  expect((data as any).isPlaceholder).toBe(true);
  expect(sampleDataset({...block,type:"kpi",options:{value_field:"MEDIA"}},source).columns).toContain("MEDIA");
 });
});


describe("Wide rolling tables",()=>{
 const source:CanvasSource={id:"sectors",type:"report",report_id:33,dataset:"sectors"};
 const columns=["Setor",...Array.from({length:13},(_,i)=>`m${i}`),...Array.from({length:8},(_,i)=>`${String(i+1).padStart(2,"0")}/10`),"Atual (%)","Leitos"];
 const catalog={id:33,name:"Ocupacao",code:"legacy123-20",datasets:[{id:"sectors",name:"Setores",columns}]};
 it("keeps every column in source order and generates numeric rolling periods",()=>{
  const block:CanvasBlock={id:"wide",type:"table",x:0,y:0,width:1536,height:640,options:{font_size:8}};
  const data=sampleDataset(block,source,catalog);
  expect(data.columns).toEqual(columns);
  expect(data.rows.every(row=>row.length===24)).toBe(true);
  expect(typeof data.rows[0][14]).toBe("number");
  expect(typeof data.rows[0][23]).toBe("number");
 });
 it("does not prepend an unrelated chart axis to an explicitly selected table",()=>{
  const data=sampleDataset({id:"b",type:"table",x:0,y:0,width:300,height:100,options:{x_field:"UNUSED",columns:["Setor","Leitos"]}},source,catalog);
  expect(data.columns).toEqual(["Setor","Leitos"]);
 });
});


describe("Future data sources",()=>{
 const source:CanvasSource={id:"future",type:"report",report_id:987,dataset:"new_dataset"};
 const block:CanvasBlock={id:"new_table",type:"table",x:0,y:0,width:500,height:300,options:{}};
 it("automatically follows the full schema when a source gains columns",()=>{
  const columns=Array.from({length:100},(_,i)=>`Campo ${i+1}`);
  const catalog={id:987,name:"Nova fonte",code:"future",datasets:[{id:"new_dataset",name:"Novo",columns:columns.slice(0,12)}]};
  expect(sampleDataset(block,source,catalog).columns).toEqual(columns.slice(0,12));
  catalog.datasets[0].columns=columns;
  const data=sampleDataset(block,source,catalog);
  expect(data.columns).toEqual(columns);
  expect(data.rows.every(row=>row.length===100)).toBe(true);
 });
 it("keeps an explicit user subset without appending stale chart columns",()=>{
  const data=sampleDataset({...block,options:{columns:["B","A"],x_field:"old_axis",y_fields:["old_series"],value_field:"old_kpi"}},source);
  expect(data.columns).toEqual(["B","A"]);
 });
 it("does not invent a partial table for an unknown or empty schema",()=>{
  expect(sampleDataset(block,source)).toEqual({columns:[],rows:[]});
  const catalog={id:987,name:"Novo",code:"future",columns:["Wrong dataset"],datasets:[{id:"new_dataset",name:"Novo",columns:[]}]};
  expect(sampleDataset(block,source,catalog)).toEqual({columns:[],rows:[]});
 });
});
