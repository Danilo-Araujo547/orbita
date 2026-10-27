import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import InlineDialog from "../../InlineDialog";
import type { CanvasPageConfig } from "../model";
import { HEX_COLOR_RE, clamp, validColor } from "../model";

export interface PageConfigDialogProps {
  open: boolean;
  pageConfig: CanvasPageConfig;
  onClose: () => void;
  onApply: (patch: Partial<CanvasPageConfig>) => void;
}

export default function PageConfigDialog({
  open,
  pageConfig,
  onClose,
  onApply,
}: PageConfigDialogProps) {
  const formId = useId();
  const [width, setWidth] = useState(String(pageConfig.width));
  const [height, setHeight] = useState(String(pageConfig.height));
  const [columns, setColumns] = useState(String(pageConfig.columns));
  const [background, setBackground] = useState(pageConfig.background);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setWidth(String(pageConfig.width));
    setHeight(String(pageConfig.height));
    setColumns(String(pageConfig.columns));
    setBackground(pageConfig.background);
    setError("");
  }, [open, pageConfig]);

  if (!open) return null;

  const preset =
    Number(width) === 794 && Number(height) === 1123
      ? "portrait"
      : Number(width) === 1123 && Number(height) === 794
        ? "landscape"
        : "custom";

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const w = Number(width);
    const h = Number(height);
    const cols = Number(columns);
    if (!Number.isFinite(w) || w < 150 || w > 3000) {
      setError("Informe largura entre 150 e 3000 px.");
      return;
    }
    if (!Number.isFinite(h) || h < 150 || h > 3000) {
      setError("Informe altura entre 150 e 3000 px.");
      return;
    }
    if (!Number.isInteger(cols) || cols < 1 || cols > 48) {
      setError("Informe um número inteiro de colunas entre 1 e 48.");
      return;
    }
    if (!HEX_COLOR_RE.test(background.trim())) {
      setError("Informe a cor de fundo no formato hexadecimal (#rrggbb).");
      return;
    }
    onApply({
      width: clamp(w, 150, 3000),
      height: clamp(h, 150, 3000),
      columns: clamp(cols, 1, 48),
      background: validColor(background.trim(), "#ffffff"),
    });
    onClose();
  };

  return (
    <InlineDialog
      title="Formato da página"
      subtitle=""
      onClose={onClose}
      className="cv-root cv-dialog"
      footer={
        <>
          <button type="button" className="cv-btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="cv-btn cv-btn-primary">
            Aplicar
          </button>
        </>
      }
    >
      <form id={formId} className="cv-dialog-stack" onSubmit={handleSubmit}>
        {error && (
          <p className="cv-dialog-alert" role="alert">
            {error}
          </p>
        )}
        <fieldset>
          <div className="cv-dialog-stack">
            <label className="cv-dialog-field">
              <span>Predefinição</span>
              <select
                aria-label="Predefinição da página"
                value={preset}
                onChange={(e) => {
                  if (e.target.value === "portrait") {
                    setWidth("794");
                    setHeight("1123");
                  } else if (e.target.value === "landscape") {
                    setWidth("1123");
                    setHeight("794");
                  }
                }}
              >
                <option value="portrait">A4 · Retrato (794 × 1123 px)</option>
                <option value="landscape">A4 · Paisagem (1123 × 794 px)</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>

            <div className="cv-dialog-grid-2">
              <label className="cv-dialog-field">
                <span>Largura (px)</span>
                <input
                  type="number"
                  min={150}
                  max={3000}
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                />
              </label>
              <label className="cv-dialog-field">
                <span>Altura (px)</span>
                <input
                  type="number"
                  min={150}
                  max={3000}
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                />
              </label>
              <label className="cv-dialog-field">
                <span>Colunas de guia (1–48)</span>
                <input
                  type="number"
                  min={1}
                  max={48}
                  step={1}
                  value={columns}
                  onChange={(e) => setColumns(e.target.value)}
                />
              </label>
              <label className="cv-dialog-field">
                <span>Fundo da folha</span>
                <div className="cv-dialog-color-row">
                  <input
                    type="color"
                    aria-label="Seletor de cor de fundo da folha"
                    value={validColor(background, "#ffffff")}
                    onChange={(e) => setBackground(e.target.value)}
                  />
                  <input
                    type="text"
                    maxLength={7}
                    aria-label="Código hexadecimal da cor de fundo"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                  />
                </div>
              </label>
            </div>
          </div>
        </fieldset>
      </form>
    </InlineDialog>
  );
}
