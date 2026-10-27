import { useId } from "react";
import type { FormEvent } from "react";
import InlineDialog from "../../InlineDialog";
import Select from "../../Select";
import type { CatalogSqlSource, SourceDialogState } from "../model";

export interface SourceDialogProps {
  sourceModal: SourceDialogState | null;
  availableSources: CatalogSqlSource[];
  onChange: (next: SourceDialogState) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}

export default function SourceDialog({
  sourceModal,
  availableSources,
  onChange,
  onClose,
  onSubmit,
}: SourceDialogProps) {
  const sourceFormId = useId();
  if (!sourceModal) return null;

  const selectedCatalog = availableSources.find((s) => s.id === Number(sourceModal.reportId));

  return (
    <InlineDialog
      title={sourceModal.mode === "create" ? "Adicionar fonte de dados" : "Editar fonte de dados"}
      subtitle="Fontes compartilháveis entre blocos do Canvas"
      className="rc-subdialog cv-root"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form={sourceFormId} className="button primary">
            Salvar fonte
          </button>
        </>
      }
    >
      <form id={sourceFormId} className="rc-subform" onSubmit={onSubmit}>
        {sourceModal.error && (
          <p className="inline-error" role="alert">
            {sourceModal.error}
          </p>
        )}
        <div className="rc-grid-2">
          <label className="op-field">
            <span>Identificador</span>
            <input
              type="text"
              required
              maxLength={50}
              placeholder="Ex.: dados1"
              value={sourceModal.id}
              onChange={(e) => onChange({ ...sourceModal, id: e.target.value })}
            />
          </label>
          <label className="op-field">
            <span>Tipo de fonte</span>
            <Select
              value={sourceModal.type}
              onChange={(e) => {
                const nextType = e.target.value as "report" | "inline" | "goals";
                onChange({
                  ...sourceModal,
                  type: nextType,
                  ...(sourceModal.mode === "create" && nextType === "goals"
                    ? { id: "metas" }
                    : {}),
                });
              }}
            >
              <option value="report">Fonte cadastrada</option>
              <option value="inline">Dados manuais (inline)</option>
              <option value="goals">Metas mensais do relatório</option>
            </Select>
          </label>
        </div>

        {sourceModal.type === "report" && (
          <>
            <label className="op-field">
              <span>Fonte revisada da unidade</span>
              <Select
                required
                value={sourceModal.reportId}
                onChange={(e) =>
                  onChange({ ...sourceModal, reportId: e.target.value, dataset: undefined })
                }
              >
                <option value="">Selecione uma fonte</option>
                {availableSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.code}
                  </option>
                ))}
              </Select>
            </label>
            {!!selectedCatalog?.datasets?.length && (
              <label className="op-field">
                <span>Conjunto de dados</span>
                <Select
                  aria-label="Conjunto de dados"
                  value={sourceModal.dataset || selectedCatalog.datasets[0]?.id || ""}
                  onChange={(e) => onChange({ ...sourceModal, dataset: e.target.value })}
                >
                  {selectedCatalog.datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <label className="op-field">
              <span>Parâmetros padrão da fonte (JSON opcional)</span>
              <textarea
                rows={4}
                className="rc-code-area"
                value={sourceModal.parametersJson}
                onChange={(e) => onChange({ ...sourceModal, parametersJson: e.target.value })}
              />
              <span className="rc-hint">
                Opcional. Na geração oficial ou prévia, parâmetros informados na execução
                prevalecem.
              </span>
            </label>
          </>
        )}

        {sourceModal.type === "inline" && (
          <>
            <label className="op-field">
              <span>Colunas (JSON)</span>
              <textarea
                rows={2}
                required
                className="rc-code-area"
                value={sourceModal.columnsJson}
                onChange={(e) => onChange({ ...sourceModal, columnsJson: e.target.value })}
              />
            </label>
            <label className="op-field">
              <span>Linhas (JSON)</span>
              <textarea
                rows={6}
                required
                className="rc-code-area"
                value={sourceModal.rowsJson}
                onChange={(e) => onChange({ ...sourceModal, rowsJson: e.target.value })}
              />
            </label>
          </>
        )}

        {sourceModal.type === "goals" && (
          <p className="rc-hint">
            Utiliza as metas mensais cadastradas neste relatório com as colunas <code>year</code>,{" "}
            <code>month</code> e <code>value</code>.
          </p>
        )}
      </form>
    </InlineDialog>
  );
}
