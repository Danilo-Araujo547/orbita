import BlockFrame, { type BlockFrameProps } from "./stage/BlockFrame";
import { canvasStoreReducer, createCanvasStoreState } from "./state/canvasStore";
import storedLayouts from "../../__fixtures__/canvas/stored-layouts.anonymous.json";
import { renderToStaticMarkup } from "react-dom/server";
import TextPreview from "./blocks/TextPreview";
import { getCachedSourcePreview, setCachedSourcePreview, clearSourcePreviewCache } from "./api/useSourcePreview";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultLayout, normalizeLayout, sanitizeLayoutForApi } from "./model";
import { parsePastedTable } from "./data/sourceOps";
import { aggregateSeries, groupByDate, parseGroupDate, parseNumericValue } from "./stage/dataGrouping";
import { fetchSourcePreviewRequest, isUnavailableStatus } from "./api/useSourcePreview";
import { loadDraftFromStorage, saveDraftToStorage } from "./state/draftRecovery";

afterEach(() => vi.unstubAllGlobals());

describe("QA: importação sem perda silenciosa", () => {
  it("aceita 100 colunas × 2000 linhas e rejeita 5000 linhas antes de importar", () => {
    const header = Array.from({length: 100}, (_, i) => `Coluna ${i}`).join("\t");
    const row = Array(100).fill("0").join("\t");
    const parsed = parsePastedTable([header, ...Array(2000).fill(row)].join("\n"));
    expect(parsed.columns).toHaveLength(100);
    expect(parsed.rows).toHaveLength(2000);
    expect(() => parsePastedTable(["A\tB", ...Array(5000).fill("1\t2")].join("\n"))).toThrow(/2[.]?000 linhas/);
    expect(() => parsePastedTable(Array(101).fill("A").join("\t"))).toThrow(/100 colunas/);
  });
  it("preserva acentos, espaços e nomes de 100 caracteres; desambigua duplicados dentro do limite", () => {
    const name = "á".repeat(100);
    const {columns} = parsePastedTable(`${name}\t${name}\tValor total\tAção`);
    expect(columns[0]).toBe(name);
    expect(columns[1]).not.toBe(name);
    expect(columns.every(c => c.length <= 100)).toBe(true);
    expect(columns.slice(2)).toEqual(["Valor total", "Ação"]);
  });
});

describe("QA: datas e agregação", () => {
  it.each(["2023-02-29", "2024-02-30", "2026-13-01", "2026-00-01", "2026-01-00", "2026-01-01T25:00:00Z", "2026-01-01T12:60:00Z", "2026-01-01T12:00:00+25:00", "29/02/2024", "20261027", "pedido 2026-01-01"])("rejeita data inválida ou fora do contrato ISO: %s", value => {
    expect(() => parseGroupDate(value)).toThrow(/não é uma data/);
  });
  it("aceita bissexto, ignora nulos e preserva o dia escrito no fuso", () => {
    const result = groupByDate({rows: [[null, 99], ["2024-02-29T23:30:00-03:00", 1], ["2024-02-29T01:00:00+04:00", 2]], xColIndex: 0, yColIndices: [1], groupMode: "day"});
    expect(result.rows).toEqual([["29/02/2024", 3]]);
  });
  it("semana 53 atravessa o ano sem separar o mesmo período", () => {
    const result = groupByDate({rows: [["2020-12-31", 1], ["2021-01-01", 2], ["2021-01-04", 4]], xColIndex: 0, yColIndices: [1], groupMode: "week"});
    expect(result.rows).toEqual([["sem. 28/12", 3], ["sem. 04/01", 4]]);
  });
  it.each([NaN, Infinity, -Infinity, "NaN", "Infinity"])("rejeita série não finita: %s", value => expect(() => parseNumericValue(value)).toThrow());
  it("impede overflow na soma e mantém média de números grandes finita", () => {
    expect(() => aggregateSeries("sum", [1e308, 1e308])).toThrow(/numérico/);
    expect(aggregateSeries("avg", [1e308, 1e308])).toBe(1e308);
    expect(aggregateSeries("sum", [null, 0, -1])).toBe(-1);
  });
});

