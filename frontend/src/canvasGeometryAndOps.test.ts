import { describe, expect, it } from "vitest";
import type { CanvasAssetMeta, CanvasLayout, CatalogSqlSource } from "./components/report-canvas/model";
import { normalizeLayout, sanitizeLayoutForApi } from "./components/report-canvas/model";
import {
  applyBlockRemove,
  applyBlockUpdate,
  applyPageConfigPatch,
  computeArrowNudgeUpdater,
  computePointerDragUpdater,
  createBlankPageInLayout,
  createBlockInLayout,
  createCoverPageInLayout,
  deletePageFromLayout,
  duplicateBlockInLayout,
  movePageInLayout,
  renamePageInLayout,
  reorderBlockInLayout,
  toggleMultiColumn,
  validateLayoutBeforeSend,
} from "./components/report-canvas/stage/geometry";
import {
  applyRemovedSourceToLayout,
  applySavedSourceToLayout,
  createSourceModalState,
  editSourceModalState,
  parseSourceModalState,
} from "./components/report-canvas/data/sourceOps";

const CATALOG_FIXTURE: CatalogSqlSource[] = [
  {
    id: 50,
    name: "Ocupação Hospitalar",
    code: "ocupacao_50",
    datasets: [
      { id: "setores", name: "Setores", columns: ["Setor", "Leitos", "Ocupados"] },
    ],
  },
];

const ASSET_FIXTURE: CanvasAssetMeta[] = [
  {
    id: "11111111-2222-3333-4444-555555555555",
    filename: "logo.png",
    width: 240,
    height: 80,
  },
];

const FIXTURE_RAW_LAYOUT = {
  schema_version: 1,
  page: { width: 794, height: 1123, columns: 24, background: "#ffffff" },
  sources: [
    {
      id: "dados1",
      type: "report",
      report_id: 50,
      dataset: "setores",
      parameters: { data_referencia: { parameter: "data_referencia" } },
    },
  ],
  pages: [
    {
      id: "p1",
      name: "Página 1",
      blocks: [
        {
          id: "b1",
          type: "kpi",
          x: 40,
          y: 40,
          width: 230,
          height: 125,
          source_id: "dados1",
          title: "Total de leitos",
          options: { color: "#075b94", font_size: 28, aggregate: "sum", precision: 0, value_field: "Leitos" },
        },
      ],
    },
  ],
};

