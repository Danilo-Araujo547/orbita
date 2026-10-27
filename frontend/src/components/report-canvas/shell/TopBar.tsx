import {
  Eye,
  Files,
  Grid,
  RefreshCw,
  Save,
  Scan,
  SlidersHorizontal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Select from "../../Select";
import type { CanvasPage, CanvasPageConfig, OutputFormat } from "../model";
import { clamp, round2 } from "../model";
import { selectPageFormatPreset } from "../state/selectors";

export interface CanvasHeaderControlsProps {
  enabled: boolean;
  outputFormat: OutputFormat;
  dirty: boolean;
  loading: boolean;
  busy: boolean;
  showSampleData: boolean;
  onChangeEnabled: (enabled: boolean) => void;
  onChangeOutputFormat: (format: OutputFormat) => void;
  onChangeShowSampleData: (show: boolean) => void;
  onOpenPreview: () => void;
  onSave: () => void;
}

export function CanvasHeaderControls({
  enabled,
  outputFormat,
  dirty,
  loading,
  busy,
  showSampleData,
  onChangeEnabled,
  onChangeOutputFormat,
  onChangeShowSampleData,
  onOpenPreview,
  onSave,
}: CanvasHeaderControlsProps) {
  return (
    <div className="rc-footer-bar">
      <div className="rc-footer-left">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={enabled}
            disabled={loading || busy}
            onChange={(e) => onChangeEnabled(e.target.checked)}
          />
          <span>Usar Canvas</span>
        </label>
        <label className="rc-footer-select">
          <span>Formato</span>
          <Select
            aria-label="Formato de saída do Canvas"
            value={outputFormat}
            disabled={loading || busy}
            onChange={(e) => onChangeOutputFormat(e.target.value === "xlsx" ? "xlsx" : "pdf")}
          >
            <option value="pdf">PDF</option>
            <option value="xlsx">XLSX</option>
          </Select>
        </label>
        <span className="rc-state-pill">
          {enabled ? "Canvas ativo" : "Rascunho"}
          {dirty ? " · Alterações não salvas" : ""}
        </span>
      </div>
      <div className="rc-footer-right">
        <label
          className="checkbox-label"
          title="Exemplos fictícios apenas no editor; não são salvos nem usados no PDF."
        >
          <input
            type="checkbox"
            checked={showSampleData}
            onChange={(e) => onChangeShowSampleData(e.target.checked)}
          />
          <span>Dados de exemplo</span>
        </label>
        <button
          type="button"
          className="button"
          disabled={loading || busy}
          onClick={onOpenPreview}
        >
          <Eye size={14} />
          Testar
        </button>

        <button
          type="button"
          className="button primary"
          disabled={loading || busy}
          onClick={onSave}
        >
          <Save size={14} />
          {busy ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

export interface TopBarProps {
  pages: CanvasPage[];
  activePageId: string;
  pageConfig: CanvasPageConfig;
  loading: boolean;
  busy: boolean;
  showGrid: boolean;
  zoom: number;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  onSelectPage: (pageId: string) => void;
  onUpdatePageConfig: (patch: Partial<CanvasPageConfig>) => void;
  onToggleGrid: () => void;
  onChangeZoom: (updater: (z: number) => number) => void;
  onFitToWidth: () => void;
  onReload: () => void;
  onToggleRightPanel: () => void;
  onChangeLeftWidth: (w: number) => void;
  onChangeRightWidth: (w: number) => void;
}

export default function TopBar({
  pages,
  activePageId,
  pageConfig,
  loading,
  busy,
  showGrid,
  zoom,
  rightOpen,
  leftWidth,
  rightWidth,
  onSelectPage,
  onUpdatePageConfig,
  onToggleGrid,
  onChangeZoom,
  onFitToWidth,
  onReload,
  onToggleRightPanel,
  onChangeLeftWidth,
  onChangeRightWidth,
}: TopBarProps) {
  const formatPreset = selectPageFormatPreset(pageConfig);

  return (
    <div className="rc-toolbar" role="toolbar" aria-label="Ferramentas do Canvas">
      <div className="rc-toolbar-group rc-page-navigation">
        <Files size={17} aria-hidden="true" />
        <Select
          aria-label="Página atual"
          value={activePageId}
          onChange={(e) => onSelectPage(e.target.value)}
        >
          {pages.map((page) => (
            <option key={page.id} value={page.id}>
              {page.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="rc-toolbar-group">
        <Select
          aria-label="Formato da página"
          value={formatPreset}
          disabled={loading}
          onChange={(e) => {
            if (e.target.value === "portrait") onUpdatePageConfig({ width: 794, height: 1123 });
            if (e.target.value === "landscape") onUpdatePageConfig({ width: 1123, height: 794 });
          }}
        >
          <option value="portrait">A4 · Retrato</option>
          <option value="landscape">A4 · Paisagem</option>
          <option value="custom" disabled>
            Personalizado
          </option>
        </Select>
        <button
          type="button"
          className={`rc-tool-btn ${showGrid ? "is-active" : ""}`.trim()}
          disabled={loading}
          title="Exibir ou ocultar colunas de referência"
          onClick={onToggleGrid}
        >
          <Grid size={14} />
          Guias
        </button>

        <span className="rc-toolbar-divider" aria-hidden="true" />

        <button
          type="button"
          className="rc-tool-btn"
          aria-label="Reduzir zoom"
          onClick={() => onChangeZoom((z) => round2(clamp(z - 0.1, 0.25, 2)))}
        >
          <ZoomOut size={14} />
        </button>
        <span className="rc-zoom-readout">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="rc-tool-btn"
          aria-label="Aumentar zoom"
          onClick={() => onChangeZoom((z) => round2(clamp(z + 0.1, 0.25, 2)))}
        >
          <ZoomIn size={14} />
        </button>
        <button type="button" className="rc-tool-btn" onClick={() => onChangeZoom(() => 1)}>
          100%
        </button>
        <button
          type="button"
          className="rc-tool-btn"
          aria-label="Ajustar largura"
          title="Ajustar largura"
          onClick={onFitToWidth}
        >
          <Scan size={14} />
        </button>
        <button
          type="button"
          className="rc-tool-btn"
          title="Recarregar do servidor"
          disabled={loading || busy}
          onClick={onReload}
        >
          <RefreshCw size={14} />
        </button>
        <span className="rc-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className="rc-tool-btn"
          aria-expanded={rightOpen}
          onClick={onToggleRightPanel}
        >
          <SlidersHorizontal size={16} />
          Propriedades
        </button>
        <details className="rc-panel-settings">
          <summary>Larguras</summary>
          <div>
            <label>
              Painel esquerdo
              <input
                type="range"
                min="200"
                max="360"
                aria-label="Largura do painel esquerdo"
                value={leftWidth}
                onChange={(e) => onChangeLeftWidth(Number(e.target.value))}
              />
            </label>
            <label>
              Propriedades
              <input
                type="range"
                min="240"
                max="420"
                aria-label="Largura de propriedades"
                value={rightWidth}
                onChange={(e) => onChangeRightWidth(Number(e.target.value))}
              />
            </label>
          </div>
        </details>
      </div>
    </div>
  );
}
