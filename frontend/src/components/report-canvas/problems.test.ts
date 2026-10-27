import { describe, expect, it } from "vitest";
import type {
  CanvasBlock,
  CanvasLayout,
  CatalogSqlSource,
  SourcePreview,
} from "./model";
import { createDefaultLayout } from "./model";
import { computeProblems } from "./problems";

function makeLayoutWithBlocks(
  blocks: CanvasBlock[],
  sources: CanvasLayout["sources"] = [
    { id: "vendas", type: "report", report_id: 10, label: "Vendas" },
  ],
): CanvasLayout {
  const base = createDefaultLayout();
  return {
    ...base,
    sources,
    pages: [{ id: "p1", name: "Página 1", blocks }],
  };
}

const sampleCatalog: CatalogSqlSource[] = [
  {
    id: 10,
    name: "Relatório de Vendas",
    code: "vendas_01",
    columns: ["data_venda", "categoria", "valor", "ativo"],
  },
];

const typedPreview: SourcePreview = {
  columns: [
    { name: "data_venda", type: "date", sample: ["2026-10-15"] },
    { name: "categoria", type: "text", sample: ["Consulta"] },
    { name: "valor", type: "number", sample: ["250.5"] },
    { name: "ativo", type: "boolean", sample: ["true"] },
  ],
  rows: [
    ["2026-10-15", "Consulta", 250.5, true],
    ["2026-10-16", "Exame", 120, true],
  ],
  total_rows: 2,
  truncated: false,
};