describe("Operações puras de geometria, fontes, validação e paridade byte-a-byte do layout JSON", () => {
  it("gera exatamente o mesmo JSON byte-a-byte que a lógica legada do baseline após sequência completa de ações", () => {
    let layout: CanvasLayout = normalizeLayout(FIXTURE_RAW_LAYOUT);

    // 1. Adicionar gráfico de barras (usa defaultSource = dados1 e colunas Setor / Leitos)
    const addChart = createBlockInLayout({
      layout,
      activePageId: "p1",
      type: "bar",
      assets: ASSET_FIXTURE,
      availableSources: CATALOG_FIXTURE,
    });
    expect(addChart.ok).toBe(true);
    if (!addChart.ok) return;
    layout = addChart.layout;
    expect(addChart.blockId).toBe("b2");

    // 2. Arrastar b2 e redimensionar b2
    const moveUpd = computePointerDragUpdater(
      {
        kind: "move",
        blockId: "b2",
        startClientX: 100,
        startClientY: 100,
        startX: 58,
        startY: 58,
        width: 430,
        height: 250,
      },
      185,
      270,
      0.85,
      layout.page.width,
      layout.page.height,
    );
    layout = applyBlockUpdate(layout, "p1", "b2", moveUpd);

    const resizeUpd = computePointerDragUpdater(
      {
        kind: "resize",
        handle: "se",
        blockId: "b2",
        startClientX: 200,
        startClientY: 200,
        startX: 158,
        startY: 258,
        startW: 430,
        startH: 250,
      },
      285,
      242.5,
      0.85,
      layout.page.width,
      layout.page.height,
    );
    layout = applyBlockUpdate(layout, "p1", "b2", resizeUpd);

    // 3. Duplicar b1 -> b3 e reordenar camadas
    const b1 = layout.pages[0].blocks.find((b) => b.id === "b1")!;
    const dup = duplicateBlockInLayout({ layout, activePageId: "p1", block: b1 });
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    layout = dup.layout;
    layout = reorderBlockInLayout(layout, "p1", "b3", -1);

    // 4. Nudge com setas em b3
    layout = applyBlockUpdate(
      layout,
      "p1",
      "b3",
      computeArrowNudgeUpdater("ArrowRight", 10, layout.page.width, layout.page.height),
    );

    // 5. Inserir capa, adicionar página em branco, renomear e alterar formato para paisagem
    const cover = createCoverPageInLayout(layout, ASSET_FIXTURE);
    expect(cover.ok).toBe(true);
    if (!cover.ok) return;
    layout = cover.layout;

    const blank = createBlankPageInLayout(layout);
    expect(blank.ok).toBe(true);
    if (!blank.ok) return;
    layout = blank.layout;
    layout = renamePageInLayout(layout, blank.pageId, "Anexo");
    layout = movePageInLayout(layout, blank.pageId, -1);
    const afterDel = deletePageFromLayout(layout, blank.pageId, blank.pageId);
    expect(afterDel).not.toBeNull();
    layout = afterDel!.layout;

    layout = applyPageConfigPatch(layout, { width: 1123, height: 794 });

    // 6. Adicionar fonte inline via modal e renomear dados1 -> ocupacao
    const createModal = createSourceModalState(layout.sources, CATALOG_FIXTURE);
    expect(createModal.ok).toBe(true);
    if (!createModal.ok) return;
    const inlineModal = { ...createModal.state, id: "resumo_manual", type: "inline" as const };
    const parsedInline = parseSourceModalState(inlineModal, layout.sources, CATALOG_FIXTURE);
    expect(parsedInline.ok).toBe(true);
    if (!parsedInline.ok) return;
    layout = applySavedSourceToLayout(layout, inlineModal, parsedInline.source);

    const editModal = {
      ...editSourceModalState(layout.sources[0], CATALOG_FIXTURE),
      id: "ocupacao",
    };
    const parsedEdit = parseSourceModalState(editModal, layout.sources, CATALOG_FIXTURE);
    expect(parsedEdit.ok).toBe(true);
    if (!parsedEdit.ok) return;
    layout = applySavedSourceToLayout(layout, editModal, parsedEdit.source);

    const sanitized = sanitizeLayoutForApi(layout);
    const expectedJson = JSON.stringify({
      schema_version: 1,
      page: { width: 1123, height: 794, columns: 24, background: "#ffffff" },
      sources: [
        {
          id: "ocupacao",
          type: "report",
          report_id: 50,
          dataset: "setores",
          parameters: { data_referencia: { parameter: "data_referencia" } },
        },
        {
          id: "resumo_manual",
          type: "inline",
          columns: ["Mes", "Total"],
          rows: [
            ["Jan", 10],
            ["Fev", 20],
          ],
        },
      ],
      pages: [
        {
          id: "capa1",
          name: "Capa",
          blocks: [
            {
              id: "b4",
              type: "image",
              x: 287,
              y: 150,
              width: 220,
              height: 96,
              options: { color: "#075b94", font_size: 14 },
              asset_id: "11111111-2222-3333-4444-555555555555",
            },
            {
              id: "b5",
              type: "text",
              x: 60,
              y: 270,
              width: 674,
              height: 110,
              options: { color: "#075b94", font_size: 26 },
              text: "{{report_name}}",
            },
          ],
        },
        {
          id: "p1",
          name: "Página 1",
          blocks: [
            {
              id: "b1",
              type: "kpi",
              x: 40,
              y: 40,
              width: 230,
              height: 125,
              options: {
                color: "#075b94",
                font_size: 28,
                aggregate: "sum",
                precision: 0,
                value_field: "Leitos",
              },
              title: "Total de leitos",
              source_id: "ocupacao",
            },
            {
              id: "b3",
              type: "kpi",
              x: 70,
              y: 60,
              width: 230,
              height: 125,
              options: {
                color: "#075b94",
                font_size: 28,
                aggregate: "sum",
                precision: 0,
                value_field: "Leitos",
              },
              title: "Total de leitos",
              source_id: "ocupacao",
            },
            {
              id: "b2",
              type: "bar",
              x: 158,
              y: 258,
              width: 530,
              height: 300,
              options: {
                color: "#075b94",
                font_size: 13,
                x_field: "Setor",
                y_fields: ["Leitos"],
              },
              title: "Barras",
              source_id: "ocupacao",
            },
          ],
        },
      ],
    });

    expect(JSON.stringify(sanitized)).toBe(expectedJson);
  });

  it("valida pré-envio apontando página e bloco com problema", () => {
    const empty = normalizeLayout(null);
    expect(validateLayoutBeforeSend(empty, true)).toEqual({
      ok: false,
      error: "Adicione ao menos um bloco ao Canvas.",
    });
    expect(validateLayoutBeforeSend(empty, false).ok).toBe(true);

    let layout = normalizeLayout(FIXTURE_RAW_LAYOUT);
    layout = applyRemovedSourceToLayout(layout, "dados1");
    const missingSrc = validateLayoutBeforeSend(layout, true);
    expect(missingSrc).toEqual({
      ok: false,
      error: 'Selecione uma fonte de dados para o bloco "Total de leitos" (Página 1).',
      pageId: "p1",
      blockId: "b1",
    });

    layout = applyBlockRemove(layout, "b1");
    const imgRes = createBlockInLayout({
      layout,
      activePageId: "p1",
      type: "image",
      assets: [],
      availableSources: [],
    });
    if (imgRes.ok) {
      const missingImg = validateLayoutBeforeSend(imgRes.layout, true);
      expect(missingImg).toEqual({
        ok: false,
        error: 'Selecione ou envie uma imagem para o bloco em "Página 1".',
        pageId: "p1",
        blockId: imgRes.blockId,
      });
    }
  });

  it("rejeita fontes com identificador inválido ou JSON malformado e alterna colunas múltiplas", () => {
    const badId = parseSourceModalState(
      {
        mode: "create",
        id: "123-invalido",
        type: "goals",
        reportId: "",
        parametersJson: "{}",
        columnsJson: "[]",
        rowsJson: "[]",
        error: "",
      },
      [],
      [],
    );
    expect(badId.ok).toBe(false);

    expect(toggleMultiColumn(["A", "B"], "A", 6)).toEqual(["B"]);
    expect(toggleMultiColumn(["A", "B"], "C", 2)).toEqual(["A", "B"]);
    expect(toggleMultiColumn(["A"], "C", 2)).toEqual(["A", "C"]);
  });
});
