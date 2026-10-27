import type { CanvasBlock, CanvasPageConfig } from "../../model";

export interface GeometryFieldsProps {
  block: CanvasBlock;
  pageConfig: CanvasPageConfig;
  hidden: boolean;
  onUpdateBlock: (
    blockId: string,
    label: string,
    updater: (b: CanvasBlock) => CanvasBlock,
    coalesceKey?: string,
  ) => void;
}

export default function GeometryFields({
  block,
  pageConfig,
  hidden,
  onUpdateBlock,
}: GeometryFieldsProps) {
  return (
    <section className="rc-section" hidden={hidden}>
      <div className="rc-section-head">
        <h3>Posição e tamanho</h3>
        <div className="rc-section-actions">
          <button
            type="button"
            className="rc-mini-btn"
            title="Centralizar horizontalmente na página"
            onClick={() =>
              onUpdateBlock(block.id, "Centralizar bloco", (b) => ({
                ...b,
                x: Math.round((pageConfig.width - b.width) / 2),
              }))
            }
          >
            Centro X
          </button>
          <button
            type="button"
            className="rc-mini-btn"
            title="Ajustar largura às margens de 40px"
            onClick={() =>
              onUpdateBlock(block.id, "Ajustar largura útil", (b) => ({
                ...b,
                x: 40,
                width: Math.max(20, pageConfig.width - 80),
              }))
            }
          >
            Largura útil
          </button>
        </div>
      </div>

      <div className="rc-grid-2">
        <label className="rc-field">
          <span>Posição X</span>
          <input
            type="number"
            min={0}
            max={Math.max(0, pageConfig.width - block.width)}
            value={block.x}
            onChange={(e) =>
              onUpdateBlock(
                block.id,
                "Mover bloco",
                (b) => ({ ...b, x: Number(e.target.value) }),
                `geom-x:${block.id}`,
              )
            }
          />
        </label>
        <label className="rc-field">
          <span>Posição Y</span>
          <input
            type="number"
            min={0}
            max={Math.max(0, pageConfig.height - block.height)}
            value={block.y}
            onChange={(e) =>
              onUpdateBlock(
                block.id,
                "Mover bloco",
                (b) => ({ ...b, y: Number(e.target.value) }),
                `geom-y:${block.id}`,
              )
            }
          />
        </label>
        <label className="rc-field">
          <span>Largura</span>
          <input
            type="number"
            min={20}
            max={pageConfig.width}
            value={block.width}
            onChange={(e) =>
              onUpdateBlock(
                block.id,
                "Redimensionar bloco",
                (b) => ({ ...b, width: Number(e.target.value) }),
                `geom-w:${block.id}`,
              )
            }
          />
        </label>
        <label className="rc-field">
          <span>Altura</span>
          <input
            type="number"
            min={20}
            max={pageConfig.height}
            value={block.height}
            onChange={(e) =>
              onUpdateBlock(
                block.id,
                "Redimensionar bloco",
                (b) => ({ ...b, height: Number(e.target.value) }),
                `geom-h:${block.id}`,
              )
            }
          />
        </label>
      </div>
    </section>
  );
}
