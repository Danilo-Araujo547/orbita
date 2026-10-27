import { describe, expect, it } from "vitest";
import { createDefaultLayout } from "../model";
import { classifyLimitRatio, computeLimits } from "./limits";

describe("computeLimits — cálculo de limites e faixas de alerta do Canvas", () => {
  it("classifica corretamente faixas normal (<80%), âmbar (>=80%) e vermelho (>=100%)", () => {
    expect(classifyLimitRatio(0)).toBe("ok");
    expect(classifyLimitRatio(0.799)).toBe("ok");
    expect(classifyLimitRatio(0.8)).toBe("warning");
    expect(classifyLimitRatio(0.99)).toBe("warning");
    expect(classifyLimitRatio(1)).toBe("danger");
    expect(classifyLimitRatio(1.25)).toBe("danger");
  });

  it("calcula blocos, fontes, páginas, imagens e KB do layout padrão", () => {
    const layout = createDefaultLayout();
    const res = computeLimits(layout);

    expect(res.blocks).toMatchObject({ used: 0, max: 100, severity: "ok", formatted: "0/100" });
    expect(res.sources).toMatchObject({ used: 0, max: 30, severity: "ok", formatted: "0/30" });
    expect(res.pages).toMatchObject({ used: 1, max: 30, severity: "ok", formatted: "1/30" });
    expect(res.images).toMatchObject({ used: 0, max: 20, severity: "ok", formatted: "0/20" });
    expect(res.layoutBytes).toBeGreaterThan(50);
    expect(res.layoutKb.max).toBe(750);
    expect(res.layoutKb.formatted).toMatch(/\/750 KB$/);
    expect(res.overallSeverity).toBe("ok");
  });

  it("deduplica imagens referenciadas nos blocos e respeita contagem explícita de assets enviados", () => {
    const layout = createDefaultLayout();
    const assetA = "11111111-2222-3333-4444-555555555555";
    layout.pages[0].blocks.push(
      {
        id: "b1",
        type: "image",
        x: 20,
        y: 20,
        width: 100,
        height: 80,
        asset_id: assetA,
      },
      {
        id: "b2",
        type: "image",
        x: 140,
        y: 20,
        width: 100,
        height: 80,
        asset_id: assetA,
      },
    );

    expect(computeLimits(layout).images.used).toBe(1);
    const withSixteen = computeLimits(layout, 16);
    expect(withSixteen.images).toMatchObject({
      used: 16,
      max: 20,
      severity: "warning",
      formatted: "16/20",
    });
    expect(withSixteen.overallSeverity).toBe("warning");
  });

  it("sinaliza danger quando qualquer limite atinge 100% (ex.: 30 páginas ou >= 750 KB)", () => {
    const layout = createDefaultLayout();
    layout.pages = Array.from({ length: 30 }, (_, idx) => ({
      id: `p${idx + 1}`,
      name: `Página ${idx + 1}`,
      blocks: [],
    }));

    const atMaxPages = computeLimits(layout);
    expect(atMaxPages.pages.severity).toBe("danger");
    expect(atMaxPages.overallSeverity).toBe("danger");

    const hugeLayout = createDefaultLayout();
    hugeLayout.pages[0].blocks = Array.from({ length: 40 }, (_, idx) => ({
      id: `b${idx + 1}`,
      type: "text" as const,
      x: 10,
      y: 10,
      width: 200,
      height: 80,
      text: "x".repeat(19_000),
    }));
    const overKb = computeLimits(hugeLayout);
    expect(overKb.layoutBytes).toBeGreaterThan(750_000);
    expect(overKb.layoutKb.severity).toBe("danger");
    expect(overKb.overallSeverity).toBe("danger");
  });
});
