import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CanvasBlock,
  CanvasLayout,
  CatalogSqlSource,
  ColumnInfo,
  SourcePreview,
} from "../model";
import {
  NEW_SERIES_PALETTE,
  createDefaultLayout,
  normalizeLayout,
  sanitizeLayoutForApi,
} from "../model";
import Inspector from "./Inspector";
import ColumnSelect, {
  getDisabledNumericReason,
  isNumericColumnAllowed,
} from "./fields/ColumnSelect";
import {
  adjustWidthsProportionally,
  computeKpiPreviewSample,
  computeSmartDefaults,
  convertChartTypePreservingFields,
  formatDateGroupPreview,
  formatSourceLineageLine,
  interpolateTextPreview,
  remapColumnsForNewSource,
} from "./inspectorOps";

describe("Normalização e sanitização de novas opções do Canvas (round-trip)", () => {
  it("preserva x_group, y_aggregate, series_colors e xlsx_mode em round-trip sem perda", () => {
    const raw: CanvasLayout = {
      schema_version: 1,
      xlsx_mode: "table",
      page: { width: 794, height: 1123, columns: 24, background: "#ffffff" },
      sources: [{ id: "atend", type: "report", report_id: 7, label: "Atendimentos" }],
      pages: [
        {
          id: "p1",
          name: "Página 1",
          blocks: [
            {
              id: "b1",
              type: "line",
              title: "Evolução Mensal",
              x: 40,
              y: 40,
              width: 500,
              height: 260,
              source_id: "atend",
              options: {
                color: "#075B94",
                font_size: 14,
                x_field: "dt_atendimento",
                y_fields: ["qtd_confirmados", "qtd_faltas"],
                x_group: "month",
                y_aggregate: "sum",
                series_colors: ["#075B94", "#C2610C", "#0F7F73"],
              },
            },
          ],
        },
      ],
    };

    const normalized = normalizeLayout(raw);
    expect(normalized.xlsx_mode).toBe("table");
    const opt = normalized.pages[0].blocks[0].options!;
    expect(opt.x_group).toBe("month");
    expect(opt.y_aggregate).toBe("sum");
    expect(opt.series_colors).toEqual(["#075b94", "#c2610c", "#0f7f73"]);

    const sanitized = sanitizeLayoutForApi(normalized);
    const roundTrip = normalizeLayout(JSON.parse(JSON.stringify(sanitized)));
    expect(roundTrip).toEqual(sanitized);
  });

  it("descarta valores inválidos em x_group, y_aggregate, series_colors e xlsx_mode", () => {
    const dirty = {
      schema_version: 1,
      xlsx_mode: "invalido",
      page: { width: 794, height: 1123, columns: 24, background: "#ffffff" },
      sources: [{ id: "s1", type: "inline", columns: ["a", "b"], rows: [[1, 2]] }],
      pages: [
        {
          id: "p1",
          name: "Página 1",
          blocks: [
            {
              id: "b1",
              type: "bar",
              x: 10,
              y: 10,
              width: 300,
              height: 200,
              source_id: "s1",
              options: {
                x_field: "a",
                y_fields: ["b"],
                x_group: "century",
                y_aggregate: "median",
                series_colors: ["not-a-color", "#123456", "#GGGGGG"],
              },
            },
          ],
        },
      ],
    };

    const normalized = normalizeLayout(dirty);
    expect(normalized.xlsx_mode).toBeUndefined();
    const opt = normalized.pages[0].blocks[0].options!;
    expect(opt.x_group).toBeUndefined();
    expect(opt.y_aggregate).toBeUndefined();
    expect(opt.series_colors).toEqual(["#123456"]);
  });
});

