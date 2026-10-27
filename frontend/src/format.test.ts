import { describe, expect, it } from "vitest";
import { dateTime, percentage } from "./format";

describe("indicadores e horários", () => {
  it("não inventa percentual quando não há mensagens", () =>
    expect(percentage(0, 0)).toBe(0));
  it("calcula percentual com o denominador correto", () =>
    expect(percentage(3, 12)).toBe(25));
  it("apresenta horário de Brasília independentemente do computador", () =>
    expect(dateTime("2026-10-12T13:30:00Z")).toContain("10:30"));
});


describe("execution dates during tab transitions", () => {
  it("renders missing or invalid dates without throwing", () => {
    expect(dateTime(undefined)).toBe("—");
    expect(dateTime(null)).toBe("—");
    expect(dateTime("")).toBe("—");
    expect(dateTime("invalid-date")).toBe("—");
    expect(dateTime("2026-10-24T12:00:00Z")).toContain("09:00");
  });
});
