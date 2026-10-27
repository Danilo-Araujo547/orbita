import { describe, expect, it } from "vitest";
import {
  formatCellValue,
  formatColumnTypeLabel,
  getColumnTypeAriaLabel,
  inferColumnType,
  inferValueType,
} from "./components/report-canvas/data/columnTypes";

describe("Inferência de tipos de coluna (columnTypes)", () => {
  it("infere tipo numérico para inteiros, floats e decimais com limite de 90%", () => {
    expect(inferColumnType([10, 20, 30.5, 42])).toBe("number");
    expect(inferColumnType(["100", "200.5", "300"])).toBe("number");
    // 9 números e 1 texto -> 90% número
    expect(inferColumnType([1, 2, 3, 4, 5, 6, 7, 8, 9, "texto"])).toBe("number");
    // 8 números e 2 textos -> 80% (abaixo do limiar), vira texto
    expect(inferColumnType([1, 2, 3, 4, 5, 6, 7, 8, "txt1", "txt2"])).toBe("text");
  });

  it("infere datas ISO e data/hora ISO", () => {
    expect(inferColumnType(["2026-10-01", "2026-10-02", "2026-10-03"])).toBe("date");
    expect(
      inferColumnType([
        "2026-10-01T10:30:00",
        "2026-10-02T14:45:00Z",
        "2026-10-03 08:00:00",
      ]),
    ).toBe("datetime");
  });

  it("infere booleano para booleanos reais e strings true/false", () => {
    expect(inferColumnType([true, false, true])).toBe("boolean");
    expect(inferColumnType(["true", "false", "true"])).toBe("boolean");
  });

  it("infere texto quando heterogêneo ou alfanumérico", () => {
    expect(inferColumnType(["Cardiologia", "Ortopedia", "Pediatria"])).toBe("text");
    expect(inferColumnType(["Cod123", "Cod456"])).toBe("text");
  });

  it("retorna unknown para colunas vazias ou contendo apenas nulos", () => {
    expect(inferColumnType([])).toBe("unknown");
    expect(inferColumnType([null, undefined, ""])).toBe("unknown");
  });

  it("testa inferValueType individual", () => {
    expect(inferValueType(null)).toBe("unknown");
    expect(inferValueType(42)).toBe("number");
    expect(inferValueType(true)).toBe("boolean");
    expect(inferValueType("2026-12-31")).toBe("date");
    expect(inferValueType("2026-12-31T23:59:59")).toBe("datetime");
    expect(inferValueType("Hospital")).toBe("text");
  });
});

describe("Formatação de células (formatCellValue)", () => {
  it("formata nulos e indefinidos como travessão cinza '—'", () => {
    expect(formatCellValue(null)).toBe("—");
    expect(formatCellValue(undefined)).toBe("—");
    expect(formatCellValue("")).toBe("—");
  });

  it("formata números em padrão pt-BR tabular", () => {
    expect(formatCellValue(1500, "number")).toBe("1.500");
    expect(formatCellValue(15200.5, "number")).toBe("15.200,5");
    expect(formatCellValue(0, "number")).toBe("0");
  });

  it("formata datas ISO em DD/MM/AAAA", () => {
    expect(formatCellValue("2026-10-27", "date")).toBe("27/10/2026");
    expect(formatCellValue("2026-01-05", "date")).toBe("05/01/2026");
  });

  it("formata data/hora ISO em DD/MM/AAAA HH:mm:ss", () => {
    expect(formatCellValue("2026-10-27T14:30:15", "datetime")).toBe("27/10/2026 14:30:15");
    expect(formatCellValue("2026-10-27 09:15", "datetime")).toBe("27/10/2026 09:15");
  });

  it("formata booleanos como Sim/Não", () => {
    expect(formatCellValue(true, "boolean")).toBe("Sim");
    expect(formatCellValue(false, "boolean")).toBe("Não");
    expect(formatCellValue("true", "boolean")).toBe("Sim");
  });

  it("formata textos diretamente", () => {
    expect(formatCellValue("Consulta de retorno")).toBe("Consulta de retorno");
  });
});

describe("Rótulos e acessibilidade (formatColumnTypeLabel & getColumnTypeAriaLabel)", () => {
  it("gera rótulo descritivo com e sem inferência", () => {
    expect(formatColumnTypeLabel("number")).toBe("Número");
    expect(formatColumnTypeLabel("date")).toBe("Data");
    expect(formatColumnTypeLabel("text", "date")).toBe("Texto (Data inferido)");
    expect(formatColumnTypeLabel("unknown")).toBe("Tipo não detectado");
  });

  it("gera aria-label acessível para leitores de tela", () => {
    expect(getColumnTypeAriaLabel("number")).toBe("Tipo de dado: Número");
    expect(getColumnTypeAriaLabel("date")).toBe("Tipo de dado: Data");
    expect(getColumnTypeAriaLabel("unknown")).toBe("Coluna com tipo não detectado");
  });
});
