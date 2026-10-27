import type { CanvasBlock } from "../../model";
import { HEX_COLOR_RE, SWATCH_COLORS, clamp, validColor } from "../../model";

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
  return (
    <section className="rc-section" hidden={hidden}>
      <div className="rc-section-head">
        <h3>Aparência e tipografia</h3>
      </div>
      <div className="rc-grid-2">
        <label className="rc-field">
          <span>Cor principal</span>
          <div className="rc-color-control">
            <input
              type="color"
              aria-label="Cor principal do bloco"
              className="rc-color-input"
              value={validColor(block.options?.color, "#075b94")}
              onChange={(e) =>
                onUpdateBlock(
                  block.id,
                  "Alterar cor do bloco",
                  (b) => ({ ...b, options: { ...b.options, color: e.target.value } }),
                  `color:${block.id}`,
                )
              }
            />
            <input
              type="text"
              maxLength={7}
              value={block.options?.color || "#075b94"}
              onChange={(e) => {
                const v = e.target.value;
                if (HEX_COLOR_RE.test(v)) {
                  onUpdateBlock(
                    block.id,
                    "Alterar cor do bloco",
                    (b) => ({ ...b, options: { ...b.options, color: v } }),
                    `color:${block.id}`,
                  );
                }
              }}
            />
          </div>
        </label>
        <label className="rc-field">
          <span>Tamanho da fonte (px)</span>
          <input
            type="number"
            min={6}
            max={100}
            value={block.options?.font_size ?? 14}
            onChange={(e) =>
              onUpdateBlock(
                block.id,
                "Alterar tamanho da fonte",
                (b) => ({
                  ...b,
                  options: {
                    ...b.options,
                    font_size: clamp(Number(e.target.value) || 14, 6, 100),
                  },
                }),
                `font:${block.id}`,
              )
            }
          />
        </label>
      </div>
      <div className="rc-swatches" role="group" aria-label="Cores rápidas">
        {SWATCH_COLORS.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={`Cor ${hex}`}
            className={`rc-swatch ${
              (block.options?.color || "#075b94").toLowerCase() === hex ? "is-selected" : ""
            }`.trim()}
            style={{ background: hex }}
            onClick={() =>
              onUpdateBlock(block.id, "Alterar cor do bloco", (b) => ({
                ...b,
                options: { ...b.options, color: hex },
              }))
            }
          />
        ))}
      </div>
    </section>
  );
}
