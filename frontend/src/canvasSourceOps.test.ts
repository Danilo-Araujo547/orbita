import { describe, expect, it } from "vitest";
import {
  applyRemovedSourceToLayout,
  applySavedSourceToLayout,
  createSourceModalState,
  editSourceModalState,
  findSourceUsages,
  parsePastedTable,
  parseSourceModalState,
  slugifySourceName,
  validateSourceId,
} from "./components/report-canvas/data/sourceOps";
import type { CanvasSource, CatalogSqlSource, SourceDialogState } from "./components/report-canvas/model";
import { createDefaultLayout } from "./components/report-canvas/model";

describe("Operações de identificadores e fontes (sourceOps)", () => {
  const existingSources: CanvasSource[] = [
    { id: "vendas", type: "goals", label: "Metas de Vendas" },
    { id: "atendimentos", type: "inline", columns: ["Mes", "Qtd"], rows: [["Jan", 10]] },
  ];

  it("valida identificadores técnicos de acordo com IDENT_RE", () => {
    expect(validateSourceId("dados1", existingSources).ok).toBe(true);
    expect(validateSourceId("faturamento_mensal", existingSources).ok).toBe(true);
    expect(validateSourceId("fonte-2026", existingSources).ok).toBe(true);

    // Inválidos
    expect(validateSourceId("", existingSources).ok).toBe(false);
    expect(validateSourceId("1dados", existingSources).ok).toBe(false);
    expect(validateSourceId("meu dado", existingSources).ok).toBe(false);
    expect(validateSourceId("fonte@teste", existingSources).ok).toBe(false);
    expect(validateSourceId("a".repeat(51), existingSources).ok).toBe(false);
  });

  it("impede identificadores duplicados, exceto na edição do próprio registro", () => {
    expect(validateSourceId("vendas", existingSources).ok).toBe(false);
    expect(validateSourceId("vendas", existingSources, "vendas").ok).toBe(true);
  });

  it("gera slug amigável e válido a partir do nome da fonte", () => {
    expect(slugifySourceName("Faturamento Mensal")).toBe("faturamento_mensal");
    expect(slugifySourceName("Metas & Indicadores 2026")).toBe("metas_indicadores_2026");
    expect(slugifySourceName("Produção Hospitalar (SUS)")).toBe("producao_hospitalar_sus");
    // Se começar com número, adiciona prefixo src_
    expect(slugifySourceName("2026 Relatório")).toBe("src_2026_relatorio");
  });
});

