import { useId } from "react";
import type { FormEvent } from "react";
import { Check, Download } from "lucide-react";
import InlineDialog from "../../InlineDialog";
import Select from "../../Select";
import type { OutputFormat } from "../model";
import type { TestParameter } from "../parameters";

export interface PreviewModalState {
  format: OutputFormat;
  values: Record<string, string>;
  resultUrl?: string;
  resultName?: string;
  resultFormat?: string;
  busy: boolean;
  error: string;
  info: string;
}

export interface PreviewDialogProps {
  previewModal: PreviewModalState | null;
  reportName: string;
  previewFields: TestParameter[];
  onChange: (next: PreviewModalState) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}

export default function PreviewDialog({
  previewModal,
  reportName,
  previewFields,
  onChange,
  onClose,
  onSubmit,
}: PreviewDialogProps) {
  const previewFormId = useId();
  if (!previewModal) return null;

  return (
    <InlineDialog
      title="Testar relatório"
      subtitle=""
      className={`rc-subdialog rc-test-dialog cv-root ${
        previewModal.resultUrl ? "has-preview" : ""
      }`}
      busy={previewModal.busy}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="button"
            disabled={previewModal.busy}
            onClick={onClose}
          >
            Fechar
          </button>
          <button
            type="submit"
            form={previewFormId}
            className="button primary"
            disabled={previewModal.busy}
          >
            <Download size={14} />
            {previewModal.busy
              ? "Gerando…"
              : previewModal.resultUrl
                ? "Atualizar prévia"
                : "Gerar prévia"}
          </button>
        </>
      }
    >
      <div className="rc-test-layout">
        <form id={previewFormId} className="rc-subform rc-test-fields" onSubmit={onSubmit}>
          <strong>{reportName}</strong>
          {previewModal.error && (
            <p className="inline-error" role="alert">
              {previewModal.error}
            </p>
          )}
          {previewModal.info && (
            <div className="rc-banner rc-banner-ok" role="status">
              <div className="rc-banner-content">
                <Check size={15} />
                <span>{previewModal.info}</span>
              </div>
            </div>
          )}
          <label className="op-field">
            <span>Formato do arquivo</span>
            <Select
              value={previewModal.format}
              disabled={previewModal.busy}
              onChange={(e) =>
                onChange({
                  ...previewModal,
                  format: e.target.value === "xlsx" ? "xlsx" : "pdf",
                })
              }
            >
              <option value="pdf">PDF</option>
              <option value="xlsx">Excel (XLSX)</option>
            </Select>
          </label>
          <div className="rc-test-parameter-grid">
            {previewFields.map((field) => (
              <label className="op-field" key={field.name}>
                <span>
                  {field.label}
                  {field.required === false ? <small> · Opcional</small> : null}
                </span>
                {field.options ? (
                  <Select
                    disabled={previewModal.busy}
                    value={previewModal.values[field.name] || ""}
                    onChange={(e) =>
                      onChange({
                        ...previewModal,
                        values: { ...previewModal.values, [field.name]: e.target.value },
                        error: "",
                      })
                    }
                  >
                    <option value="">Selecionar</option>
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <input
                    type={
                      field.type === "integer" || field.type === "number"
                        ? "number"
                        : field.type === "time"
                          ? "time"
                          : "text"
                    }
                    inputMode={field.type === "date" ? "numeric" : undefined}
                    placeholder={field.type === "date" ? "DD/MM/AAAA" : undefined}
                    maxLength={field.type === "date" ? 10 : 2000}
                    min={field.minimum}
                    max={field.maximum}
                    step={
                      field.type === "number"
                        ? "any"
                        : field.type === "integer"
                          ? 1
                          : undefined
                    }
                    disabled={previewModal.busy}
                    value={previewModal.values[field.name] || ""}
                    onChange={(e) =>
                      onChange({
                        ...previewModal,
                        values: { ...previewModal.values, [field.name]: e.target.value },
                        error: "",
                      })
                    }
                  />
                )}
              </label>
            ))}
          </div>
          {!previewFields.length && (
            <p className="rc-test-empty">Este relatório não exige parâmetros.</p>
          )}
        </form>
        {previewModal.resultUrl && (
          <section className="rc-test-result" aria-label="Prévia gerada">
            <div className="rc-test-result-bar">
              <span>{previewModal.resultName}</span>
              <a
                className="button"
                href={previewModal.resultUrl}
                download={previewModal.resultName}
              >
                <Download size={14} />
                Baixar
              </a>
            </div>
            {previewModal.resultFormat === "pdf" ? (
              <iframe title="Prévia do relatório" src={previewModal.resultUrl} />
            ) : (
              <div className="rc-test-empty">
                Planilha gerada. Use Baixar para abrir no Excel.
              </div>
            )}
          </section>
        )}
      </div>
    </InlineDialog>
  );
}
