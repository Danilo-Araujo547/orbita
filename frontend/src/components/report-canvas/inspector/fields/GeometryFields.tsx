import type { CanvasBlock, CanvasPageConfig } from "../../model";
import { round2 } from "../../model";
import CollapsibleSection from "./CollapsibleSection";
import NumberField from "./NumberField";

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
  if (hidden) return null;

  const maxX = Math.max(0, round2(pageConfig.width - block.width));
  const maxY = Math.max(0, round2(pageConfig.height - block.height));
  const overflowsRight = block.x + block.width > pageConfig.width + 0.01;
  const overflowsBottom = block.y + block.height > pageConfig.height + 0.01;

  return (
    <>
      <CollapsibleSection title="Posição e tamanho" defaultOpen={true}>
        <div className="cv-field">
          <span className="cv-label">Alinhamento na página</span>
          <div className="cv-align-bar" role="group" aria-label="Alinhar bloco à página">
            <button
              type="button"
              className="cv-align-btn"
              title="Alinhar à esquerda da página"
              aria-label="Alinhar à esquerda da página"
              onClick={() =>
                onUpdateBlock(block.id, "Alinhar bloco à esquerda", (b) => ({
                  ...b,
                  x: 0,
                }))
              }
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 2v10M4.5 4.5h6v2h-6zM4.5 8h4v2h-4z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className="cv-align-btn"
              title="Centralizar horizontalmente na página"
              aria-label="Centralizar horizontalmente na página"
              onClick={() =>
                onUpdateBlock(block.id, "Centralizar bloco horizontalmente", (b) => ({
                  ...b,
                  x: round2(Math.max(0, (pageConfig.width - b.width) / 2)),
                }))
              }
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M7 1.5v11M3.5 4h7v2h-7zM4.5 8h5v2h-5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className="cv-align-btn"
              title="Alinhar à direita da página"
              aria-label="Alinhar à direita da página"
              onClick={() =>
                onUpdateBlock(block.id, "Alinhar bloco à direita", (b) => ({
                  ...b,
                  x: round2(Math.max(0, pageConfig.width - b.width)),
                }))
              }
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M12 2v10M3.5 4.5h6v2h-6zM5.5 8h4v2h-4z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className="cv-align-btn"
              title="Alinhar ao topo da página"
              aria-label="Alinhar ao topo da página"
              onClick={() =>
                onUpdateBlock(block.id, "Alinhar bloco ao topo", (b) => ({
                  ...b,
                  y: 0,
                }))
              }
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 2h10M4.5 4.5v6h2v-6zM8 4.5v4h2v-4z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className="cv-align-btn"
              title="Centralizar verticalmente na página"
              aria-label="Centralizar verticalmente na página"
              onClick={() =>
                onUpdateBlock(block.id, "Centralizar bloco verticalmente", (b) => ({
                  ...b,
                  y: round2(Math.max(0, (pageConfig.height - b.height) / 2)),
                }))
              }
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M1.5 7h11M4 3.5v7h2v-7zM8 4.5v5h2v-5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className="cv-align-btn"
              title="Alinhar à base da página"
              aria-label="Alinhar à base da página"
              onClick={() =>
                onUpdateBlock(block.id, "Alinhar bloco à base", (b) => ({
                  ...b,
                  y: round2(Math.max(0, pageConfig.height - b.height)),
                }))
              }
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 12h10M4.5 3.5v6h2v-6zM8 5.5v4h2v-4z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="cv-grid-pair">
          <NumberField
            id="insp-geom-x"
            label="X"
            ariaLabel="Posição X"
            value={round2(block.x)}
            min={0}
            max={maxX}
            step={1}
            unit="px"
            onChange={(val) =>
              onUpdateBlock(
                block.id,
                "Mover bloco",
                (b) => ({ ...b, x: val }),
                `geom-x:${block.id}`,
              )
            }
          />
          <NumberField
            id="insp-geom-y"
            label="Y"
            ariaLabel="Posição Y"
            value={round2(block.y)}
            min={0}
            max={maxY}
            step={1}
            unit="px"
            onChange={(val) =>
              onUpdateBlock(
                block.id,
                "Mover bloco",
                (b) => ({ ...b, y: val }),
                `geom-y:${block.id}`,
              )
            }
          />
          <NumberField
            id="insp-geom-w"
            label="L"
            ariaLabel="Largura"
            value={round2(block.width)}
            min={20}
            max={pageConfig.width}
            step={1}
            unit="px"
            externalError={
              overflowsRight
                ? `Ultrapassa a largura da página (${pageConfig.width} px).`
                : undefined
            }
            onChange={(val) =>
              onUpdateBlock(
                block.id,
                "Redimensionar bloco",
                (b) => ({ ...b, width: val }),
                `geom-w:${block.id}`,
              )
            }
          />
          <NumberField
            id="insp-geom-h"
            label="A"
            ariaLabel="Altura"
            value={round2(block.height)}
            min={20}
            max={pageConfig.height}
            step={1}
            unit="px"
            externalError={
              overflowsBottom
                ? `Ultrapassa a altura da página (${pageConfig.height} px).`
                : undefined
            }
            onChange={(val) =>
              onUpdateBlock(
                block.id,
                "Redimensionar bloco",
                (b) => ({ ...b, height: val }),
                `geom-h:${block.id}`,
              )
            }
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Avançado" defaultOpen={false}>
        <div className="cv-field">
          <span className="cv-label">Identificador do bloco</span>
          <input
            type="text"
            className="cv-input"
            readOnly
            aria-label="Identificador do bloco"
            value={block.id}
            style={{ fontFamily: "var(--cv-font-mono)", color: "var(--cv-text-3)" }}
          />
        </div>
        <div>
          <button
            type="button"
            className="cv-btn-compact"
            onClick={() =>
              onUpdateBlock(block.id, "Ajustar largura útil", (b) => ({
                ...b,
                x: Math.min(40, Math.max(0, pageConfig.width - 20)),
                width: Math.max(20, pageConfig.width - 80),
              }))
            }
          >
            Ocupar largura útil (margens de 40 px)
          </button>
        </div>
      </CollapsibleSection>
    </>
  );
}
