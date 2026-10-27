import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { placeholderDataset } from "./placeholderData";
import { formatSourceLineageLine, resolveSourceColumnInfos } from "./inspector/inspectorOps";
import type { CanvasBlock, CanvasSource, CatalogSqlSource } from "./model";
import { computeSnapping, rectanglesOverlap, estimateTableHeight, createBlockInLayout } from "./stage/geometry";
import { createDefaultLayout } from "./model";
import TablePreview from "./blocks/TablePreview";
import BlockFrame from "./stage/BlockFrame";

const source: CanvasSource = {id: "dados", type: "report", report_id: 6};
const catalog: CatalogSqlSource = {id: 6, name: "Relatório #6", code: "qa", datasets: [{id: "rows", name: "Registros", columns: ["Paciente", "Quantidade", "Data", "Status"]}]};
const block: CanvasBlock = {id: "t", type: "table", title: "Tabela", source_id: "dados", x: 20, y: 20, width: 500, height: 240};

describe("QA1: dados, linhagem e prévia", () => {
  it("gera exemplos por tipo sem tratar Paciente como quantidade", () => {
    const sample = placeholderDataset(block, source, catalog);
    expect(sample.rows[0]).toEqual(["Exemplo 1", 15, "2026-01-01", "Exemplo 1"]);
    const columns = resolveSourceColumnInfos(source, null, [catalog]);
    expect(columns.map(c => c.type)).toEqual(["text", "number", "date", "text"]);
    expect(formatSourceLineageLine({block, source, columns, availableSources: [catalog]})).toContain("4 de 4 colunas usadas");
  });
  it("renderiza linhas reais carregadas no modo prévia", () => {
    const html = renderToStaticMarkup(<TablePreview block={block} source={source} catalog={catalog} dataset={{columns: ["Paciente"], rows: [["Dado de teste"]]}} fontSize={13} primaryColor="#075b94" axisColor="#526980" showSampleData={false} />);
    expect(html).toContain("Dado de teste");
    expect(html).not.toContain("consultada na geração");
  });
  it("mantém o selo e a ação para rota ausente, inclusive prévia vazia", () => {
    const props = {block, background: "#fff", isSelected: false, isDragging: false, sources: [source], assets: [], assetUrls: {}, availableSources: [catalog], reportName: "QA", showSampleData: false, onStartDrag: () => {}, onStartResize: () => {}, onFocusBlock: () => {}};
    const html = renderToStaticMarkup(<BlockFrame {...props} localDatasets={new Map()} previewState={{status: "unavailable", data: null, error: "Prévia indisponível: o servidor não respondeu à rota de prévia", loadedAt: null}} onLoadSourcePreview={() => {}} />);
    expect(html).toContain("Prévia · indisponível");
    expect(html).toContain("Tentar de novo");
    expect(html).toContain("rota de prévia");
    const empty = renderToStaticMarkup(<BlockFrame {...props} localDatasets={new Map([["dados", {columns: ["Paciente"], rows: []}]])} />);
    expect(empty).toContain("Prévia · 0 linhas");
  });
});

describe("QA1: geometria", () => {
  it("encaixa nas bordas e no centro da folha e em outros blocos", () => {
    const snap = (x:number, y:number, others:CanvasBlock[] = []) => computeSnapping({rect: {x,y,width:100,height:80}, otherBlocks: others, pageWidth:900,pageHeight:1200,columns:1,zoom:1});
    expect(snap(3, 2)).toMatchObject({x:0,y:0});
    expect(snap(403, 563)).toMatchObject({x:400,y:560});
    expect(snap(503, 302, [{...block,x:500,y:300,width:120,height:100}])).toMatchObject({x:500,y:300});
    expect(snap(3,2).guides).toHaveLength(2);
  });
  it("avisa sobre interseção, sem marcar blocos que só encostam", () => {
    expect(rectanglesOverlap(block,{...block,x:50})).toBe(true);
    expect(rectanglesOverlap(block,{...block,x:block.x+block.width})).toBe(false);
    expect(estimateTableHeight(6)).toBeLessThan(300);
    const layout=createDefaultLayout();
    const added=createBlockInLayout({layout,activePageId:layout.pages[0].id,type:"table",assets:[],availableSources:[]});
    expect(added.ok && added.layout.pages[0].blocks.at(-1)?.height).toBeLessThan(300);
  });
});
