import { Layers, Trash2 } from "lucide-react";
import type { CanvasPage } from "../model";
import { BLOCK_LABELS } from "../model";

export interface PageInspectorProps {
  activePage: CanvasPage | undefined;
  onSelectBlock: (blockId: string) => void;
  onRemoveBlock: (blockId: string) => void;
}

export default function PageInspector({
  activePage,
  onSelectBlock,
  onRemoveBlock,
}: PageInspectorProps) {
  return (
    <section className="rc-section">
      <div className="rc-section-head">
        <h3>
          <Layers size={13} style={{ verticalAlign: "-2px", marginRight: "5px" }} />
          Blocos na página ({activePage?.blocks.length || 0})
        </h3>
      </div>
      {activePage?.blocks.length ? (
        <div className="rc-item-list">
          {activePage.blocks.map((b) => (
            <div key={b.id} className="rc-list-row">
              <button
                type="button"
                className="rc-list-row-main"
                onClick={() => onSelectBlock(b.id)}
              >
                <span className="rc-list-row-title">
                  <span className="rc-tag">{BLOCK_LABELS[b.type]}</span>
                  {b.title || b.id}
                </span>
                <span className="rc-list-row-sub">
                  x:{Math.round(b.x)} y:{Math.round(b.y)} · {Math.round(b.width)}×
                  {Math.round(b.height)}px
                </span>
              </button>
              <button
                type="button"
                className="rc-icon-btn danger"
                aria-label={`Remover ${b.title || b.id}`}
                onClick={() => onRemoveBlock(b.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="rc-empty-note">Nenhum bloco nesta página.</p>
      )}
      <p className="rc-hint">Selecione um bloco para editar.</p>
    </section>
  );
}