describe("Defaults inteligentes, remapeamento de colunas e larguras proporcionais", () => {
  const typedCols: ColumnInfo[] = [
    { name: "unidade", type: "text" },
    { name: "dt_agenda", type: "date" },
    { name: "observacao", type: "text" },
    { name: "total_liquido", type: "number" },
  ];

  const unknownCols: ColumnInfo[] = [
    { name: "col_a", type: "unknown" },
    { name: "col_b", type: "unknown" },
  ];

  it("computeSmartDefaults escolhe data/texto no X, numérica no Y e agrupa data por mês", () => {
    const dateFirstCols: ColumnInfo[] = [
      { name: "dt_agenda", type: "date" },
      { name: "unidade", type: "text" },
      { name: "total_liquido", type: "number" },
    ];

    const chartDefaults = computeSmartDefaults("line", dateFirstCols, { isNewChart: true });
    expect(chartDefaults).toEqual({
      x_field: "dt_agenda",
      y_fields: ["total_liquido"],
      x_group: "month",
      y_aggregate: "sum",
      series_colors: [...NEW_SERIES_PALETTE],
    });

    // KPI escolhe a primeira coluna numérica real (índice 3), nunca a 2ª coluna às cegas
    const kpiDefaults = computeSmartDefaults("kpi", typedCols);
    expect(kpiDefaults).toEqual({ value_field: "total_liquido" });
  });

  it("computeSmartDefaults deixa campos vazios quando tipos são desconhecidos (sem chute cego)", () => {
    expect(computeSmartDefaults("bar", unknownCols, { isNewChart: true })).toEqual({
      series_colors: [...NEW_SERIES_PALETTE],
      x_field: undefined,
      y_fields: undefined,
      x_group: undefined,
      y_aggregate: undefined,
    });
    expect(computeSmartDefaults("kpi", unknownCols)).toEqual({
      value_field: undefined,
    });
  });

  it("remapColumnsForNewSource remapeia por nome (case/acento-insensível) e preserva ausentes", () => {
    const block: CanvasBlock = {
      id: "b1",
      type: "bar",
      x: 0,
      y: 0,
      width: 400,
      height: 240,
      source_id: "src_old",
      options: {
        x_field: "Mês",
        y_fields: ["Valor_Total", "Meta_Antiga"],
      },
    };
    const nextCols: ColumnInfo[] = [
      { name: "mes", type: "text" },
      { name: "valor_total", type: "number" },
      { name: "custo", type: "number" },
    ];

    const res = remapColumnsForNewSource(block, nextCols);
    expect(res.matchedCount).toBe(2);
    expect(res.missingColumns).toEqual(["Meta_Antiga"]);
    // Meta_Antiga NÃO some silenciosamente — permanece para o problems.ts acusar column_missing
    expect(res.options.x_field).toBe("mes");
    expect(res.options.y_fields).toEqual(["valor_total", "Meta_Antiga"]);
  });

  it("adjustWidthsProportionally escala larguras inteiras somando exatamente a largura do bloco", () => {
    const scaled = adjustWidthsProportionally([200, 200, 212], 540);
    expect(scaled).toHaveLength(3);
    expect(scaled.every((n) => Number.isInteger(n) && n >= 1)).toBe(true);
    expect(scaled.reduce((a, b) => a + b, 0)).toBe(540);

    const equalInit = adjustWidthsProportionally([], 500, 4);
    expect(equalInit).toEqual([125, 125, 125, 125]);
  });

  it("convertChartTypePreservingFields preserva campos e mantém 1ª série ao ir para pizza", () => {
    const barBlock: CanvasBlock = {
      id: "c1",
      type: "bar",
      x: 20,
      y: 20,
      width: 400,
      height: 250,
      source_id: "s1",
      options: {
        x_field: "dt_agenda",
        y_fields: ["confirmados", "faltas"],
        x_group: "month",
        y_aggregate: "sum",
      },
    };

    const toLine = convertChartTypePreservingFields(barBlock, "line");
    expect(toLine.droppedExtraSeriesCount).toBe(0);
    expect(toLine.block.options?.y_fields).toEqual(["confirmados", "faltas"]);

    const toPie = convertChartTypePreservingFields(barBlock, "pie");
    expect(toPie.droppedExtraSeriesCount).toBe(1);
    expect(toPie.block.type).toBe("pie");
    expect(toPie.block.options?.y_fields).toEqual(["confirmados"]);
    expect(toPie.block.options?.x_field).toBe("dt_agenda");
  });
});

