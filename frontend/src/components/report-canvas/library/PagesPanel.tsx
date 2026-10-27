import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  Copy,
  FilePlus2,
  PanelLeftClose,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import InlineDialog from "../../InlineDialog";
import type { CanvasAssetMeta, CanvasPage, CanvasPageConfig, CanvasSource } from "../model";
import type { CanvasProblemItem } from "../shell/problems";
import { describeBlockDisplayName, describeBlockLineage } from "../shell/problems";
import { COMPONENT_ICONS } from "./BlockLibrary";
import PageConfigDialog from "./PageConfigDialog";

export interface PagesPanelProps {
  active: boolean;
  pages: CanvasPage[];
  activePage: CanvasPage | undefined;
  pageConfig: CanvasPageConfig;
  selectedBlockId?: string | null;
  sources?: CanvasSource[];
  assets?: CanvasAssetMeta[];
  blockProblems?: Record<string, CanvasProblemItem>;
  onSelectPage: (pageId: string) => void;
  onSelectBlock?: (blockId: string) => void;
  onAddCoverPage: () => void;
  onAddBlankPage: () => void;
  onDuplicatePage?: (pageId: string) => void;
  onMovePage: (pageId: string, dir: -1 | 1) => void;
  onDeletePage: (pageId: string) => void;
  onRenamePage?: (pageId: string, name: string) => void;
  onRenameActivePage: (name: string) => void;
  onReorderBlock?: (blockId: string, dir: -1 | 1) => void;
  onUpdatePageConfig: (patch: Partial<CanvasPageConfig>, coalesceKey?: string) => void;
  onClosePanel?: () => void;
}

