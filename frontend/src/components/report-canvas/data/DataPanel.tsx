import { Edit3, Plus, Trash2 } from "lucide-react";
import type { CanvasSource, CatalogSqlSource } from "../model";

export interface DataPanelProps {
  active: boolean;
  sources: CanvasSource[];
  availableSources: CatalogSqlSource[];
  onCreateSource: () => void;
  onEditSource: (src: CanvasSource) => void;
  onRemoveSource: (sourceId: string) => void;
}

export default function DataPanel({
  active,
  sources,
  availableSources,
  onCreateSource,
  onEditSource,
  onRemoveSource,
}: DataPanelProps) {
  return (
    <section className="rc-section" hidden={!active}>
      <div className="rc-section-head">
        <h3>Fontes de dados ({sources.length})</h3>
        <button type="button" className="rc-mini-btn" onClick={onCreateSource}>
          <Plus size={12} />
          Adicionar
        </button>
      </div>
      {sources.length === 0 ? (
        <p className="rc-empty-note">Nenhuma fonte configurada.</p>
      ) : (
        <div className="rc-item-list">
          {sources.map((src) => {
            const sqlItem =
              src.type === "report"
                ? availableSources.find((c) => c.id === src.report_id)
                : undefined;
            const detail =
              src.type === "report"
                ? sqlItem
                  ? `${sqlItem.name} · ${sqlItem.code}`
                  : `Fonte #${src.report_id}`
                : src.type === "inline"
                  ? `${src.columns.length} col · ${src.rows.length} linha(s)`
                  : "Metas mensais (year, month, value)";
            return (
              <div key={src.id} className="rc-list-row">
                <div className="rc-list-row-main">
                  <span className="rc-list-row-title">
                    <span className="rc-tag">
                      {src.type === "report"
                        ? sqlItem?.datasets
                          ? "Dados"
                          : "SQL"
                        : src.type === "inline"
                          ? "Manual"
                          : "Metas"}
                    </span>
                    {src.id}
                  </span>
                  <span className="rc-list-row-sub" title={detail}>
                    {detail}
                  </span>
                </div>
                <div className="rc-list-row-actions">
                  <button
                    type="button"
                    className="rc-icon-btn"
                    title={`Editar fonte ${src.id}`}
                    aria-label={`Editar fonte ${src.id}`}
                    onClick={() => onEditSource(src)}
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    type="button"
                    className="rc-icon-btn danger"
                    title={`Remover fonte ${src.id}`}
                    aria-label={`Remover fonte ${src.id}`}
                    onClick={() => onRemoveSource(src.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