describe("QA: persistência retrocompatível", () => {
  it("não injeta campos opcionais nem altera nomes de coluna válidos", () => {
    const layout = createDefaultLayout();
    layout.sources = [{id: "s", type: "report", report_id: 1}];
    layout.pages[0].blocks = [{id: "b", type: "bar", source_id: "s", x: 0, y: 0, width: 200, height: 100, options: {x_field: " Data ", y_fields: [" Valor "], columns: [], series_colors: []}}];
    expect(sanitizeLayoutForApi(normalizeLayout(layout))).toEqual(layout);
  });
  it("guarda apenas layout e metadados do rascunho, sem cache de prévia", () => {
    const storage = new Map<string, string>();
    const localStorage = {getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v)};
    vi.stubGlobal("window", {localStorage});
    const layout = Object.assign(createDefaultLayout(), {preview: {rows: [["SEGREDO_DA_PREVIA"]]}});
    expect(saveDraftToStorage("qa", 1, 1, {layout, enabled: false, outputFormat: "pdf"})).toBe(true);
    expect([...storage.values()].join()).not.toContain("SEGREDO_DA_PREVIA");
    expect(loadDraftFromStorage("qa", 1, 1)?.layout.schema_version).toBe(1);
  });
});

describe("QA: erros da API sem gravação", () => {
  it.each([401, 403, 404, 405, 503])("propaga erro de prévia HTTP %i", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({detail: `Erro ${status}`}), {status})));
    await expect(fetchSourcePreviewRequest(1, "qa", {id: "s", type: "goals"})).rejects.toThrow();
    expect(isUnavailableStatus(status)).toBe(status === 404 || status === 405);
  });
  it("propaga API fora do ar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchSourcePreviewRequest(1, "qa", {id: "s", type: "goals"})).rejects.toThrow();
  });
});


describe("QA: layouts reais anonimizados", () => {
  it.each(storedLayouts.map((layout, i) => [i + 1, layout] as const))("round-trip do layout %i preserva chaves e ausência de extensões", (_i, layout) => {
    expect(sanitizeLayoutForApi(normalizeLayout(layout))).toEqual(layout);
  });
  it("isola o cache por unidade e relatório", () => {
    clearSourcePreviewCache();
    const source = {id: "s", type: "goals"} as const;
    const data = {columns: [], rows: [[99]], total_rows: 1, truncated: false};
    setCachedSourcePreview(source, data, {}, 50, "unidade-a:1");
    expect(getCachedSourcePreview(source, {}, 50, "unidade-a:1")).toEqual(data);
    expect(getCachedSourcePreview(source, {}, 50, "unidade-b:1")).toBeUndefined();
    expect(getCachedSourcePreview(source, {}, 50, "unidade-a:2")).toBeUndefined();
    expect(getCachedSourcePreview(source)).toBeUndefined();
    clearSourcePreviewCache();
  });
  it("renderiza texto não confiável literalmente, incluindo variável desconhecida, emoji e quebras", () => {
    const text = '<script>alert(1)</script>\n{{inexistente}} 😀';
    const markup = renderToStaticMarkup(<TextPreview block={{id: "b", type: "text", x: 0, y: 0, width: 200, height: 100, text}} fontSize={14} primaryColor="#075b94" sources={[]} availableSources={[]} reportName="QA" showSampleData={false} />);
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("{{inexistente}} 😀");
  });
});


