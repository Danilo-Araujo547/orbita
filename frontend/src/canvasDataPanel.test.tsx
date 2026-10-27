import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DataPanel from "./components/report-canvas/data/DataPanel";
import DataDrawer from "./components/report-canvas/data/DataDrawer";
import ColumnBadge from "./components/report-canvas/data/ColumnBadge";
import type { CanvasSource, CatalogSqlSource, SourcePreview } from "./components/report-canvas/model";
import { createDefaultLayout } from "./components/report-canvas/model";

describe("Componente DataPanel (painel de fontes e colunas)", () => {
  const sources: CanvasSource[] = [
    {
      id: "src_faturamento",
      type: "report",
      report_id: 10,
      label: "Faturamento Mensal",
    },
    {
      id: "src_manual",
      type: "inline",
      label: "Tabela de Preços",
      columns: ["Procedimento", "Valor"],
      rows: [["Consulta", 150]],
    },
  ];

  const availableSources: CatalogSqlSource[] = [
    {
      id: 10,
      name: "Relatório Financeiro",
      code: "fin-01",
      columns: ["data", "valor", "status"],
    },
  ];

  it("renderiza cabeçalho com contador 2/30 e botão 'Adicionar fonte'", () => {
    const html = renderToStaticMarkup(
      <DataPanel
        active={true}
        sources={sources}
        availableSources={availableSources}
        layout={createDefaultLayout()}
        onCreateSource={() => {}}
        onEditSource={() => {}}
        onRemoveSource={() => {}}
      />,
    );

    expect(html).toContain("Fontes");
    expect(html).toContain("2/30");
    expect(html).toContain("Adicionar fonte");
    expect(html).toContain("Faturamento Mensal");
    expect(html).toContain("Tabela de Preços");
    expect(html).toContain("Relatório Financeiro");
  });

  it("renderiza estado vazio quando não há fontes cadastradas", () => {
    const html = renderToStaticMarkup(
      <DataPanel
        active={true}
        sources={[]}
        availableSources={availableSources}
        layout={createDefaultLayout()}
        onCreateSource={() => {}}
        onEditSource={() => {}}
        onRemoveSource={() => {}}
      />,
    );

    expect(html).toContain("Nenhuma fonte. Adicione uma fonte para ligar dados aos blocos.");
  });

  it("renderiza badge de tipo ColumnBadge com os glifos e aria-labels esperados", () => {
    const numHtml = renderToStaticMarkup(<ColumnBadge type="number" />);
    expect(numHtml).toContain("123");
    expect(numHtml).toContain('aria-label="Tipo de dado: Número"');

    const dateHtml = renderToStaticMarkup(<ColumnBadge type="date" />);
    expect(dateHtml).toContain('aria-label="Tipo de dado: Data"');

    const boolHtml = renderToStaticMarkup(<ColumnBadge type="boolean" />);
    expect(boolHtml).toContain("✓/✗");
    expect(boolHtml).toContain('aria-label="Tipo de dado: Booleano"');

    const textHtml = renderToStaticMarkup(<ColumnBadge type="text" />);
    expect(textHtml).toContain("Aa");
    expect(textHtml).toContain('aria-label="Tipo de dado: Texto"');

    const unkHtml = renderToStaticMarkup(<ColumnBadge type="unknown" />);
    expect(unkHtml).toContain("—");
    expect(unkHtml).toContain('aria-label="Coluna com tipo não detectado"');
  });
});

describe("Componente DataDrawer (gaveta Ver dados)", () => {
  const source: CanvasSource = {
    id: "vendas",
    type: "report",
    report_id: 1,
    label: "Vendas do Mês",
  };

  const preview: SourcePreview = {
    columns: [
      { name: "mes", type: "text", nullable: false, null_count: 0 },
      { name: "total", type: "number", nullable: true, null_count: 1 },
    ],
    rows: [
      ["Janeiro", 15200.5],
      ["Fevereiro", null],
    ],
    total_rows: 2,
    truncated: false,
    elapsed_ms: 12,
  };

  it("renderiza cabeçalho, contador '2 de 2 linhas', tabela e valores formatados", () => {
    const html = renderToStaticMarkup(
      <DataDrawer
        source={source}
        preview={preview}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Dados: Vendas do Mês");
    expect(html).toContain("2 de 2 linhas");
    expect(html).toContain("Copiar TSV");
    expect(html).toContain("mes");
    expect(html).toContain("total");
    expect(html).toContain("Janeiro");
    expect(html).toContain("15.200,5");
    expect(html).toContain("—"); // nulo como travessão
  });
});
