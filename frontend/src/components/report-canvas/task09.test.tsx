import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { placeholderDataset } from "./placeholderData";
import { formatSourceLineageLine, resolveSourceColumnInfos } from "./inspector/inspectorOps";
import type { CanvasBlock, CanvasSource, CatalogSqlSource } from "./model";
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