describe("Colagem e importação de tabelas manuais (parsePastedTable)", () => {
  it("detecta tabulação (TSV copiado do Excel/Sheets) e extrai colunas e linhas", () => {
    const tsv = "Mes\tTotal\tStatus\nJan\t100\tAtivo\nFev\t250\tPendente";
    const res = parsePastedTable(tsv);
    expect(res.columns).toEqual(["Mes", "Total", "Status"]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual(["Jan", 100, "Ativo"]);
    expect(res.rows[1]).toEqual(["Fev", 250, "Pendente"]);
  });

  it("detecta CSV delimitado por ponto-e-vírgula e converte decimais com vírgula", () => {
    const csv = "Setor;Faturamento;Atingido\nUTI;15200,50;true\nEnfermaria;8400,00;false";
    const res = parsePastedTable(csv);
    expect(res.columns).toEqual(["Setor", "Faturamento", "Atingido"]);
    expect(res.rows[0]).toEqual(["UTI", 15200.5, true]);
    expect(res.rows[1]).toEqual(["Enfermaria", 8400, false]);
  });

  it("detecta CSV delimitado por vírgula", () => {
    const csv = "col1,col2\n10,20\n30,40";
    const res = parsePastedTable(csv);
    expect(res.columns).toEqual(["col1", "col2"]);
    expect(res.rows).toEqual([[10, 20], [30, 40]]);
  });

  it("deduplica cabeçalhos repetidos e trata nulos", () => {
    const raw = "Total\tTotal\tStatus\n10\t20\tnull";
    const res = parsePastedTable(raw);
    expect(res.columns).toEqual(["Total", "Total_2", "Status"]);
    expect(res.rows[0]).toEqual([10, 20, null]);
  });

  it("trata texto vazio retornando tabela padrão", () => {
    const res = parsePastedTable("");
    expect(res.columns).toEqual(["coluna_1"]);
    expect(res.rows).toEqual([]);
  });
});

describe("Vínculos e impacto de fontes em blocos (findSourceUsages)", () => {
  it("encontra todos os blocos vinculados a uma fonte através das páginas", () => {
    const layout = createDefaultLayout();
    layout.pages[0].blocks.push({
      id: "chart_1",
      type: "bar",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      title: "Gráfico de Vendas",
      source_id: "src_vendas",
    });
    layout.pages[0].blocks.push({
      id: "kpi_1",
      type: "kpi",
      x: 200,
      y: 0,
      width: 200,
      height: 100,
      source_id: "src_vendas",
    });

    const usages = findSourceUsages(layout, "src_vendas");
    expect(usages).toHaveLength(2);
    expect(usages[0].blockId).toBe("chart_1");
    expect(usages[0].blockTitle).toBe("Gráfico de Vendas");
    expect(usages[1].blockId).toBe("kpi_1");

    expect(findSourceUsages(layout, "inexistente")).toHaveLength(0);
  });
});

describe("Aplicação de fonte salva e remoção no layout", () => {
  const catalog: CatalogSqlSource[] = [
    { id: 10, name: "Relatório de Atendimentos", code: "atend-01" },
  ];

  it("cria, edita e preserva o campo label", () => {
    const createdState = createSourceModalState([], catalog);
    expect(createdState.ok).toBe(true);
    if (!createdState.ok) return;

    createdState.state.label = "Atendimentos Revisados";
    createdState.state.id = "atend_rev";

    const parsed = parseSourceModalState(createdState.state, [], catalog);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.source.label).toBe("Atendimentos Revisados");
    expect(parsed.source.id).toBe("atend_rev");

    // Na edição, o label é carregado no estado do modal
    const editModal = editSourceModalState(parsed.source, catalog);
    expect(editModal.label).toBe("Atendimentos Revisados");
    expect(editModal.id).toBe("atend_rev");
  });

  it("atualiza blocos vinculados ao renomear id da fonte", () => {
    const layout = createDefaultLayout();
    layout.sources = [{ id: "antigo", type: "goals", label: "Metas" }];
    layout.pages[0].blocks.push({
      id: "b1",
      type: "bar",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      source_id: "antigo",
    });

    const modalState: SourceDialogState = {
      mode: "edit",
      originalId: "antigo",
      id: "novo",
      label: "Metas Atualizadas",
      type: "goals",
      reportId: "",
      parametersJson: "{}",
      columnsJson: "[]",
      rowsJson: "[]",
      error: "",
    };

    const nextSource: CanvasSource = { id: "novo", type: "goals", label: "Metas Atualizadas" };
    const updated = applySavedSourceToLayout(layout, modalState, nextSource);

    expect(updated.sources[0].id).toBe("novo");
    expect(updated.sources[0].label).toBe("Metas Atualizadas");
    expect(updated.pages[0].blocks[0].source_id).toBe("novo");
  });

  it("remove fonte do layout e limpa source_id dos blocos afetados para evitar referências órfãs", () => {
    const layout = createDefaultLayout();
    layout.sources = [{ id: "src_remover", type: "goals" }];
    layout.pages[0].blocks.push({
      id: "b1",
      type: "table",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      source_id: "src_remover",
    });

    const updated = applyRemovedSourceToLayout(layout, "src_remover");
    expect(updated.sources).toHaveLength(0);
    expect(updated.pages[0].blocks[0].source_id).toBeUndefined();
  });
});
