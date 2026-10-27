import { describe, expect, it } from "vitest";
import { createDefaultLayout } from "./components/report-canvas/model";
import { COALESCE_WINDOW_MS, HISTORY_LIMIT } from "./components/report-canvas/state/history";
import {
  canRedoCanvas,
  canUndoCanvas,
  canvasActions,
  canvasStoreReducer,
  createCanvasStoreState,
  getRedoLabel,
  getUndoLabel,
  isCanvasDirty,
} from "./components/report-canvas/state/canvasStore";
import {
  selectActivePage,
  selectAllBlockIds,
  selectKnownColumns,
  selectLocalDatasets,
  selectPageFormatPreset,
  selectSelectedBlock,
} from "./components/report-canvas/state/selectors";

describe("canvasStore e histórico (undo/redo, coalescência, limite, dirty, replace)", () => {
  it("inicia limpo e sem histórico", () => {
    const state = createCanvasStoreState();
    expect(isCanvasDirty(state)).toBe(false);
    expect(canUndoCanvas(state)).toBe(false);
    expect(canRedoCanvas(state)).toBe(false);
    expect(getUndoLabel(state)).toBeNull();
    expect(getRedoLabel(state)).toBeNull();
  });

  it("ignora apply sem mudança efetiva no layout", () => {
    const initial = createCanvasStoreState();
    const same = canvasStoreReducer(
      initial,
      canvasActions.apply("Mover bloco", (prev) => prev, { at: 1000 }),
    );
    expect(same).toBe(initial);
    expect(isCanvasDirty(same)).toBe(false);
    expect(canUndoCanvas(same)).toBe(false);
  });

  it("aplica ações com rótulo pt-BR, desfaz, refaz e limpa future ao editar novamente", () => {
    let state = createCanvasStoreState();
    state = canvasStoreReducer(
      state,
      canvasActions.apply(
        "Adicionar texto",
        (prev) => ({
          ...prev,
          pages: [
            {
              ...prev.pages[0],
              blocks: [{ id: "b1", type: "text", x: 10, y: 20, width: 100, height: 50, text: "Oi" }],
            },
          ],
        }),
        { at: 1000 },
      ),
    );
    expect(isCanvasDirty(state)).toBe(true);
    expect(canUndoCanvas(state)).toBe(true);
    expect(getUndoLabel(state)).toBe("Adicionar texto");

    state = canvasStoreReducer(
      state,
      canvasActions.apply(
        "Mover bloco",
        (prev) => ({
          ...prev,
          pages: [
            {
              ...prev.pages[0],
              blocks: prev.pages[0].blocks.map((b) => ({ ...b, x: 80 })),
            },
          ],
        }),
        { at: 3000 },
      ),
    );
    expect(state.past).toHaveLength(2);
    expect(getUndoLabel(state)).toBe("Mover bloco");

    // Desfazer movimento
    state = canvasStoreReducer(state, canvasActions.undo());
    expect(state.layout.pages[0].blocks[0].x).toBe(10);
    expect(canRedoCanvas(state)).toBe(true);
    expect(getRedoLabel(state)).toBe("Mover bloco");
    expect(getUndoLabel(state)).toBe("Adicionar texto");

    // Desfazer adição -> volta à revisão inicial salva (dirty = false)
    state = canvasStoreReducer(state, canvasActions.undo());
    expect(state.layout.pages[0].blocks).toHaveLength(0);
    expect(isCanvasDirty(state)).toBe(false);
    expect(canUndoCanvas(state)).toBe(false);
    expect(getRedoLabel(state)).toBe("Adicionar texto");

    // Refazer adição
    state = canvasStoreReducer(state, canvasActions.redo());
    expect(state.layout.pages[0].blocks).toHaveLength(1);
    expect(isCanvasDirty(state)).toBe(true);

    // Nova ação descarta o future restante
    state = canvasStoreReducer(
      state,
      canvasActions.apply("Renomear página", (prev) => ({
        ...prev,
        pages: [{ ...prev.pages[0], name: "Resumo" }],
      })),
    );
    expect(canRedoCanvas(state)).toBe(false);
    expect(state.future).toHaveLength(0);
  });

  it("coalesce junta atualizações com mesma coalesceKey em < 800 ms num único passo", () => {
    let state = createCanvasStoreState();
    state = canvasStoreReducer(
      state,
      canvasActions.apply(
        "Adicionar gráfico",
        (prev) => ({
          ...prev,
          pages: [
            {
              ...prev.pages[0],
              blocks: [{ id: "b1", type: "bar", x: 0, y: 0, width: 200, height: 150 }],
            },
          ],
        }),
        { at: 100 },
      ),
    );

    // Arraste contínuo em passos < 800 ms
    for (const [step, dx] of [
      [1, 10],
      [2, 25],
      [3, 40],
    ] as const) {
      state = canvasStoreReducer(
        state,
        canvasActions.apply(
          "Mover bloco",
          (prev) => ({
            ...prev,
            pages: [
              {
                ...prev.pages[0],
                blocks: prev.pages[0].blocks.map((b) => ({ ...b, x: dx })),
              },
            ],
          }),
          { coalesceKey: "move:b1", at: 1000 + step * 200 },
        ),
      );
    }

    expect(state.past).toHaveLength(2);
    expect(state.layout.pages[0].blocks[0].x).toBe(40);

    // Após >= 800 ms com a mesma chave, abre novo passo
    state = canvasStoreReducer(
      state,
      canvasActions.apply(
        "Mover bloco",
        (prev) => ({
          ...prev,
          pages: [
            {
              ...prev.pages[0],
              blocks: prev.pages[0].blocks.map((b) => ({ ...b, x: 100 })),
            },
          ],
        }),
        { coalesceKey: "move:b1", at: 1600 + COALESCE_WINDOW_MS },
      ),
    );
    expect(state.past).toHaveLength(3);

    // Chave diferente dentro de < 800 ms também abre novo passo
    state = canvasStoreReducer(
      state,
      canvasActions.apply(
        "Redimensionar bloco",
        (prev) => ({
          ...prev,
          pages: [
            {
              ...prev.pages[0],
              blocks: prev.pages[0].blocks.map((b) => ({ ...b, width: 320 })),
            },
          ],
        }),
        { coalesceKey: "resize:b1", at: 1600 + COALESCE_WINDOW_MS + 100 },
      ),
    );
    expect(state.past).toHaveLength(4);

    // Desfazer 2x volta antes do segundo move (x=40), e mais 1x volta ao x=0 original!
    state = canvasStoreReducer(state, canvasActions.undo());
    expect(state.layout.pages[0].blocks[0].width).toBe(200);
    state = canvasStoreReducer(state, canvasActions.undo());
    expect(state.layout.pages[0].blocks[0].x).toBe(40);
    state = canvasStoreReducer(state, canvasActions.undo());
    expect(state.layout.pages[0].blocks[0].x).toBe(0);
  });

  it("respeita o limite máximo de 100 passos no histórico", () => {
    let state = createCanvasStoreState();
    for (let i = 1; i <= 125; i++) {
      state = canvasStoreReducer(
        state,
        canvasActions.apply(`Editar página ${i}`, (prev) => ({
          ...prev,
          pages: [{ ...prev.pages[0], name: `Página ${i}` }],
        })),
      );
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT);
    expect(state.layout.pages[0].name).toBe("Página 125");

    for (let i = 0; i < HISTORY_LIMIT; i++) {
      state = canvasStoreReducer(state, canvasActions.undo());
    }
    expect(canUndoCanvas(state)).toBe(false);
    expect(state.layout.pages[0].name).toBe("Página 25");
  });

  it("controla dirty com markSaved e não colide revisões após undo + nova edição", () => {
    let state = createCanvasStoreState();
    state = canvasStoreReducer(
      state,
      canvasActions.apply(
        "Alterar largura",
        (prev) => ({ ...prev, page: { ...prev.page, width: 1123 } }),
        { coalesceKey: "page:width", at: 1000 },
      ),
    );
    expect(isCanvasDirty(state)).toBe(true);

    const serverNormalized = { ...state.layout, page: { ...state.layout.page, height: 794 } };
    state = canvasStoreReducer(state, canvasActions.markSaved(serverNormalized));
    expect(isCanvasDirty(state)).toBe(false);
    expect(state.layout.page.height).toBe(794);
    expect(state.past).toHaveLength(1);

    // Coalesce não atravessa um markSaved
    state = canvasStoreReducer(
      state,
      canvasActions.apply(
        "Alterar largura",
        (prev) => ({ ...prev, page: { ...prev.page, width: 900 } }),
        { coalesceKey: "page:width", at: 1100 },
      ),
    );
    expect(state.past).toHaveLength(2);
    expect(isCanvasDirty(state)).toBe(true);

    // Undo volta exatamente ao estado salvo -> dirty = false
    state = canvasStoreReducer(state, canvasActions.undo());
    expect(isCanvasDirty(state)).toBe(false);
    expect(state.layout.page.width).toBe(1123);

    // Undo mais uma vez sai do estado salvo -> dirty = true
    state = canvasStoreReducer(state, canvasActions.undo());
    expect(isCanvasDirty(state)).toBe(true);

    // Nova ação a partir daqui gera nova revisão (não colide com savedRevision)
    state = canvasStoreReducer(
      state,
      canvasActions.apply("Nova página", (prev) => ({
        ...prev,
        pages: [...prev.pages, { id: "p2", name: "Página 2", blocks: [] }],
      })),
    );
    expect(isCanvasDirty(state)).toBe(true);
  });

  it("replace limpa o histórico e zera dirty ao carregar/recarregar", () => {
    let state = createCanvasStoreState();
    state = canvasStoreReducer(
      state,
      canvasActions.apply("Editar fundo", (prev) => ({
        ...prev,
        page: { ...prev.page, background: "#f8fafc" },
      })),
    );
    expect(isCanvasDirty(state)).toBe(true);
    expect(canUndoCanvas(state)).toBe(true);

    const loaded = createDefaultLayout();
    loaded.pages[0].name = "Carregada";
    state = canvasStoreReducer(state, canvasActions.replace(loaded));
    expect(state.layout.pages[0].name).toBe("Carregada");
    expect(isCanvasDirty(state)).toBe(false);
    expect(canUndoCanvas(state)).toBe(false);
    expect(canRedoCanvas(state)).toBe(false);
  });

  it("mantém seleção fora do store através de seletores puros", () => {
    const layout = createDefaultLayout();
    layout.sources = [
      { id: "inline1", type: "inline", columns: ["Mes", "Total"], rows: [["Jan", 10]] },
      { id: "goals1", type: "goals" },
    ];
    layout.pages[0].blocks = [
      { id: "b1", type: "kpi", x: 10, y: 10, width: 200, height: 100, source_id: "inline1" },
    ];
    const page = selectActivePage(layout, "inexistente");
    expect(page.id).toBe("p1");
    expect(selectSelectedBlock(page, "b1")?.id).toBe("b1");
    expect(selectSelectedBlock(page, null)).toBeNull();
    expect(Array.from(selectAllBlockIds(layout))).toEqual(["b1"]);
    expect(selectKnownColumns(layout.sources, [], "inline1")).toEqual(["Mes", "Total"]);
    const ds = selectLocalDatasets(layout.sources, [{ year: 2026, month: 10, value: 95 }]);
    expect(ds.get("goals1")).toEqual({ columns: ["year", "month", "value"], rows: [[2026, 10, 95]] });
    expect(selectPageFormatPreset(layout.page)).toBe("portrait");
    expect(selectPageFormatPreset({ ...layout.page, width: 1123, height: 794 })).toBe("landscape");
    expect(selectPageFormatPreset({ ...layout.page, width: 800, height: 600 })).toBe("custom");
  });
});
