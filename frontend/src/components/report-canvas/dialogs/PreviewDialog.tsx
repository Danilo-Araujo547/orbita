import { useId } from "react";
import type { FormEvent } from "react";
import { AlertCircle, Check, Clock, Download } from "lucide-react";
import InlineDialog from "../../InlineDialog";
import Select from "../../Select";
import type { OutputFormat } from "../model";
import type { TestParameter } from "../parameters";
import "../dialogs.css";

export interface PreviewServerError {
  blockId?: string;
  sourceId?: string;
  message: string;
}

export interface PreviewModalState {
  format: OutputFormat;
  values: Record<string, string>;
  resultUrl?: string;
  resultName?: string;
  resultFormat?: string;
  generationTimeMs?: number;
  serverErrors?: PreviewServerError[];
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
  onSelectBlock?: (blockId: string) => void;
}

export default function PreviewDialog({
  previewModal,
  reportName,
  previewFields,
  onChange,
  onClose,
  onSubmit,
  onSelectBlock,
}: PreviewDialogProps) {
  const previewFormId = useId();
  if (!previewModal) return null;

  return (
    <InlineDialog
      title="Testar relatório"
      subtitle=""
      className={`cv-subdialog cv-test-dialog cv-root ${
        previewModal.resultUrl ? "has-preview" : ""
      }`}
      busy={previewModal.busy}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="cv-btn"
            disabled={previewModal.busy}
            onClick={onClose}
          >
            Fechar
          </button>
          <button
            type="submit"
            form={previewFormId}
            className="cv-btn cv-btn-primary"
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
      <div className="cv-test-layout">
        <form id={previewFormId} className="cv-subform cv-test-fields" onSubmit={onSubmit}>
          <strong>{reportName}</strong>

          {previewModal.error && (
            <div className="cv-dialog-alert is-error" role="alert">
              <AlertCircle size={15} />
              <span>{previewModal.error}</span>
            </div>
          )}

          {previewModal.serverErrors && previewModal.serverErrors.length > 0 && (
            <div className="cv-test-server-errors" role="region" aria-label="Erros por bloco">
              <span className="cv-test-errors-title">Erros detectados no servidor:</span>
              <ul className="cv-test-errors-list">
                {previewModal.serverErrors.map((err, i) => (
                  <li key={i}>
                    {err.blockId && onSelectBlock ? (
                      <button
                        type="button"
                        className="cv-test-error-link"
                        onClick={() => {
                          onSelectBlock(err.blockId!);
                          onClose();
                        }}
                      >
                        Bloco <code>{err.blockId}</code>: {err.message}
                      </button>
                    ) : (
                      <span>{err.message}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {previewModal.info && (
            <div className="cv-banner cv-banner-ok" role="status">
              <div className="cv-banner-content">
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

          <div className="cv-test-parameter-grid">
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
            <p className="cv-test-empty">Este relatório não exige parâmetros.</p>
          )}
        </form>

        {previewModal.resultUrl && (
          <section className="cv-test-result" aria-label="Prévia gerada">
            <div className="cv-test-result-bar">
              <div className="cv-test-result-meta">
                <span className="cv-test-result-name">{previewModal.resultName}</span>
                {previewModal.generationTimeMs !== undefined && (
                  <span className="cv-test-result-time">
                    <Clock size={12} aria-hidden="true" />
                    Gerado em {(previewModal.generationTimeMs / 1000).toFixed(1)} s
                  </span>
                )}
              </div>
              <a
                className="cv-btn cv-btn-primary"
                href={previewModal.resultUrl}
                download={previewModal.resultName}
              >
                <Download size={14} />
                Baixar
              </a>
            </div>

            {previewModal.resultFormat === "pdf" ? (
              <iframe
                title="Prévia do relatório"
                src={previewModal.resultUrl}
                className="cv-preview-pdf-frame"
              />
            ) : (
              <div className="cv-test-xlsx-summary">
                <p>Planilha Excel gerada com sucesso.</p>
                <p className="cv-test-xlsx-note">
                  O arquivo contém todas as abas e formatações configuradas no layout.
                </p>
                <a
                  className="cv-btn cv-btn-primary"
                  href={previewModal.resultUrl}
                  download={previewModal.resultName}
                >
                  <Download size={14} />
                  Baixar planilha (.xlsx)
                </a>
              </div>
            )}
          </section>
        )}
      </div>
    </InlineDialog>
  );
}
