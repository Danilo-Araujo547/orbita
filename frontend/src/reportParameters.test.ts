import {describe,it,expect} from "vitest";
import {queryParameters,queryParameterRanges,readParameterSchema,renameParameter,suggestedParameter} from "./components/reportParameters";
describe("Report parameter registration",()=>{
 it("extracts only executable SQL bindings, de-duplicated",()=>{
  expect(queryParameters(`select ':fake', "column:other", q'[don't :qfake]' from t -- :comment
    where d >= :data_inicial and d<=:data_final and a=:data_inicial /* :skip */ and b::text=:nome`)).toEqual(["data_inicial","data_final","nome"]);
 });
 it("maps highlighting ranges to the exact binds, including repeated names",()=>{
  const sql="select ':skip', q'[x :skip]' from t where d=:inicio OR d=:inicio and v::text=:fim -- :skip";
  expect(queryParameterRanges(sql).map(r=>sql.slice(r.start,r.end))).toEqual([":inicio",":inicio",":fim"]);
  expect(queryParameterRanges("select '<img src=x>' from t")).toEqual([]);
 });
 it("preserves legacy shorthand, metadata and date relationships on rename",()=>{
  const schema=readParameterSchema('{"start":"date","end":{"type":"date","not_before":"start","prompt":"Fim","custom":"kept"}}');
  const next=renameParameter(schema,"start","inicio",{...schema.start,label:"Início",required:true});
  expect(next.end.not_before).toBe("inicio");expect(next.end.custom).toBe("kept");expect(schema.end.not_before).toBe("start");
  expect(()=>renameParameter(schema,"start","end",schema.start)).toThrow("Já existe");
  expect(()=>renameParameter(schema,"","inválido",{type:"string"})).toThrow("sem espaços");
 });
 it("suggests editable typed fields without replacing existing configuration",()=>{
  expect(suggestedParameter("data_inicial",1)).toMatchObject({type:"date",label:"Data inicial",order:1});
  expect(suggestedParameter("mes",2)).toMatchObject({type:"integer",minimum:1,maximum:12});
 });
});
