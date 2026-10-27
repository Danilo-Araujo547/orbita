import type { CanvasBlock } from "../../model";
import {
  LEGACY_PDF_PALETTE,
  NEW_SERIES_PALETTE,
  SWATCH_COLORS,
  clamp,
} from "../../model";
import CollapsibleSection from "./CollapsibleSection";
import ColorField from "./ColorField";
import NumberField from "./NumberField";

export interface AppearanceFieldsProps {
  block: CanvasBlock;
  hidden: boolean;
  onUpdateBlock: (
    blockId: string,
    label: string,
    updater: (b: CanvasBlock) => CanvasBlock,
    coalesceKey?: string,
  ) => void;
}

export default function AppearanceFields({
  block,
  hidden,
  onUpdateBlock,
}: AppearanceFieldsProps) {
  if (hidden) return null;

  const opt = block.options || {};
  const isChart = block.type === "bar" || block.type === "line" || block.type === "pie";
  const showFontSize = block.type !== "image";
  const showPrecision =
    block.type === "kpi" || block.type === "bar" || block.type === "line" || block.type === "pie";

  const hasNewPalette = Boolean(opt.series_colors && opt.series_colors.length > 0);
  const yFields = opt.y_fields && opt.y_fields.length > 0 ? opt.y_fields : ["Série 1"];

  return (
    <>
      {block.type !== "image" && (
        <CollapsibleSection title="Estilo e tipografia" defaultOpen={true}>
          <ColorField
            id="insp-color"
            label="Cor principal"
            value={opt.color || "#075b94"}
            swatches={SWATCH_COLORS}
            onChange={(hex) =>
              onUpdateBlock(
                block.id,
                "Alterar cor principal",
                (b) => ({
                  ...b,
                  options: { ...b.options, color: hex },
                }),
                `color:${block.id}`,
              )
            }
          />

          {(showFontSize || showPrecision) && (
            <div className={showFontSize && showPrecision ? "cv-grid-pair" : undefined}>
              {showFontSize && (
                <NumberField
                  id="insp-font-size"
                  label="Tamanho da fonte"
                  value={opt.font_size ?? 14}
                  min={6}
                  max={100}
                  step={1}
                  unit="px"
                  onChange={(val) =>
                    onUpdateBlock(
                      block.id,
                      "Alterar tamanho da fonte",
                      (b) => ({
                        ...b,
                        options: {
                          ...b.options,
                          font_size: Math.round(clamp(val, 6, 100)),
                        },
                      }),
                      `font:${block.id}`,
                    )
                  }
                />
              )}

              {showPrecision && (
                <NumberField
                  id="insp-precision"
                  label="Precisão decimal"
                  value={opt.precision ?? 0}
                  min={0}
                  max={4}
                  step={1}
                  onChange={(val) =>
                    onUpdateBlock(
                      block.id,
                      "Alterar precisão decimal",
                      (b) => ({
                        ...b,
                        options: {
                          ...b.options,
                          precision: Math.round(clamp(val, 0, 4)),
                        },
                      }),
                      `precision:${block.id}`,
                    )
                  }
                />
              )}
            </div>
          )}
        </CollapsibleSection>
      )}

      {isChart && (
        <CollapsibleSection title="Paleta de séries" defaultOpen={true}>
          {!hasNewPalette ? (
            <div className="cv-field">
              <div className="cv-field-top">
                <span className="cv-label">Paleta original</span>
              </div>
              <div className="cv-swatch-list" aria-label="Prévia da paleta original">
                {LEGACY_PDF_PALETTE.map((hex) => (
                  <span
                    key={hex}
                    title={hex}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "var(--cv-r-sm)",
                      border: "1px solid var(--cv-line-strong)",
                      background: hex,
                      display: "inline-block",
                    }}
                  />
                ))}
              </div>
              <div>
                <button
                  type="button"
                  className="cv-btn-compact primary"
                  onClick={() =>
                    onUpdateBlock(block.id, "Usar paleta nova de séries", (b) => ({
                      ...b,
                      options: {
                        ...b.options,
                        series_colors: [...NEW_SERIES_PALETTE],
                      },
                    }))
                  }
                >
                  Usar paleta nova
                </button>
              </div>
            </div>
          ) : (
            <div className="cv-field" style={{ gap: "10px" }}>
              {yFields.slice(0, 6).map((seriesLabel, idx) => {
                const currentHex =
                  opt.series_colors?.[idx] ||
                  NEW_SERIES_PALETTE[idx % NEW_SERIES_PALETTE.length];
                return (
                  <ColorField
                    key={`${seriesLabel}-${idx}`}
                    id={`insp-series-color-${idx}`}
                    label={`Cor: ${seriesLabel}`}
                    value={currentHex}
                    swatches={NEW_SERIES_PALETTE}
                    onChange={(hex) =>
                      onUpdateBlock(
                        block.id,
                        `Alterar cor da série ${seriesLabel}`,
                        (b) => {
                          const curr = b.options?.series_colors?.length
                            ? [...b.options.series_colors]
                            : [...NEW_SERIES_PALETTE];
                          while (curr.length <= idx) {
                            curr.push(NEW_SERIES_PALETTE[curr.length % NEW_SERIES_PALETTE.length]);
                          }
                          curr[idx] = hex;
                          return {
                            ...b,
                            options: {
                              ...b.options,
                              series_colors: curr.slice(0, 6),
                            },
                          };
                        },
                        `series-color:${block.id}:${idx}`,
                      )
                    }
                  />
                );
              })}

              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="cv-btn-compact"
                  onClick={() =>
                    onUpdateBlock(block.id, "Redefinir paleta nova", (b) => ({
                      ...b,
                      options: {
                        ...b.options,
                        series_colors: [...NEW_SERIES_PALETTE],
                      },
                    }))
                  }
                >
                  Restaurar paleta nova
                </button>
                <button
                  type="button"
                  className="cv-btn-compact"
                  onClick={() =>
                    onUpdateBlock(block.id, "Voltar à paleta original", (b) => ({
                      ...b,
                      options: {
                        ...b.options,
                        series_colors: undefined,
                      },
                    }))
                  }
                >
                  Paleta original
                </button>
              </div>
            </div>
          )}
        </CollapsibleSection>
      )}
    </>
  );
}