describe("computeProblems (diagnóstico puro por bloco)", () => {
  it("formata mensagens em pt-BR no padrão '**<Bloco>** (<Página>): <o que>. <como corrigir>.'", () => {
    const layout = makeLayoutWithBlocks([
      {
        id: "b1",
        type: "bar",
        title: "Receita Mensal",
        x: 20,
        y: 20,
        width: 400,
        height: 240,
      },
    ]);

    const res = computeProblems(layout, {}, sampleCatalog);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      blockId: "b1",
      pageId: "p1",
      severity: "error",
      code: "no_source",
    });
    expect(res[0].message).toMatch(
      /^\*\*Receita Mensal\*\* \(Página 1\): .+\. .+\.$/,
    );
    expect(res[0].fix?.targetTab).toBe("data");
  });

  it("detecta source_missing quando a fonte referenciada não existe", () => {
    const layout = makeLayoutWithBlocks([
      {
        id: "b1",
        type: "table",
        title: "Tabela Órfã",
        x: 20,
        y: 20,
        width: 500,
        height: 220,
        source_id: "fonte_apagada",
      },
    ]);

    const res = computeProblems(layout, {}, sampleCatalog);
    expect(res.map((p) => p.code)).toContain("source_missing");
    expect(res[0].message).toContain("fonte_apagada");
  });

  it("detecta kpi_no_value_field para soma/primeiro, mas aceita contagem sem value_field", () => {
    const layout = makeLayoutWithBlocks([
      {
        id: "k_sum",
        type: "kpi",
        title: "Faturamento",
        x: 20,
        y: 20,
        width: 220,
        height: 120,
        source_id: "vendas",
        options: { aggregate: "sum" },
      },
      {
        id: "k_count",
        type: "kpi",
        title: "Atendimentos",
        x: 260,
        y: 20,
        width: 220,
        height: 120,
        source_id: "vendas",
        options: { aggregate: "count" },
      },
    ]);

    const res = computeProblems(layout, { vendas: typedPreview }, sampleCatalog);
    expect(res).toHaveLength(1);
    expect(res[0].blockId).toBe("k_sum");
    expect(res[0].code).toBe("kpi_no_value_field");
  });

  it("detecta column_missing citando o nome exato da coluna inexistente", () => {
    const layout = makeLayoutWithBlocks([
      {
        id: "c1",
        type: "line",
        title: "Evolução",
        x: 20,
        y: 20,
        width: 420,
        height: 250,
        source_id: "vendas",
        options: {
          x_field: "data_venda",
          y_fields: ["receita_antiga"],
        },
      },
    ]);

    const res = computeProblems(layout, { vendas: typedPreview }, sampleCatalog);
    const missing = res.find((p) => p.code === "column_missing");
    expect(missing).toBeDefined();
    expect(missing?.message).toContain('"receita_antiga"');
  });

  it("detecta y_not_numeric citando coluna e tipo conhecido, mas permite tipo unknown ou contagem", () => {
    const layout = makeLayoutWithBlocks([
      {
        id: "c_txt",
        type: "bar",
        title: "Por Categoria",
        x: 20,
        y: 20,
        width: 420,
        height: 240,
        source_id: "vendas",
        options: {
          x_field: "data_venda",
          y_fields: ["categoria"],
        },
      },
      {
        id: "c_cnt",
        type: "bar",
        title: "Contagem Categoria",
        x: 20,
        y: 280,
        width: 420,
        height: 240,
        source_id: "vendas",
        options: {
          x_field: "data_venda",
          y_fields: ["categoria"],
          y_aggregate: "count",
        },
      },
    ]);

    // Com tipos conhecidos -> erro y_not_numeric apenas em c_txt
    const withTypes = computeProblems(layout, { vendas: typedPreview }, sampleCatalog);
    expect(withTypes).toHaveLength(1);
    expect(withTypes[0].blockId).toBe("c_txt");
    expect(withTypes[0].code).toBe("y_not_numeric");
    expect(withTypes[0].message).toContain('"categoria"');
    expect(withTypes[0].message).toContain("Texto");

    // Sem prévia carregada (tipos unknown do catálogo) -> não bloqueia como y_not_numeric
    const withUnknown = computeProblems(layout, {}, sampleCatalog);
    expect(withUnknown.some((p) => p.code === "y_not_numeric")).toBe(false);
  });

  it("detecta x_not_date_for_group quando x_group é usado em coluna não-data e permite corrigir", () => {
    const layout = makeLayoutWithBlocks([
      {
        id: "c1",
        type: "line",
        title: "Tendência",
        x: 20,
        y: 20,
        width: 420,
        height: 240,
        source_id: "vendas",
        options: {
          x_field: "categoria",
          y_fields: ["valor"],
          x_group: "month",
        },
      },
    ]);

    const res = computeProblems(layout, { vendas: typedPreview }, sampleCatalog);
    const prob = res.find((p) => p.code === "x_not_date_for_group");
    expect(prob).toBeDefined();
    expect(prob?.message).toContain('"categoria"');
    const fixed = prob!.fix!.apply!(layout);
    expect(fixed.pages[0].blocks[0].options?.x_group).toBeUndefined();
  });

  it("detecta too_many_series em pizza (>1) e barras (>6) com fix aplicável", () => {
    const layout = makeLayoutWithBlocks([
      {
        id: "pie1",
        type: "pie",
        title: "Participação",
        x: 20,
        y: 20,
        width: 320,
        height: 240,
        source_id: "vendas",
        options: {
          x_field: "categoria",
          y_fields: ["valor", "valor"],
        },
      },
    ]);

    const res = computeProblems(layout, { vendas: typedPreview }, sampleCatalog);
    const prob = res.find((p) => p.code === "too_many_series");
    expect(prob).toBeDefined();
    const fixed = prob!.fix!.apply!(layout);
    expect(fixed.pages[0].blocks[0].options?.y_fields).toEqual(["valor"]);
  });

  it("detecta pie_negative quando a prévia tem valores negativos e oferece trocar para barras", () => {
    const negPreview: SourcePreview = {
      ...typedPreview,
      rows: [
        ["2026-10-15", "Ajuste", -45.2, true],
        ["2026-10-16", "Consulta", 200, true],
      ],
    };
    const layout = makeLayoutWithBlocks([
      {
        id: "pie_neg",
        type: "pie",
        title: "Saldo",
        x: 20,
        y: 20,
        width: 320,
        height: 240,
        source_id: "vendas",
        options: {
          x_field: "categoria",
          y_fields: ["valor"],
        },
      },
    ]);

    const res = computeProblems(layout, { vendas: negPreview }, sampleCatalog);
    const prob = res.find((p) => p.code === "pie_negative");
    expect(prob).toBeDefined();
    const fixed = prob!.fix!.apply!(layout);
    expect(fixed.pages[0].blocks[0].type).toBe("bar");
  });

  it("detecta points_over_limit (> 500 pontos) e aplica fix 'Agrupar por mês'", () => {
    const bigPreview: SourcePreview = {
      ...typedPreview,
      total_rows: 1284,
      truncated: true,
    };
    const layout = makeLayoutWithBlocks([
      {
        id: "line_big",
        type: "line",
        title: "Série Diária",
        x: 20,
        y: 20,
        width: 440,
        height: 240,
        source_id: "vendas",
        options: {
          x_field: "data_venda",
          y_fields: ["valor"],
        },
      },
    ]);

    const res = computeProblems(layout, { vendas: bigPreview }, sampleCatalog);
    const prob = res.find((p) => p.code === "points_over_limit");
    expect(prob).toBeDefined();
    expect(prob?.message).toContain("1.284");
    expect(prob?.fix?.label).toBe("Agrupar por mês");

    const fixed = prob!.fix!.apply!(layout);
    expect(fixed.pages[0].blocks[0].options?.x_group).toBe("month");
    expect(fixed.pages[0].blocks[0].options?.y_aggregate).toBe("sum");

    // Após agrupar por mês, os 2 registros da amostra caem em 1 mês <= 500
    const afterFix = computeProblems(fixed, { vendas: bigPreview }, sampleCatalog);
    expect(afterFix.some((p) => p.code === "points_over_limit")).toBe(false);
  });

  it("detecta table_widths_mismatch e columns_empty em tabelas com fix funcional", () => {
    const layout = makeLayoutWithBlocks([
      {
        id: "tbl_w",
        type: "table",
        title: "Detalhamento",
        x: 20,
        y: 20,
        width: 540,
        height: 240,
        source_id: "vendas",
        options: {
          columns: ["data_venda", "categoria", "valor"],
          column_widths: [200, 200, 212], // Soma 612 > 540
        },
      },
      {
        id: "tbl_empty",
        type: "table",
        title: "Vazia",
        x: 20,
        y: 280,
        width: 540,
        height: 200,
        source_id: "vendas",
        options: {
          columns: [],
        },
      },
    ]);

    const res = computeProblems(layout, { vendas: typedPreview }, sampleCatalog);
    const wProb = res.find((p) => p.code === "table_widths_mismatch");
    expect(wProb).toBeDefined();
    expect(wProb?.message).toContain("612 px");
    expect(wProb?.message).toContain("540 px");

    const fixedW = wProb!.fix!.apply!(layout);
    const nextWidths = fixedW.pages[0].blocks[0].options?.column_widths || [];
    expect(nextWidths.reduce((a, b) => a + b, 0)).toBe(540);

    const emptyProb = res.find((p) => p.blockId === "tbl_empty" && p.code === "columns_empty");
    expect(emptyProb).toBeDefined();
    const fixedCols = emptyProb!.fix!.apply!(layout);
    expect(fixedCols.pages[0].blocks[1].options?.columns).toEqual([
      "data_venda",
      "categoria",
      "valor",
      "ativo",
    ]);
  });

  it("detecta image_missing, block_out_of_page e text_overflow", () => {
    const longText = Array.from({ length: 20 }, () => "Linha extensa de observação clínica no relatório.").join("\n");
    const layout = makeLayoutWithBlocks([
      {
        id: "img1",
        type: "image",
        title: "Logotipo",
        x: 700,
        y: 20,
        width: 200, // 700 + 200 = 900 > 794 (fora da página)
        height: 120,
      },
      {
        id: "txt1",
        type: "text",
        title: "Resumo",
        x: 20,
        y: 20,
        width: 200,
        height: 60,
        text: longText,
        options: { font_size: 16 },
      },
    ]);

    const res = computeProblems(layout, {}, sampleCatalog);
    const codes = res.map((p) => p.code);
    expect(codes).toContain("block_out_of_page");
    expect(codes).toContain("image_missing");
    expect(codes).toContain("text_overflow");

    const overflow = res.find((p) => p.code === "text_overflow")!;
    expect(overflow.severity).toBe("warning");
    const expanded = overflow.fix!.apply!(layout);
    expect(expanded.pages[0].blocks[1].height).toBeGreaterThan(60);
  });
});
