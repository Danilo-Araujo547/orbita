import type { KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { ColumnInfo } from "../../model";
import ColumnSelect from "./ColumnSelect";

export interface FieldWellProps {
  id?: string;
  index: number;
  total: number;
  value: string;
  columns: readonly ColumnInfo[];
  onlyNumeric?: boolean;
  seriesColor?: string;
  showSigma?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  canRemove?: boolean;
  onChange: (colName: string) => void;
  onMove?: (dir: -1 | 1) => void;
  onRemove?: () => void;
}

export default function FieldWell({
  id,
  index,
  total,
  value,
  columns,
  onlyNumeric = false,
  seriesColor,
  showSigma = false,
  canMoveUp = false,
  canMoveDown = false,
  canRemove = false,
  onChange,
  onMove,
  onRemove,
}: FieldWellProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!e.altKey || !onMove) return;
    if (e.key === "ArrowUp" && canMoveUp) {
      e.preventDefault();
      e.stopPropagation();
      onMove(-1);
    } else if (e.key === "ArrowDown" && canMoveDown) {
      e.preventDefault();
      e.stopPropagation();
      onMove(1);
    }
  };

  const selectedCol = columns.find((c) => c.name === value);
  const showUnknownWarn = Boolean(onlyNumeric && value && selectedCol?.type === "unknown");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
      <div
        className="cv-well"
        onKeyDown={handleKeyDown}
        aria-label={`Série ${index + 1} de ${total}`}
      >
        {seriesColor && (
          <span
            className="cv-well-swatch"
            style={{ background: seriesColor }}
            title={`Cor da série: ${seriesColor}`}
            aria-hidden="true"
          />
        )}
        {showSigma && (
          <span className="cv-well-sigma" title="Valor agregado (Σ)" aria-hidden="true">
            Σ
          </span>
        )}
        <ColumnSelect
          id={id}
          ariaLabel={`Coluna da série ${index + 1}`}
          value={value}
          columns={columns}
          onlyNumeric={onlyNumeric}
          placeholder="Escolher coluna numérica…"
          onChange={onChange}
        />
        {(onMove || onRemove) && (
          <div className="cv-well-actions">
            {onMove && total > 1 && (
              <>
                <button
                  type="button"
                  className="cv-well-btn"
                  disabled={!canMoveUp}
                  title="Mover série para cima (Alt+↑)"
                  aria-label={`Mover série ${value || index + 1} para cima`}
                  onClick={() => onMove(-1)}
                >
                  <ArrowUp size={12} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="cv-well-btn"
                  disabled={!canMoveDown}
                  title="Mover série para baixo (Alt+↓)"
                  aria-label={`Mover série ${value || index + 1} para baixo`}
                  onClick={() => onMove(1)}
                >
                  <ArrowDown size={12} aria-hidden="true" />
                </button>
              </>
            )}
            {onRemove && (
              <button
                type="button"
                className="cv-well-btn is-danger"
                disabled={!canRemove}
                title="Remover série"
                aria-label={`Remover série ${value || index + 1}`}
                onClick={onRemove}
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
      {showUnknownWarn && (
        <p className="cv-field-warn">Tipo desconhecido, carregue a prévia na aba Dados.</p>
      )}
    </div>
  );
}
