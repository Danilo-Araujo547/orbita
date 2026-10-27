import {describe,it,expect} from "vitest";
import {readRoute} from "./routes";
import {normalizeLayout,sanitizeLayoutForApi} from "./components/report-canvas/model";
describe("editor de relatórios em rota própria",()=>{
 it("abre o relatório certo e preserva as rotas existentes",()=>{
  expect(readRoute("/relatorios/50/canvas")).toEqual({page:"reports",groupId:null,canvasId:50});
  expect(readRoute("/relatorios/50/canvas/").canvasId).toBe(50);
  expect(readRoute("/relatorios")).toEqual({page:"reports",groupId:null});
  expect(readRoute("/relatorios/abc/canvas").canvasId).toBeUndefined();
 });
 it("preserva os conjuntos de dados e larguras ao reabrir e salvar",()=>{
  const layout=normalizeLayout({schema_version:1,page:{width:1120,height:820,columns:24,background:"#ffffff"},sources:[{id:"permanencia",type:"report",report_id:50,dataset:"stays",parameters:{data_referencia:{parameter:"data_referencia"}}}],pages:[{id:"p1",name:"Permanência",blocks:[{id:"t1",type:"table",x:32,y:100,width:1048,height:600,source_id:"permanencia",options:{column_widths:[234,54,54]}}]}]});
  const saved=sanitizeLayoutForApi(layout);
  expect(saved.sources[0]).toMatchObject({report_id:50,dataset:"stays",parameters:{data_referencia:{parameter:"data_referencia"}}});
  expect(saved.pages[0].blocks[0].options?.column_widths).toEqual([234,54,54]);
  layout.pages[0].blocks[0].type="text";
  layout.pages[0].blocks[0].text="Atualizado até {{permanencia.data}}";
  expect(sanitizeLayoutForApi(layout).pages[0].blocks[0].source_id).toBe("permanencia");
 });
});
