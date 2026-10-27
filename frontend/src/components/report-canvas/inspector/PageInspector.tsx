import { useId, useMemo, useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { COMPONENT_ICONS } from "../library/BlockLibrary";
import type {
  CanvasLayout,
  CanvasPage,
  CanvasPageConfig,
  OutputFormat,
  XlsxMode,
} from "../model";
import { BLOCK_LABELS } from "../model";
import CollapsibleSection from "./fields/CollapsibleSection";
import ColorField from "./fields/ColorField";
import NumberField from "./fields/NumberField";
import SegmentedControl from "./fields/SegmentedControl";

export interface PageInspectorProps {
  activePage: CanvasPage | undefined;
  pageConfig?: CanvasPageConfig;
  layout?: CanvasLayout;
  outputFormat?: OutputFormat;
  xlsxMode?: XlsxMode;
  onSelectBlock: (blockId: string) => void;
  onRemoveBlock: (blockId: string) => void;
  onUpdatePageConfig?: (patch: Partial<CanvasPageConfig>, coalesceKey?: string) => void;
  onRenameActivePage?: (name: string) => void;
  onChangeOutputFormat?: (format: OutputFormat) => void;
  onChangeXlsxMode?: (mode: XlsxMode) => void;
}

type PagePresetKey = "a4-portrait" | "a4-landscape" | "letter" | "custom";

const PAGE_PRESETS: Record<Exclude<PagePresetKey, "custom">, { w: number; h: number }> = {
  "a4-portrait": { w: 794, h: 1123 },
  "a4-landscape": { w: 1123, h: 794 },
  letter: { w: 816, h: 1056 },
};

const PAGE_BG_SWATCHES = ["#ffffff", "#f8fafc", "#f1f5f9", "#fffbeb", "#0f172a"];

const OUTPUT_FORMAT_OPTIONS = [
  { value: "pdf" as const, label: "PDF" },
  { value: "xlsx" as const, label: "XLSX" },
];

const XLSX_MODE_OPTIONS = [
  { value: "layout" as const, label: "Layout" },
  { value: "table" as const, label: "Tabela" },
];

function detectPreset(width: number, height: number): PagePresetKey {
  if (width === 794 && height === 1123) return "a4-portrait";
  if (width === 1123 && height === 794) return "a4-landscape";
  if (width === 816 && height === 1056) return "letter";
  return "custom";
}

export default function PageInspector({
  activePage,
  pageConfig = { width: 794, height: 1123, columns: 24, background: "#ffffff" },
  layout,
  outputFormat = "pdf",
  xlsxMode,
  onSelectBlock,
  onRemoveBlock,
  onUpdatePageConfig,
  onRenameActivePage,
  onChangeOutputFormat,
  onChangeXlsxMode,
}: PageInspectorProps) {
  const autoId = useId();
  const [forceCustom, setForceCustom] = useState(false);

  const detectedPreset = detectPreset(pageConfig.width, pageConfig.height);
  const activePreset: PagePresetKey = forceCustom ? "custom" : detectedPreset;

  const effectiveXlsxMode: XlsxMode = xlsxMode || layout?.xlsx_mode || "layout";

  const tableBlockCount = useMemo(() => {
    const pages = layout?.pages || (activePage ? [activePage] : []);
    let count = 0;
    for (const p of pages) {
      for (const b of p.blocks) {
        if (b.type === "table") count += 1;
      }
    }
    return count;
  }, [activePage, layout?.pages]);

  const singleTableInvalid = effectiveXlsxMode === "table" && tableBlockCount !== 1;

  return (
    <>
      <div className="cv-insp-header">
        <span className="cv-insp-type-badge" aria-hidden="true">
          <FileText size={14} />
        </span>
        <div className="cv-insp-title-wrap">
          <h2 className="cv-insp-page-heading">Propriedades da página</h2>
        </div>
      </div>

      <div className="cv-inspector-scroll">
        <CollapsibleSection title="Página" defaultOpen={true}>
          {activePage && (
            <div className="cv-field">
              <label htmlFor={`${autoId}-page-name`} className="cv-label">
                Nome da página
              </label>
              <input
                id={`${autoId}-page-name`}
                type="text"
                className="cv-input"
                maxLength={100}
                disabled={!onRenameActivePage}
                value={activePage.name}
                onChange={(e) => onRenameActivePage?.(e.target.value)}
              />
            </div>
          )}

          <div className="cv-field">
            <label htmlFor={`${autoId}-preset`} className="cv-label">
              Tamanho da página
            </label>
            <select
              id={`${autoId}-preset`}
              className="cv-input"
              disabled={!onUpdatePageConfig}
              value={activePreset}
              onChange={(e) => {
                const key = e.target.value as PagePresetKey;
                if (key === "custom") {
                  setForceCustom(true);
                  return;
                }
                setForceCustom(false);
                const dims = PAGE_PRESETS[key];
                onUpdatePageConfig?.({ width: dims.w, height: dims.h });
              }}
            >
              <option value="a4-portrait">A4 retrato (794 × 1123 px)</option>
              <option value="a4-landscape">A4 paisagem (1123 × 794 px)</option>
              <option value="letter">Carta (816 × 1056 px)</option>
              <option value="custom">Personalizado</option>
            </select>
          </div>

          <div className="cv-grid-pair">
            <NumberField
              label="Largura"
              value={pageConfig.width}
              min={150}
              max={3000}
              step={1}
              unit="px"
              disabled={!onUpdatePageConfig}
              onChange={(w) => onUpdatePageConfig?.({ width: w }, "page-w")}
            />
            <NumberField
              label="Altura"
              value={pageConfig.height}
              min={150}
              max={3000}
              step={1}
              unit="px"
              disabled={!onUpdatePageConfig}
              onChange={(h) => onUpdatePageConfig?.({ height: h }, "page-h")}
            />
          </div>

          <NumberField
            label="Colunas da grade"
            value={pageConfig.columns}
            min={1}
            max={48}
            step={1}
            disabled={!onUpdatePageConfig}
            onChange={(cols) => onUpdatePageConfig?.({ columns: Math.round(cols) }, "page-cols")}
          />

          <ColorField
            label="Cor de fundo"
            value={pageConfig.background || "#ffffff"}
            swatches={PAGE_BG_SWATCHES}
            disabled={!onUpdatePageConfig}
            onChange={(bg) => onUpdatePageConfig?.({ background: bg }, "page-bg")}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Formato e planilha" defaultOpen={true}>
          <div className="cv-field">
            <span className="cv-label">Formato de saída</span>
            <SegmentedControl
              ariaLabel="Formato de saída"
              options={OUTPUT_FORMAT_OPTIONS}
              value={outputFormat}
              disabled={!onChangeOutputFormat}
              onChange={(fmt) => onChangeOutputFormat?.(fmt)}
            />
          </div>

          <div className="cv-field">
            <span className="cv-label">Modo de planilha (XLSX)</span>
            <SegmentedControl
              ariaLabel="Modo de planilha"
              options={XLSX_MODE_OPTIONS}
              value={effectiveXlsxMode}
              disabled={!onChangeXlsxMode || outputFormat === "pdf"}
              disabledReason={
                outputFormat === "pdf"
                  ? "Modo de planilha só está disponível na exportação em XLSX."
                  : undefined
              }
              onChange={(mode) => onChangeXlsxMode?.(mode)}
            />
            {singleTableInvalid && (
              <p className="cv-field-error" role="alert">
                Modo Tabela exige uma única tabela no relatório ({tableBlockCount} encontrada
                {tableBlockCount === 1 ? "" : "s"}).
              </p>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title={`Blocos na página (${activePage?.blocks.length || 0})`}
          defaultOpen={true}
        >
          {activePage?.blocks.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {activePage.blocks.map((b) => {
                const Icon = COMPONENT_ICONS[b.type];
                return (
                  <div key={b.id} className="cv-table-col-item">
                    <button
                      type="button"
                      style={{
                        flex: "1 1 auto",
                        minWidth: 0,
                        border: 0,
                        background: "transparent",
                        color: "var(--cv-text)",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: 0,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                      onClick={() => onSelectBlock(b.id)}
                    >
                      <Icon size={13} aria-hidden="true" />
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {b.title || BLOCK_LABELS[b.type]}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="cv-well-btn is-danger"
                      aria-label={`Remover ${b.title || b.id}`}
                      title="Excluir bloco"
                      onClick={() => onRemoveBlock(b.id)}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="cv-field-hint">Nenhum bloco nesta página.</p>
          )}
        </CollapsibleSection>
      </div>
    </>
  );
}
