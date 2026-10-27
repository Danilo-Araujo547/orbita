import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasBlock, CanvasLayout } from "./components/report-canvas/model";
import {
  computeArrowNudgeUpdater,
  computeResizeSnapping,
  computeSnapping,
  duplicateBlockInLayout,
} from "./components/report-canvas/stage/geometry";
import {
  aggregateSeries,
  groupByCategorical,
  groupByDate,
  parseNumericValue,
} from "./components/report-canvas/stage/dataGrouping";
import {
  clearDraftFromStorage,
  formatDraftTime,
  isDraftDifferent,
  loadDraftFromStorage,
  saveDraftToStorage,
} from "./components/report-canvas/state/draftRecovery";

describe("TAREFA 06: Palco, Seleção, Guias, Atalhos, Agrupamento e Recuperação de Rascunho", () => {
  describe("1. Snapping e Guias Inteligentes (computeSnapping e computeResizeSnapping)", () => {
    const otherBlocks: CanvasBlock[] = [
      {
        id: "b1",
        type: "kpi",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
      },
    ];

    it("encaixa nas margens de 24 px da folha dentro do limiar", () => {
      // zoom 1.0 -> limiar 6px. Bloco em x=26px deve encaixar em x=24px
      const snap = computeSnapping({
        rect: { x: 26, y: 27, width: 100, height: 80 },
        otherBlocks,
        pageWidth: 800,
        pageHeight: 1000,
        zoom: 1.0,
      });

      expect(snap.snappedX).toBe(true);
      expect(snap.x).toBe(24);
      expect(snap.snappedY).toBe(true);
      expect(snap.y).toBe(24);
      expect(snap.guides.length).toBe(2);
      expect(snap.guides.some((g) => g.type === "vertical" && g.position === 24)).toBe(true);
      expect(snap.guides.some((g) => g.type === "horizontal" && g.position === 24)).toBe(true);
    });

    it("ajusta limiar de encaixe conforme o zoom (50 % e 150 %)", () => {
      // zoom 0.5 -> limiar = 6 / 0.5 = 12px. Delta de 10px deve encaixar
      const snap50 = computeSnapping({
        rect: { x: 34, y: 100, width: 100, height: 80 },
        otherBlocks: [],
        pageWidth: 800,
        pageHeight: 1000,
        zoom: 0.5,
      });
      expect(snap50.snappedX).toBe(true);
      expect(snap50.x).toBe(24); // 34 - 10 = 24

      // zoom 1.5 -> limiar = 6 / 1.5 = 4px. Delta de 6px NÃO deve encaixar
      const snap150 = computeSnapping({
        rect: { x: 30, y: 100, width: 100, height: 80 },
        otherBlocks: [],
        pageWidth: 800,
        pageHeight: 1000,
        zoom: 1.5,
      });
      expect(snap150.snappedX).toBe(false);
      expect(snap150.x).toBe(30);
    });

    it("desativa encaixe quando Alt estiver pressionado (disabled: true)", () => {
      const snap = computeSnapping({
        rect: { x: 25, y: 25, width: 100, height: 80 },
        otherBlocks,
        pageWidth: 800,
        pageHeight: 1000,
        zoom: 1.0,
        disabled: true,
      });
      expect(snap.snappedX).toBe(false);
      expect(snap.snappedY).toBe(false);
      expect(snap.guides).toHaveLength(0);
      expect(snap.x).toBe(25);
      expect(snap.y).toBe(25);
    });

    it("não permite que bloco saia dos limites da página (clamp estrito)", () => {
      // Tentativa de mover além da margem direita/inferior
      const snapRight = computeSnapping({
        rect: { x: 750, y: 950, width: 100, height: 80 },
        otherBlocks: [],
        pageWidth: 800,
        pageHeight: 1000,
        zoom: 1.0,
        disabled: true,
      });
      expect(snapRight.x).toBe(700); // 800 - 100
      expect(snapRight.y).toBe(920); // 1000 - 80

      // Tentativa de mover para coordenadas negativas
      const snapLeft = computeSnapping({
        rect: { x: -30, y: -40, width: 100, height: 80 },
        otherBlocks: [],
        pageWidth: 800,
        pageHeight: 1000,
        zoom: 1.0,
        disabled: true,
      });
      expect(snapLeft.x).toBe(0);
      expect(snapLeft.y).toBe(0);
    });

    it("encaixa em bordas e centros de outros blocos e colunas da grade", () => {
      // b1 está em x=100, width=200 -> borda esquerda 100, centro 200, borda direita 300
      // Bloco em x=298 (delta de 2px da borda direita de b1)
      const snap = computeSnapping({
        rect: { x: 298, y: 150, width: 100, height: 80 },
        otherBlocks,
        pageWidth: 800,
        pageHeight: 1000,
        columns: 4,
        zoom: 1.0,
      });
      expect(snap.snappedX).toBe(true);
      expect(snap.x).toBe(300); // Encaixou na borda direita de b1 (300)
    });

    it("redimensionamento com alças encaixa e respeita limites mínimos", () => {
      const resize = computeResizeSnapping({
        handle: "se",
        rect: { x: 50, y: 50, width: 100, height: 100 },
        otherBlocks,
        pageWidth: 800,
        pageHeight: 1000,
        zoom: 1.0,
      });
      expect(resize.width).toBeGreaterThanOrEqual(20);
      expect(resize.height).toBeGreaterThanOrEqual(20);
    });
  });

  describe("2. Atalhos de Teclado e Deslocamento", () => {
    it("Ctrl+D duplica com deslocamento exato de 16 px", () => {
      const layout: CanvasLayout = {
        schema_version: 1,
        page: { width: 800, height: 1000, columns: 24, background: "#ffffff" },
        sources: [],
        pages: [
          {
            id: "p1",
            name: "Página 1",
            blocks: [
              {
                id: "b1",
                type: "kpi",
                x: 40,
                y: 50,
                width: 200,
                height: 100,
              },
            ],
          },
        ],
      };

      const res = duplicateBlockInLayout({
        layout,
        activePageId: "p1",
        block: layout.pages[0].blocks[0],
        offset: 16,
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const dup = res.layout.pages[0].blocks.find((b) => b.id === res.blockId)!;
      expect(dup.x).toBe(56); // 40 + 16
      expect(dup.y).toBe(66); // 50 + 16
    });

    it("nudge de setas: 1 px sem Shift e 10 px com Shift", () => {
      const nudge1 = computeArrowNudgeUpdater("ArrowRight", 1, 800, 1000);
      const b1 = { id: "b1", type: "kpi" as const, x: 50, y: 50, width: 100, height: 100 };
      expect(nudge1(b1).x).toBe(51);

      const nudge10 = computeArrowNudgeUpdater("ArrowDown", 10, 800, 1000);
      expect(nudge10(b1).y).toBe(60);
    });
  });

  describe("3. Agrupamento TS puro contra os casos da Tarefa 02", () => {
    it("dia: agrupa datas por dia no formato DD/MM/AAAA", () => {
      const rows = [
        ["2026-10-27T10:00:00Z", 10],
        ["2026-10-27T15:00:00Z", 20],
        ["2026-10-28", 15],
        [null, 99],
        ["", 88],
      ];
      const res = groupByDate({
        rows,
        xColIndex: 0,
        yColIndices: [1],
        groupMode: "day",
        aggMode: "sum",
        seriesNames: ["Valor"],
      });

      expect(res.rows).toEqual([
        ["27/10/2026", 30],
        ["28/10/2026", 15],
      ]);
    });

    it("semana: agrupa na segunda-feira da semana com virada de ano (sem. DD/MM)", () => {
      // 2025-12-29 é segunda. 2025-12-31 é quarta. 2026-01-02 é sexta.
      // Todas pertencem à semana de 29/12.
      // 2026-01-05 é a próxima segunda.
      const rows = [
        ["2026-01-02T15:30:00Z", 20],
        ["2025-12-31", 10],
        ["2026-01-05T08:00:00", 50],
        ["2025-12-29", 5],
      ];
      const res = groupByDate({
        rows,
        xColIndex: 0,
        yColIndices: [1],
        groupMode: "week",
        aggMode: "sum",
        seriesNames: ["Total"],
      });

      expect(res.rows).toEqual([
        ["sem. 29/12", 35],
        ["sem. 05/01", 50],
      ]);
    });

    it("mês: formato pt-BR com nome do mês abreviado (out/26, nov/26, dez/26, jan/27)", () => {
      const rows = [
        ["2026-10-01", 100],
        ["2026-10-20", 50],
        ["2026-11-05", 200],
        ["2026-12-25", 300],
        ["2027-01-10", 400],
      ];
      const res = groupByDate({
        rows,
        xColIndex: 0,
        yColIndices: [1],
        groupMode: "month",
        aggMode: "sum",
        seriesNames: ["Qtd"],
      });

      expect(res.rows).toEqual([
        ["out/26", 150],
        ["nov/26", 200],
        ["dez/26", 300],
        ["jan/27", 400],
      ]);
    });

    it("trimestre e ano: T1/26 a T4/26 e ano YYYY", () => {
      const rows = [
        ["2026-02-10", 10],
        ["2026-05-15", 20],
        ["2026-08-20", 30],
        ["2026-11-25", 40],
        ["2027-01-05", 50],
      ];
      const resQ = groupByDate({
        rows,
        xColIndex: 0,
        yColIndices: [1],
        groupMode: "quarter",
        aggMode: "sum",
        seriesNames: ["Qtd"],
      });
      expect(resQ.rows).toEqual([
        ["T1/26", 10],
        ["T2/26", 20],
        ["T3/26", 30],
        ["T4/26", 40],
        ["T1/27", 50],
      ]);

      const resY = groupByDate({
        rows,
        xColIndex: 0,
        yColIndices: [1],
        groupMode: "year",
        aggMode: "sum",
        seriesNames: ["Qtd"],
      });
      expect(resY.rows).toEqual([
        ["2026", 100],
        ["2027", 50],
      ]);
    });

    it("agregações: avg, min, max, count", () => {
      const rows = [10, 20, 30, null];
      expect(aggregateSeries("avg", rows, "Valor")).toBe(20);
      expect(aggregateSeries("min", rows, "Valor")).toBe(10);
      expect(aggregateSeries("max", rows, "Valor")).toBe(30);
      expect(aggregateSeries("count", ["A", "B", "", null, "C"], "Texto")).toBe(3);
    });

    it("rejeita datas inválidas e séries não numéricas com erros descritivos", () => {
      expect(() =>
        groupByDate({
          rows: [["nao-e-data", 10]],
          xColIndex: 0,
          yColIndices: [1],
          groupMode: "month",
          seriesNames: ["Valor"],
          blockLabel: "Gráfico Erro",
        }),
      ).toThrowError(/não é uma data/);

      expect(() => parseNumericValue("abc", "Total")).toThrowError(
        /A série "Total" precisa ser numérica; a coluna tem texto \(ex\.: "abc"\)\./,
      );
      expect(() => parseNumericValue(true, "Booleano")).toThrowError(
        /não pode conter valor booleano/,
      );
    });

    it("agrupamento categórico preserva ordem de aparecimento", () => {
      const rows = [
        ["Sul", 10],
        ["Norte", 20],
        ["Sul", 15],
        ["Leste", 30],
        ["Norte", 5],
      ];
      const res = groupByCategorical({
        rows,
        xColIndex: 0,
        yColIndices: [1],
        aggMode: "sum",
        seriesNames: ["Vendas"],
      });
      expect(res.rows).toEqual([
        ["Sul", 25],
        ["Norte", 25],
        ["Leste", 30],
      ]);
    });

    it("limite de 500 pontos dispara erro se excedido", () => {
      const rows = Array.from({ length: 501 }, (_, i) => [`Cat ${i}`, i]);
      expect(() =>
        groupByCategorical({
          rows,
          xColIndex: 0,
          yColIndices: [1],
          aggMode: "sum",
        }),
      ).toThrowError(/aceita até 500 pontos/);
    });

    it("gráfico de pizza rejeita valores negativos", () => {
      const rows = [
        ["A", 10],
        ["B", -5],
      ];
      expect(() =>
        groupByCategorical({
          rows,
          xColIndex: 0,
          yColIndices: [1],
          aggMode: "sum",
          chartType: "pie",
        }),
      ).toThrowError(/gráfico de pizza não aceita valores negativos/);
    });
  });

  describe("4. Recuperação de Rascunho Local (draftRecovery)", () => {
    const unit = "matriz";
    const reportId = 42;
    const version = 3;

    let mockStorage: Record<string, string> = {};

    beforeEach(() => {
      mockStorage = {};
      const fakeLocalStorage = {
        getItem: (key: string) => mockStorage[key] ?? null,
        setItem: (key: string, value: string) => {
          mockStorage[key] = String(value);
        },
        removeItem: (key: string) => {
          delete mockStorage[key];
        },
        clear: () => {
          mockStorage = {};
        },
        key: () => null,
        length: 0,
      };

      vi.stubGlobal("window", {
        localStorage: fakeLocalStorage,
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const mockLayout: CanvasLayout = {
      schema_version: 1,
      page: { width: 794, height: 1123, columns: 24, background: "#ffffff" },
      sources: [],
      pages: [{ id: "p1", name: "Página 1", blocks: [] }],
    };

    it("grava e recupera rascunho no localStorage", () => {
      const ok = saveDraftToStorage(unit, reportId, version, {
        layout: mockLayout,
        enabled: true,
        outputFormat: "pdf",
      });
      expect(ok).toBe(true);

      const loaded = loadDraftFromStorage(unit, reportId, version);
      expect(loaded).not.toBeNull();
      expect(loaded?.enabled).toBe(true);
      expect(loaded?.outputFormat).toBe("pdf");
      expect(loaded?.layout.schema_version).toBe(1);

      clearDraftFromStorage(unit, reportId, version);
      expect(loadDraftFromStorage(unit, reportId, version)).toBeNull();
    });

    it("detecta quando o rascunho difere do estado atual", () => {
      const draft = {
        layout: mockLayout,
        enabled: false,
        outputFormat: "pdf" as const,
        timestamp: Date.now(),
      };
      // Enabled difere
      expect(
        isDraftDifferent(draft, { layout: mockLayout, enabled: true, outputFormat: "pdf" }),
      ).toBe(true);

      // Idêntico
      expect(
        isDraftDifferent(draft, { layout: mockLayout, enabled: false, outputFormat: "pdf" }),
      ).toBe(false);
    });

    it("formata horário do rascunho em HH:mm", () => {
      const timeStr = formatDraftTime(Date.now());
      expect(timeStr).toMatch(/^\d{2}:\d{2}$/);
    });
  });
});
