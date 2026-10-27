import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import BlockPreview from "./components/report-canvas/BlockPreview";
import type {CanvasBlock,CanvasSource} from "./components/report-canvas/model";

describe("Canvas table preview",()=>{
 const columns=["Especialidade",...Array.from({length:23},(_,i)=>`Periodo ${i+1}`)];
 const source:CanvasSource={id:"s",type:"report",report_id:50,dataset:"specialties"};
 const block:CanvasBlock={id:"b",type:"table",x:0,y:0,width:1536,height:640,source_id:"s",options:{font_size:8,column_widths:[210,...Array(23).fill(58)]}};
 function render(sample:boolean){return renderToStaticMarkup(<BlockPreview block={block} background="#ffffff" sources={[source]} assets={[]} assetUrls={{}} availableSources={[{id:50,name:"Medicos",code:"m",datasets:[{id:"specialties",name:"Especialidades",columns}]}]} localDatasets={new Map()} reportName="Medicos" showSampleData={sample}/>);}
 it("renders all rolling headers in both sample and source-only modes",()=>{
  for(const sample of [true,false]){
   const html=render(sample);
   expect((html.match(/<th /g)||[]).length).toBe(24);
   for(const name of columns)expect(html).toContain(name);
  }
 });
 it("uses all configured widths and the report font size instead of a minimum that clips columns",()=>{
  const html=render(true);
  expect(html).toContain("font-size:8px");
  expect(html).toContain("table-layout:fixed");
  expect((html.match(/<col /g)||[]).length).toBe(24);
 });
});


it("renders every column of a future source without report-specific rules",()=>{
 const columns=Array.from({length:100},(_,i)=>`Nova coluna ${i}`);
 const block:CanvasBlock={id:"future",type:"table",x:0,y:0,width:800,height:500,source_id:"new",options:{}};
 const html=renderToStaticMarkup(<BlockPreview block={block} background="#fff" sources={[{id:"new",type:"report",report_id:987,dataset:"future"}]} assets={[]} assetUrls={{}} availableSources={[{id:987,name:"Novo",code:"novo",datasets:[{id:"future",name:"Futuro",columns}]}]} localDatasets={new Map()} reportName="Novo" showSampleData/>);
 expect((html.match(/<th /g)||[]).length).toBe(100);
 expect(html).toContain("Nova coluna 99");
});
