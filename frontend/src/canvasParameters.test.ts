import {describe,it,expect} from "vitest";
import {testParameters,displayParameter,collectTestParameters} from "./components/report-canvas/parameters";
describe("Canvas parameter form",()=>{
 it("reads shorthand and readable labels, retaining explicit labels",()=>{
  expect(testParameters({start_date:"date",custom:{type:"integer",label:"Unidade"}}).map(f=>f.label)).toEqual(["Data inicial","Unidade"]);
 });
 it("converts Brazilian dates and enforces interval ordering",()=>{
  const fields=testParameters({start_date:{type:"date"},end_date:{type:"date",not_before:"start_date"}});
  expect(collectTestParameters(fields,{start_date:"25/10/2026",end_date:"26/10/2026"})).toEqual({start_date:"2026-10-25",end_date:"2026-10-26"});
  expect(()=>collectTestParameters(fields,{start_date:"25/10/2026",end_date:"24/10/2026"})).toThrow("posterior");
  expect(()=>collectTestParameters(fields,{start_date:"31/02/2026"})).toThrow("inválida");
 });
 it("omits optional blanks and preserves zero/default dates",()=>{
  const fields=testParameters({count:{type:"integer",minimum:0},note:{type:"string",required:false}});
  expect(collectTestParameters(fields,{count:"0",note:""})).toEqual({count:0});
  expect(displayParameter("2026-10-25","date")).toBe("25/10/2026");
 });
 it("rejects invalid options and numeric constraints before requesting preview",()=>{
  const fields=testParameters({unit:{type:"integer",minimum:1,maximum:3},kind:{type:"string",enum:["A","B"]}});
  expect(()=>collectTestParameters(fields,{unit:"4",kind:"A"})).toThrow("intervalo");
  expect(()=>collectTestParameters(fields,{unit:"2",kind:"C"})).toThrow("opção");
  expect(()=>collectTestParameters(fields,{unit:"2.5",kind:"A"})).toThrow("número");
  expect(()=>collectTestParameters(fields,{unit:"",kind:"A"})).toThrow("Informe");
 });
});