describe("ColumnSelect, prévia temporal, amostra de KPI e interpolação", () => {
  it("bloqueia colunas de texto/data/booleano para séries numéricas e aceita unknown com aviso", () => {
    expect(isNumericColumnAllowed({ name: "v", type: "number" })).toBe(true);
    expect(isNumericColumnAllowed({ name: "u", type: "unknown" })).toBe(true);
    expect(isNumericColumnAllowed({ name: "t", type: "text" })).toBe(false);
    expect(getDisabledNumericReason("text")).toBe("Texto — não pode ser somado");
    expect(getDisabledNumericReason("date")).toBe("Data — não pode ser somada");

    const unknownWarnHtml = renderToStaticMarkup(
      <ColumnSelect
        label="Valor"
        value="col_incerta"
        onlyNumeric={true}
        columns={[{ name: "col_incerta", type: "unknown" }]}
        onChange={() => {}}
      />,
    );
    expect(unknownWarnHtml).toContain("Tipo desconhecido");
  });

  it("formata rótulos de agrupamento temporal em pt-BR idênticos ao backend", () => {
    expect(formatDateGroupPreview("day", "2026-10-27")).toBe("27/10/2026");
    expect(formatDateGroupPreview("week", "2026-10-27")).toBe("sem. 26/10");
    expect(formatDateGroupPreview("month", "2026-10-27")).toBe("out/26");
    expect(formatDateGroupPreview("quarter", "2026-10-27")).toBe("T4/26");
    expect(formatDateGroupPreview("year", "2026-10-27")).toBe("2026");
  });

  it("calcula amostra do KPI e interpola variáveis de texto e linhagem", () => {
    const kpi: CanvasBlock = {
      id: "k1",
      type: "kpi",
      x: 0,
      y: 0,
      width: 220,
      height: 120,
      options: { aggregate: "sum", value_field: "total", precision: 1 },
    };
    const cols: ColumnInfo[] = [{ name: "total", type: "number" }];
    const sample = computeKpiPreviewSample(kpi, cols, [[10000], [2480.5]]);
    expect(sample).toBe("= 12.480,5");

    const textOut = interpolateTextPreview(
      "Relatório: {{report_name}} — Ref: {{atend.dt_ref}}",
      {
        reportName: "Produção Mensal",
        sources: [
          {
            id: "atend",
            type: "inline",
            columns: ["dt_ref"],
            rows: [["2026-10-01"]],
          },
        ],
      },
    );
    expect(textOut).toBe("Relatório: Produção Mensal — Ref: 01/10/2026");

    const lineage = formatSourceLineageLine({
      block: {
        id: "c1",
        type: "line",
        x: 0,
        y: 0,
        width: 400,
        height: 240,
        source_id: "atend",
        options: { x_field: "dt_atend", y_fields: ["qtd"] },
      },
      source: { id: "atend", type: "report", report_id: 5, dataset: "rows" },
      columns: [
        { name: "dt_atend", type: "date" },
        { name: "qtd", type: "number" },
        { name: "unidade", type: "text" },
        { name: "medico", type: "text" },
      ],
      availableSources: [
        {
          id: 5,
          name: "Atendimentos",
          code: "atend_05",
          datasets: [{ id: "rows", name: "Registros", columns: ["dt_atend", "qtd", "unidade", "medico"] }],
        },
      ],
      totalRows: 128,
    });
    expect(lineage).toBe("Atendimentos › Registros · 2 de 4 colunas usadas · prévia de 128 linhas");
  });
});