describe("QA: histórico e renderização durante arraste", () => {
  it("troca tipo e fonte, salva e desfaz/refaz toda a cadeia", () => {
    const initial = createDefaultLayout();
    initial.sources = [{id: "s1", type: "goals"}, {id: "s2", type: "goals"}];
    initial.pages[0].blocks = [{id: "b", type: "bar", source_id: "s1", x: 0, y: 0, width: 200, height: 100, options: {x_field: "month", y_fields: ["value"]}}];
    let state = createCanvasStoreState(initial);
    for (const patch of [{type: "line" as const}, {source_id: "s2"}]) {
      state = canvasStoreReducer(state, {type: "apply", label: "Trocar configuração", updater: layout => ({...layout, pages: layout.pages.map(p => ({...p, blocks: p.blocks.map(b => ({...b, ...patch}))}))})});
    }
    const savedLayout = state.layout;
    state = canvasStoreReducer(state, {type: "markSaved"});
    state = canvasStoreReducer(state, {type: "undo"});
    expect(state.layout.pages[0].blocks[0].source_id).toBe("s1");
    expect(state.revision).not.toBe(state.savedRevision);
    state = canvasStoreReducer(state, {type: "undo"});
    expect(state.layout).toEqual(initial);
    state = canvasStoreReducer(canvasStoreReducer(state, {type: "redo"}), {type: "redo"});
    expect(state.layout).toEqual(savedLayout);
    expect(state.revision).toBe(state.savedRevision);
  });
  it("a memoização de 100 BlockFrames invalida só o bloco arrastado por movimento", () => {
    const shared = {isSelected: false, isDragging: false, background: "#ffffff", sources: [], assets: [], assetUrls: {}, availableSources: [], localDatasets: new Map(), reportName: "QA", showSampleData: false, onStartDrag: vi.fn(), onStartResize: vi.fn(), onFocusBlock: vi.fn()};
    const props: BlockFrameProps[] = Array.from({length: 100}, (_, i) => ({...shared, block: {id: `b${i}`, type: "text", x: 0, y: 0, width: 200, height: 100}}));
    const compare = (BlockFrame as unknown as {compare: (a: BlockFrameProps, b: BlockFrameProps) => boolean}).compare;
    for (let step = 1; step <= 10; step++) {
      const next = props.map((p, i) => i === 0 ? {...p, tempGeometry: {x: step, y: step, width: 200, height: 100}} : p);
      expect(next.filter((p, i) => !compare(props[i], p))).toHaveLength(1);
      props.splice(0, props.length, ...next);
    }
  });
});


it.each(["__proto__", "constructor", "toString"])("ignora tipo de bloco herdado do protótipo: %s", type => {
  const raw = createDefaultLayout();
  const untrusted = {...raw, pages: [{id: "p1", name: "QA", blocks: [{id: "b", type, x: 0, y: 0, width: 20, height: 20}]}]};
  expect(normalizeLayout(untrusted).pages[0].blocks).toEqual([]);
});


it("storage indisponível e rascunho corrompido não derrubam o editor", () => {
  vi.stubGlobal("window", Object.defineProperty({}, "localStorage", {get() {throw new Error("SecurityError");}}));
  expect(loadDraftFromStorage("qa", 1, 1)).toBeNull();
  expect(saveDraftToStorage("qa", 1, 1, {layout: createDefaultLayout(), enabled: false, outputFormat: "pdf"})).toBe(false);
  vi.stubGlobal("window", {localStorage: {getItem: () => JSON.stringify({layout: {schema_version: 1, pages: []}})}});
  expect(loadDraftFromStorage("qa", 1, 1)).toBeNull();
});


it("preserva casas decimais, cores em maiúsculas e campos opcionais vazios válidos", () => {
  const layout = createDefaultLayout();
  layout.page.background = "#FFFFFF";
  layout.page.width = 794.12345;
  layout.sources = [{id: "s", type: "goals", label: ""}];
  layout.pages[0].name = " Página ";
  layout.pages[0].blocks = [{id: "b", type: "text", x: 0.12345, y: 0.33333, width: 200.12345, height: 100.12345, title: "", text: "", options: {x_field: "", value_field: "", color: "#ABCDEF", series_colors: ["#ABCDEF"]}}];
  expect(sanitizeLayoutForApi(normalizeLayout(layout))).toEqual(layout);
});
