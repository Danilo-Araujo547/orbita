import { ArrowDown, ArrowUp, BookOpen, Plus, Trash2 } from "lucide-react";
import type { CanvasPage, CanvasPageConfig } from "../model";
import { HEX_COLOR_RE, validColor } from "../model";

export interface PagesPanelProps {
  active: boolean;
  pages: CanvasPage[];
  activePage: CanvasPage | undefined;
  pageConfig: CanvasPageConfig;
  onSelectPage: (pageId: string) => void;
  onAddCoverPage: () => void;
  onAddBlankPage: () => void;
  onMovePage: (pageId: string, dir: -1 | 1) => void;
  onDeletePage: (pageId: string) => void;
  onRenameActivePage: (name: string) => void;
  onUpdatePageConfig: (patch: Partial<CanvasPageConfig>, coalesceKey?: string) => void;
}

export default function PagesPanel({
  active,
  pages,
  activePage,
  pageConfig,
  onSelectPage,
  onAddCoverPage,
  onAddBlankPage,
  onMovePage,
  onDeletePage,
  onRenameActivePage,
  onUpdatePageConfig,
}: PagesPanelProps) {
  return (
    <section className="rc-section" hidden={!active}>
      <div className="rc-section-head">
        <h3>Páginas ({pages.length})</h3>
        <div className="rc-section-actions">
          <button
            type="button"
            className="rc-mini-btn"
            title="Inserir página de capa com título e imagem"
            onClick={onAddCoverPage}
          >
            <BookOpen size={12} />
            Capa
          </button>
          <button type="button" className="rc-mini-btn" onClick={onAddBlankPage}>
            <Plus size={12} />
            Página
          </button>
        </div>
      </div>
      <div className="rc-item-list">
        {pages.map((p, idx) => (
          <div
            key={p.id}
            className={`rc-list-row ${p.id === activePage?.id ? "is-active" : ""}`.trim()}
          >
            <button
              type="button"
              className="rc-list-row-main"
              onClick={() => onSelectPage(p.id)}
            >
              <span className="rc-list-row-title">{p.name}</span>
              <span className="rc-list-row-sub">
                {p.blocks.length} bloco(s) · {p.id}
              </span>
            </button>
            <div className="rc-list-row-actions">
              <button
                type="button"
                className="rc-icon-btn"
                title="Mover página para cima"
                aria-label={`Mover ${p.name} para cima`}
                disabled={idx === 0}
                onClick={() => onMovePage(p.id, -1)}
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                className="rc-icon-btn"
                title="Mover página para baixo"
                aria-label={`Mover ${p.name} para baixo`}
                disabled={idx === pages.length - 1}
                onClick={() => onMovePage(p.id, 1)}
              >
                <ArrowDown size={13} />
              </button>
              <button
                type="button"
                className="rc-icon-btn danger"
                title="Remover página"
                aria-label={`Remover ${p.name}`}
                disabled={pages.length <= 1}
                onClick={() => onDeletePage(p.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {activePage && (
        <label className="rc-field">
          <span>Nome da página ativa</span>
          <input
            type="text"
            maxLength={100}
            value={activePage.name}
            onChange={(e) => onRenameActivePage(e.target.value)}
          />
        </label>
      )}

      <div className="rc-grid-2">
        <label className="rc-field">
          <span>Largura (px)</span>
          <input
            type="number"
            min={150}
            max={3000}
            value={pageConfig.width}
            onChange={(e) =>
              onUpdatePageConfig({ width: Number(e.target.value) }, "page-config:width")
            }
          />
        </label>
        <label className="rc-field">
          <span>Altura (px)</span>
          <input
            type="number"
            min={150}
            max={3000}
            value={pageConfig.height}
            onChange={(e) =>
              onUpdatePageConfig({ height: Number(e.target.value) }, "page-config:height")
            }
          />
        </label>
        <label className="rc-field">
          <span>Colunas (1–48)</span>
          <input
            type="number"
            min={1}
            max={48}
            step={1}
            value={pageConfig.columns}
            onChange={(e) =>
              onUpdatePageConfig({ columns: Number(e.target.value) }, "page-config:columns")
            }
          />
        </label>
        <label className="rc-field">
          <span>Fundo da página</span>
          <div className="rc-color-control">
            <input
              type="color"
              aria-label="Cor de fundo da página"
              className="rc-color-input"
              value={validColor(pageConfig.background, "#ffffff")}
              onChange={(e) =>
                onUpdatePageConfig({ background: e.target.value }, "page-config:background")
              }
            />
            <input
              type="text"
              maxLength={7}
              value={pageConfig.background}
              onChange={(e) => {
                if (HEX_COLOR_RE.test(e.target.value)) {
                  onUpdatePageConfig({ background: e.target.value }, "page-config:background");
                }
              }}
            />
          </div>
        </label>
      </div>
    </section>
  );
}