export default function PagesPanel({
  active,
  pages,
  activePage,
  pageConfig,
  selectedBlockId = null,
  sources = [],
  assets = [],
  blockProblems = {},
  onSelectPage,
  onSelectBlock,
  onAddCoverPage,
  onAddBlankPage,
  onDuplicatePage,
  onMovePage,
  onDeletePage,
  onRenamePage,
  onRenameActivePage,
  onReorderBlock,
  onUpdatePageConfig,
  onClosePanel,
}: PagesPanelProps) {
  const [newPageMenuOpen, setNewPageMenuOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [draftPageName, setDraftPageName] = useState("");
  const [pendingDeletePage, setPendingDeletePage] = useState<CanvasPage | null>(null);
  const menuAnchorRef = useRef<HTMLDivElement>(null);

  const assetFilenames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of assets) map[a.id] = a.filename;
    return map;
  }, [assets]);

  useEffect(() => {
    if (!newPageMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuAnchorRef.current?.contains(event.target)) return;
      setNewPageMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNewPageMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [newPageMenuOpen]);

  const startRename = (page: CanvasPage) => {
    setEditingPageId(page.id);
    setDraftPageName(page.name);
  };

  const commitRename = (event?: FormEvent) => {
    event?.preventDefault();
    if (!editingPageId) return;
    const trimmed = draftPageName.trim().slice(0, 100);
    if (trimmed) {
      if (onRenamePage) {
        onRenamePage(editingPageId, trimmed);
      } else if (activePage?.id === editingPageId) {
        onRenameActivePage(trimmed);
      }
    }
    setEditingPageId(null);
  };

  return (
    <>
      <section className="cv-panel" hidden={!active} aria-label="Estrutura do relatório">
        <header className="cv-panel-header">
          <div className="cv-panel-title-group">
            <h2>Estrutura</h2>
            <span className="cv-panel-counter" title={`${pages.length} de 30 páginas`}>
              {pages.length}/30
            </span>
          </div>

          <div className="cv-panel-header-actions">
            <button
              type="button"
              className="cv-panel-icon-btn"
              aria-label="Configurar formato da página"
              title="Formato da página"
              onClick={() => setConfigOpen(true)}
            >
              <Settings2 size={14} aria-hidden="true" />
            </button>

            <div ref={menuAnchorRef} className="cv-popover-anchor">
              <button
                type="button"
                className="cv-panel-action-btn"
                aria-label="Nova página"
                aria-haspopup="menu"
                aria-expanded={newPageMenuOpen}
                disabled={pages.length >= 30}
                onClick={() => setNewPageMenuOpen((v) => !v)}
              >
                <Plus size={12} aria-hidden="true" />
                <span>Nova página</span>
              </button>

              {newPageMenuOpen && (
                <div className="cv-popover" role="menu" aria-label="Tipo de nova página">
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Nova página em branco"
                    className="cv-menu-item"
                    onClick={() => {
                      setNewPageMenuOpen(false);
                      onAddBlankPage();
                    }}
                  >
                    <span>
                      <FilePlus2 size={14} aria-hidden="true" />
                      Em branco
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Nova página com capa"
                    className="cv-menu-item"
                    onClick={() => {
                      setNewPageMenuOpen(false);
                      onAddCoverPage();
                    }}
                  >
                    <span>
                      <BookOpen size={14} aria-hidden="true" />
                      Com capa
                    </span>
                  </button>
                </div>
              )}
            </div>

            {onClosePanel && (
              <button
                type="button"
                className="cv-panel-icon-btn"
                aria-label="Recolher painel esquerdo"
                title="Recolher painel (Ctrl+\)"
                onClick={onClosePanel}
              >
                <PanelLeftClose size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        <div className="cv-panel-body">
          <div className="cv-structure-list">
            {pages.map((page, idx) => {
              const isPageActive = page.id === activePage?.id;
              const isEditing = editingPageId === page.id;

              return (
                <div key={page.id} className="cv-page-group">
                  <div className={`cv-page-row ${isPageActive ? "is-active" : ""}`.trim()}>
                    {isEditing ? (
                      <form className="cv-page-rename-form" onSubmit={commitRename}>
                        <input
                          type="text"
                          maxLength={100}
                          autoFocus
                          aria-label={`Novo nome para ${page.name}`}
                          className="cv-page-rename-input"
                          value={draftPageName}
                          onChange={(e) => setDraftPageName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingPageId(null);
                            }
                          }}
                        />
                        <button
                          type="submit"
                          className="cv-panel-icon-btn"
                          aria-label="Confirmar nome da página"
                          title="Salvar nome"
                        >
                          <Check size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="cv-panel-icon-btn"
                          aria-label="Cancelar edição do nome"
                          title="Cancelar"
                          onClick={() => setEditingPageId(null)}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="cv-page-select-btn"
                          aria-label={`Selecionar página ${page.name} (${page.blocks.length} blocos)`}
                          title="Clique duplo para renomear"
                          onClick={() => onSelectPage(page.id)}
                          onDoubleClick={() => startRename(page)}
                        >
                          <span className="cv-page-name">{page.name}</span>
                          <span
                            className="cv-page-count"
                            title={`${page.blocks.length} ${page.blocks.length === 1 ? "bloco" : "blocos"}`}
                          >
                            {page.blocks.length}
                          </span>
                        </button>

                        <div className="cv-page-actions">
                          <button
                            type="button"
                            className="cv-panel-icon-btn"
                            aria-label={`Renomear ${page.name}`}
                            title="Renomear página"
                            onClick={() => startRename(page)}
                          >
                            <Pencil size={12} aria-hidden="true" />
                          </button>
                          {onDuplicatePage && (
                            <button
                              type="button"
                              className="cv-panel-icon-btn"
                              aria-label={`Duplicar ${page.name}`}
                              title="Duplicar página"
                              disabled={pages.length >= 30}
                              onClick={() => onDuplicatePage(page.id)}
                            >
                              <Copy size={12} aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="cv-panel-icon-btn"
                            aria-label={`Mover ${page.name} para cima`}
                            title="Mover página para cima"
                            disabled={idx === 0}
                            onClick={() => onMovePage(page.id, -1)}
                          >
                            <ArrowUp size={12} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="cv-panel-icon-btn"
                            aria-label={`Mover ${page.name} para baixo`}
                            title="Mover página para baixo"
                            disabled={idx === pages.length - 1}
                            onClick={() => onMovePage(page.id, 1)}
                          >
                            <ArrowDown size={12} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="cv-panel-icon-btn is-danger"
                            aria-label={`Excluir ${page.name}`}
                            title="Excluir página"
                            disabled={pages.length <= 1}
                            onClick={() => setPendingDeletePage(page)}
                          >
                            <Trash2 size={12} aria-hidden="true" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {isPageActive && (
                    <ul className="cv-block-tree" aria-label={`Blocos de ${page.name}`}>
                      {page.blocks.length === 0 ? (
                        <li className="cv-block-tree-empty">Nenhum bloco nesta página.</li>
                      ) : (
                        page.blocks.map((block, bIdx) => {
                          const TypeIcon = COMPONENT_ICONS[block.type];
                          const label = describeBlockDisplayName(block);
                          const lineage = describeBlockLineage(block, sources, assetFilenames);
                          const problem = blockProblems[block.id];
                          const isSelected = block.id === selectedBlockId;

                          return (
                            <li
                              key={block.id}
                              className={`cv-block-tree-item ${isSelected ? "is-selected" : ""}`.trim()}
                            >
                              <button
                                type="button"
                                className="cv-block-tree-main"
                                aria-label={`Selecionar bloco ${label}${lineage ? ` (${lineage})` : ""}`}
                                onClick={() => onSelectBlock?.(block.id)}
                              >
                                <span className="cv-block-tree-top">
                                  <TypeIcon
                                    className="cv-block-tree-type-icon"
                                    size={14}
                                    aria-hidden="true"
                                  />
                                  <span className="cv-block-tree-title" title={label}>
                                    {label}
                                  </span>
                                  {problem &&
                                    (problem.severity === "error" ? (
                                      <AlertCircle
                                        size={13}
                                        className="cv-block-tree-problem is-error"
                                        aria-label={problem.message}
                                      >
                                        <title>{problem.message}</title>
                                      </AlertCircle>
                                    ) : (
                                      <AlertTriangle
                                        size={13}
                                        className="cv-block-tree-problem is-warning"
                                        aria-label={problem.message}
                                      >
                                        <title>{problem.message}</title>
                                      </AlertTriangle>
                                    ))}
                                </span>
                                {lineage && (
                                  <span className="cv-block-tree-lineage" title={lineage}>
                                    {lineage}
                                  </span>
                                )}
                              </button>

                              {onReorderBlock && (
                                <div className="cv-block-tree-actions">
                                  <button
                                    type="button"
                                    className="cv-panel-icon-btn"
                                    aria-label={`Enviar ${label} para trás`}
                                    title="Enviar para trás"
                                    disabled={bIdx === 0}
                                    onClick={() => onReorderBlock(block.id, -1)}
                                  >
                                    <ArrowDown size={12} aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    className="cv-panel-icon-btn"
                                    aria-label={`Trazer ${label} para frente`}
                                    title="Trazer para frente"
                                    disabled={bIdx === page.blocks.length - 1}
                                    onClick={() => onReorderBlock(block.id, 1)}
                                  >
                                    <ArrowUp size={12} aria-hidden="true" />
                                  </button>
                                </div>
                              )}
                            </li>
                          );
                        })
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <PageConfigDialog
        open={configOpen}
        pageConfig={pageConfig}
        onClose={() => setConfigOpen(false)}
        onApply={(patch) => onUpdatePageConfig(patch)}
      />

      {pendingDeletePage && (
        <InlineDialog
          title="Excluir página?"
          subtitle=""
          onClose={() => setPendingDeletePage(null)}
          className="cv-root cv-dialog"
          footer={
            <>
              <button
                type="button"
                className="cv-btn"
                onClick={() => setPendingDeletePage(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="cv-btn cv-btn-danger"
                onClick={() => {
                  const id = pendingDeletePage.id;
                  setPendingDeletePage(null);
                  onDeletePage(id);
                }}
              >
                Excluir página
              </button>
            </>
          }
        >
          <p className="cv-dialog-text">
            A página <strong>{pendingDeletePage.name}</strong> (
            {pendingDeletePage.blocks.length}{" "}
            {pendingDeletePage.blocks.length === 1 ? "bloco" : "blocos"}) será removida deste
            relatório.
          </p>
        </InlineDialog>
      )}
    </>
  );
}
