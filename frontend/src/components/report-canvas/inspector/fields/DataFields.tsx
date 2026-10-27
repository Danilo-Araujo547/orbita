import { Plus } from "lucide-react";
import Select from "../../../Select";
import type { AggregateMode, CanvasBlock, CanvasSource } from "../../model";
import { clamp } from "../../model";
import { toggleMultiColumn } from "../../stage/geometry";

export interface DataFieldsProps {
  block: CanvasBlock;
  hidden: boolean;
  sources: CanvasSource[];
  knownColumns: string[];
  resolveKnownColumns: (sourceId?: string) => string[];
  onOpenCreateSource: () => void;
  onColumnWidthsValidation: (blockId: string | null, errorMessage?: string) => void;
  onUpdateBlock: (
    blockId: string,
    label: string,
    updater: (b: CanvasBlock) => CanvasBlock,
    coalesceKey?: string,
  ) => void;
}

export default function DataFields({
  block,
  hidden,
  sources,
  knownColumns,
  resolveKnownColumns,
  onOpenCreateSource,
  onColumnWidthsValidation,
  onUpdateBlock,
}: DataFieldsProps) {
  return (
    <section className="rc-section" hidden={hidden}>
      <div className="rc-section-head">
        <h3>Fonte de dados e campos</h3>
        <button type="button" className="rc-mini-btn" onClick={onOpenCreateSource}>
          <Plus size={12} />
          Nova fonte
        </button>
      </div>

      <label className="rc-field">
        <span>Fonte de dados</span>
        <Select
          value={block.source_id || ""}
          onChange={(e) => {
            const nextSrcId = e.target.value || undefined;
            const cols = resolveKnownColumns(nextSrcId);
            onUpdateBlock(block.id, "Vincular fonte de dados", (b) => ({
              ...b,
              source_id: nextSrcId,
              options: {
                ...b.options,
                ...(cols.length > 0 && (b.type === "bar" || b.type === "line" || b.type === "pie")
                  ? {
                      x_field: cols[0],
                      y_fields: cols.length > 1 ? [cols[1]] : [cols[0]],
                    }
                  : {}),
                ...(cols.length > 0 && b.type === "kpi"
                  ? { value_field: cols[cols.length > 1 ? 1 : 0] }
                  : {}),
              },
            }));
          }}
        >
          <option value="">Selecione uma fonte</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id} ({s.type === "report" ? "Dados" : s.type === "inline" ? "Manual" : "Metas"})
            </option>
          ))}
        </Select>
      </label>

      {block.type === "table" && (
        <label className="rc-field">
          <span>Larguras das colunas</span>
          <input
            aria-label="Larguras das colunas"
            placeholder="Ex.: 234, 54, 54"
            key={`${block.id}-${(block.options?.column_widths || []).join(",")}`}
            defaultValue={(block.options?.column_widths || []).join(", ")}
            onBlur={(e) => {
              const widths = e.target.value.trim()
                ? e.target.value.split(",").map((v) => Number(v.trim()))
                : [];
              if (widths.some((v) => !Number.isFinite(v) || v < 1 || v > 3000)) {
                onColumnWidthsValidation(
                  block.id,
                  "Informe larguras entre 1 e 3000, separadas por vírgula.",
                );
                return;
              }
              onColumnWidthsValidation(null);
              if (JSON.stringify(widths) !== JSON.stringify(block.options?.column_widths || [])) {
                onUpdateBlock(block.id, "Ajustar larguras das colunas", (b) => ({
                  ...b,
                  options: { ...b.options, column_widths: widths },
                }));
              }
            }}
          />
        </label>
      )}

      {block.type === "kpi" && (
        <>
          <div className="rc-grid-2">
            <label className="rc-field">
              <span>Agregação</span>
              <Select
                value={block.options?.aggregate || "sum"}
                onChange={(e) =>
                  onUpdateBlock(block.id, "Alterar agregação do indicador", (b) => ({
                    ...b,
                    options: {
                      ...b.options,
                      aggregate: e.target.value as AggregateMode,
                    },
                  }))
                }
              >
                <option value="sum">Soma (sum)</option>
                <option value="count">Contagem (count)</option>
                <option value="first">Primeiro (first)</option>
              </Select>
            </label>
            <label className="rc-field">
              <span>Decimais (0–4)</span>
              <input
                type="number"
                min={0}
                max={4}
                step={1}
                value={block.options?.precision ?? 0}
                onChange={(e) =>
                  onUpdateBlock(
                    block.id,
                    "Alterar casas decimais",
                    (b) => ({
                      ...b,
                      options: {
                        ...b.options,
                        precision: Math.round(clamp(Number(e.target.value) || 0, 0, 4)),
                      },
                    }),
                    `precision:${block.id}`,
                  )
                }
              />
            </label>
          </div>

          {(block.options?.aggregate || "sum") !== "count" && (
            <label className="rc-field">
              <span>Coluna numérica</span>
              <input
                type="text"
                maxLength={100}
                placeholder="Ex.: Total"
                value={block.options?.value_field || ""}
                onChange={(e) =>
                  onUpdateBlock(
                    block.id,
                    "Selecionar coluna do indicador",
                    (b) => ({
                      ...b,
                      options: { ...b.options, value_field: e.target.value },
                    }),
                    `kpi-col:${block.id}`,
                  )
                }
              />
              {knownColumns.length > 0 && (
                <div className="rc-chips">
                  {knownColumns.map((col) => (
                    <button
                      key={col}
                      type="button"
                      className={`rc-chip ${
                        block.options?.value_field === col ? "is-selected" : ""
                      }`.trim()}
                      onClick={() =>
                        onUpdateBlock(block.id, "Selecionar coluna do indicador", (b) => ({
                          ...b,
                          options: { ...b.options, value_field: col },
                        }))
                      }
                    >
                      {col}
                    </button>
                  ))}
                </div>
              )}
            </label>
          )}
        </>
      )}

      {block.type === "table" && (
        <div className="rc-field">
          <label className="rc-field">
            <span>Colunas exibidas (vírgula · vazio = todas)</span>
            <input
              type="text"
              placeholder="Ex.: Mes, Total"
              value={(block.options?.columns || []).join(", ")}
              onChange={(e) => {
                const parsed = e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                onUpdateBlock(
                  block.id,
                  "Configurar colunas da tabela",
                  (b) => ({
                    ...b,
                    options: { ...b.options, columns: parsed },
                  }),
                  `table-cols:${block.id}`,
                );
              }}
            />
          </label>
          {knownColumns.length > 0 && (
            <div className="rc-chips">
              {knownColumns.map((col) => {
                const active = (block.options?.columns || []).includes(col);
                return (
                  <button
                    key={col}
                    type="button"
                    className={`rc-chip ${active ? "is-selected" : ""}`.trim()}
                    onClick={() =>
                      onUpdateBlock(block.id, "Configurar colunas da tabela", (b) => ({
                        ...b,
                        options: {
                          ...b.options,
                          columns: toggleMultiColumn(b.options?.columns, col, 100),
                        },
                      }))
                    }
                  >
                    {col}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {(block.type === "bar" || block.type === "line" || block.type === "pie") && (
        <>
          <div className="rc-field">
            <label className="rc-field">
              <span>
                {block.type === "pie" ? "Coluna de rótulo (fatia)" : "Coluna do Eixo X"}
              </span>
              <input
                type="text"
                maxLength={100}
                placeholder="Ex.: Mes"
                value={block.options?.x_field || ""}
                onChange={(e) =>
                  onUpdateBlock(
                    block.id,
                    "Alterar eixo X do gráfico",
                    (b) => ({
                      ...b,
                      options: { ...b.options, x_field: e.target.value },
                    }),
                    `chart-x:${block.id}`,
                  )
                }
              />
            </label>
            {knownColumns.length > 0 && (
              <div className="rc-chips">
                {knownColumns.map((col) => (
                  <button
                    key={col}
                    type="button"
                    className={`rc-chip ${block.options?.x_field === col ? "is-selected" : ""}`.trim()}
                    onClick={() =>
                      onUpdateBlock(block.id, "Alterar eixo X do gráfico", (b) => ({
                        ...b,
                        options: { ...b.options, x_field: col },
                      }))
                    }
                  >
                    {col}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rc-field">
            <label className="rc-field">
              <span>
                {block.type === "pie"
                  ? "Coluna de valor numérico"
                  : "Séries Eixo Y (1 a 6, separadas por vírgula)"}
              </span>
              <input
                type="text"
                placeholder="Ex.: Total"
                value={(block.options?.y_fields || []).join(", ")}
                onChange={(e) => {
                  const ys = e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 6);
                  onUpdateBlock(
                    block.id,
                    "Alterar séries do gráfico",
                    (b) => ({
                      ...b,
                      options: { ...b.options, y_fields: ys },
                    }),
                    `chart-y:${block.id}`,
                  );
                }}
              />
            </label>
            {knownColumns.length > 0 && (
              <div className="rc-chips">
                {knownColumns.map((col) => {
                  const active = (block.options?.y_fields || []).includes(col);
                  return (
                    <button
                      key={col}
                      type="button"
                      className={`rc-chip ${active ? "is-selected" : ""}`.trim()}
                      onClick={() =>
                        onUpdateBlock(block.id, "Alterar séries do gráfico", (b) => ({
                          ...b,
                          options: {
                            ...b.options,
                            y_fields:
                              b.type === "pie"
                                ? [col]
                                : toggleMultiColumn(b.options?.y_fields, col, 6),
                          },
                        }))
                      }
                    >
                      {col}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