describe("Renderização do Inspector (Página, Conteúdo, Aparência e Dados)", () => {
  const catalog: CatalogSqlSource[] = [
    {
      id: 5,
      name: "Atendimentos",
      code: "atend_05",
      datasets: [{ id: "rows", name: "Registros", columns: ["dt_atend", "qtd", "unidade"] }],
    },
  ];

  const preview1284: SourcePreview = {
    columns: [
      { name: "dt_atend", type: "date", sample: ["2026-10-15"] },
      { name: "qtd", type: "number", sample: ["42"] },
      { name: "unidade", type: "text", sample: ["Centro"] },
    ],
    rows: [
      ["2026-10-15", 42, "Centro"],
      ["2026-10-16", 38, "Norte"],
    ],
    total_rows: 1284,
    truncated: true,
  };

  it("renderiza PageInspector quando nenhum bloco está selecionado e valida regra de tabela única no XLSX", () => {
    const layout: CanvasLayout = {
      ...createDefaultLayout(),
      xlsx_mode: "table",
    };

    const html = renderToStaticMarkup(
      <Inspector
        rightOpen={true}
        selectedBlock={null}
        activePage={layout.pages[0]}
        layout={layout}
        inspectorTab="content"
        pageConfig={layout.page}
        outputFormat="xlsx"
        xlsxMode="table"
        sources={[]}
        assets={[]}
        uploadingAsset={false}
        knownColumns={[]}
        resolveKnownColumns={() => []}
        onSelectBlock={() => {}}
        onChangeTab={() => {}}
        onReorderLayer={() => {}}
        onDuplicateBlock={() => {}}
        onRemoveBlock={() => {}}
        onTriggerImageUpload={() => {}}
        onOpenCreateSource={() => {}}
        onColumnWidthsValidation={() => {}}
        onUpdateBlock={() => {}}
        onChangeXlsxMode={() => {}}
      />,
    );

    expect(html).toContain("Propriedades da página");
    expect(html).toContain("A4 retrato (794 × 1123 px)");
    expect(html).toContain("A4 paisagem (1123 × 794 px)");
    expect(html).toContain("Carta (816 × 1056 px)");
    expect(html).toContain("Modo Tabela exige uma única tabela no relatório");
  });

  it("renderiza construtor de gráfico guiado com agrupamento, aba Dados e desabilita agrupamento sem suporte do servidor", () => {
    const lineBlock: CanvasBlock = {
      id: "b_line",
      type: "line",
      title: "Atendimentos por Mês",
      x: 30,
      y: 40,
      width: 460,
      height: 260,
      source_id: "atend",
      options: {
        x_field: "dt_atend",
        y_fields: ["qtd"],
        x_group: "month",
        y_aggregate: "sum",
      },
    };
    const layout: CanvasLayout = {
      ...createDefaultLayout(),
      sources: [{ id: "atend", type: "report", report_id: 5, label: "Atendimentos", dataset: "rows" }],
      pages: [{ id: "p1", name: "Página 1", blocks: [lineBlock] }],
    };

    const contentHtml = renderToStaticMarkup(
      <Inspector
        rightOpen={true}
        selectedBlock={lineBlock}
        activePage={layout.pages[0]}
        layout={layout}
        inspectorTab="content"
        pageConfig={layout.page}
        sources={layout.sources}
        availableSources={catalog}
        sourcePreviews={{ atend: preview1284 }}
        assets={[]}
        uploadingAsset={false}
        knownColumns={["dt_atend", "qtd", "unidade"]}
        resolveKnownColumns={() => ["dt_atend", "qtd", "unidade"]}
        onSelectBlock={() => {}}
        onChangeTab={() => {}}
        onReorderLayer={() => {}}
        onDuplicateBlock={() => {}}
        onRemoveBlock={() => {}}
        onTriggerImageUpload={() => {}}
        onOpenCreateSource={() => {}}
        onColumnWidthsValidation={() => {}}
        onUpdateBlock={() => {}}
      />,
    );

    expect(contentHtml).toContain('role="tablist"');
    expect(contentHtml).toContain("Conteúdo");
    expect(contentHtml).toContain("Aparência");
    expect(contentHtml).toContain("Dados");
    expect(contentHtml).toContain("Agrupar por");
    expect(contentHtml).toContain("Ex.: out/26");
    expect(contentHtml).toContain("1/6");

    // Servidor sem endpoint novo -> controle de agrupamento desabilitado com "Requer atualização do servidor"
    const unavailableHtml = renderToStaticMarkup(
      <Inspector
        rightOpen={true}
        selectedBlock={lineBlock}
        activePage={layout.pages[0]}
        layout={layout}
        inspectorTab="content"
        pageConfig={layout.page}
        sources={layout.sources}
        availableSources={catalog}
        forcePreviewUnavailable={true}
        assets={[]}
        uploadingAsset={false}
        knownColumns={["dt_atend", "qtd", "unidade"]}
        resolveKnownColumns={() => ["dt_atend", "qtd", "unidade"]}
        onSelectBlock={() => {}}
        onChangeTab={() => {}}
        onReorderLayer={() => {}}
        onDuplicateBlock={() => {}}
        onRemoveBlock={() => {}}
        onTriggerImageUpload={() => {}}
        onOpenCreateSource={() => {}}
        onColumnWidthsValidation={() => {}}
        onUpdateBlock={() => {}}
      />,
    );
    expect(unavailableHtml).toContain("Requer atualização do servidor");

    // Aba Aparência -> Paleta original + botão "Usar paleta nova"
    const appearanceHtml = renderToStaticMarkup(
      <Inspector
        rightOpen={true}
        selectedBlock={lineBlock}
        activePage={layout.pages[0]}
        layout={layout}
        inspectorTab="appearance"
        pageConfig={layout.page}
        sources={layout.sources}
        availableSources={catalog}
        sourcePreviews={{ atend: preview1284 }}
        assets={[]}
        uploadingAsset={false}
        knownColumns={["dt_atend", "qtd", "unidade"]}
        resolveKnownColumns={() => ["dt_atend", "qtd", "unidade"]}
        onSelectBlock={() => {}}
        onChangeTab={() => {}}
        onReorderLayer={() => {}}
        onDuplicateBlock={() => {}}
        onRemoveBlock={() => {}}
        onTriggerImageUpload={() => {}}
        onOpenCreateSource={() => {}}
        onColumnWidthsValidation={() => {}}
        onUpdateBlock={() => {}}
      />,
    );
    expect(appearanceHtml).toContain("Paleta original");
    expect(appearanceHtml).toContain("Usar paleta nova");

    // Aba Dados sem agrupamento -> exibe aviso de > 500 pontos (1.284) e mini-prévia
    const ungroupedLine: CanvasBlock = {
      ...lineBlock,
      options: { x_field: "dt_atend", y_fields: ["qtd"] },
    };
    const dataHtml = renderToStaticMarkup(
      <Inspector
        rightOpen={true}
        selectedBlock={ungroupedLine}
        activePage={{ id: "p1", name: "Página 1", blocks: [ungroupedLine] }}
        inspectorTab="data"
        pageConfig={layout.page}
        sources={layout.sources}
        availableSources={catalog}
        sourcePreviews={{ atend: preview1284 }}
        assets={[]}
        uploadingAsset={false}
        knownColumns={["dt_atend", "qtd", "unidade"]}
        resolveKnownColumns={() => ["dt_atend", "qtd", "unidade"]}
        onSelectBlock={() => {}}
        onChangeTab={() => {}}
        onReorderLayer={() => {}}
        onDuplicateBlock={() => {}}
        onRemoveBlock={() => {}}
        onTriggerImageUpload={() => {}}
        onOpenCreateSource={() => {}}
        onColumnWidthsValidation={() => {}}
        onUpdateBlock={() => {}}
      />,
    );
    expect(dataHtml).toContain("Atendimentos › Registros · 2 de 3 colunas usadas · prévia de 1.284 linhas");
    expect(dataHtml).toContain("Gráfico aceita até 500 pontos — este tem 1.284");
    expect(dataHtml).toContain("Agrupar por mês");
    expect(dataHtml).toContain("15/10/2026");
  });
});
