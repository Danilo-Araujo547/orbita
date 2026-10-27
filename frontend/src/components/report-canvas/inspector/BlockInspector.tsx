import { useId } from "react";
import { ArrowDown, ArrowUp, Copy, Trash2, Upload } from "lucide-react";
import Select from "../../Select";
import { COMPONENT_ICONS, COMPONENT_NAMES } from "../library/BlockLibrary";
import type {
  CanvasAssetMeta,
  CanvasBlock,
  CanvasPageConfig,
  CanvasSource,
} from "../model";
import AppearanceFields from "./fields/AppearanceFields";
import DataFields from "./fields/DataFields";
import GeometryFields from "./fields/GeometryFields";

export type InspectorTab = "content" | "appearance";

export interface BlockInspectorProps {
  block: CanvasBlock;
  inspectorTab: InspectorTab;
  pageConfig: CanvasPageConfig;
  sources: CanvasSource[];
  assets: CanvasAssetMeta[];
  uploadingAsset: boolean;
  knownColumns: string[];
  resolveKnownColumns: (sourceId?: string) => string[];
  onChangeTab: (tab: InspectorTab) => void;
  onReorderLayer: (dir: -1 | 1) => void;
  onDuplicateBlock: () => void;
  onRemoveBlock: (blockId: string) => void;
  onTriggerImageUpload: (blockId: string) => void;
  onOpenCreateSource: () => void;
  onColumnWidthsValidation: (blockId: string | null, errorMessage?: string) => void;
  onUpdateBlock: (
    blockId: string,
    label: string,
    updater: (b: CanvasBlock) => CanvasBlock,
    coalesceKey?: string,
  ) => void;
}

export default function BlockInspector({
  block,
  inspectorTab,
  pageConfig,
  sources,
  assets,
  uploadingAsset,
  knownColumns,
  resolveKnownColumns,
  onChangeTab,
  onReorderLayer,
  onDuplicateBlock,
  onRemoveBlock,
  onTriggerImageUpload,
  onOpenCreateSource,
  onColumnWidthsValidation,
  onUpdateBlock,
}: BlockInspectorProps) {
  const inspectorId = useId();
  const Icon = COMPONENT_ICONS[block.type];

  return (
    <>
      <div className="rc-inspector-heading">
        <Icon size={22} />
        <div>
          <strong>{COMPONENT_NAMES[block.type]}</strong>
          <small>{block.id}</small>
        </div>
      </div>

      <div className="rc-inspector-actions" role="group" aria-label="Ações do bloco">
        <div className="rc-section-actions">
          <button
            type="button"
            className="rc-icon-btn"
            title="Enviar camada para trás"
            aria-label="Enviar camada para trás"
            onClick={() => onReorderLayer(-1)}
          >
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            className="rc-icon-btn"
            title="Trazer camada para frente"
            aria-label="Trazer camada para frente"
            onClick={() => onReorderLayer(1)}
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            className="rc-icon-btn"
            title="Duplicar bloco"
            aria-label="Duplicar bloco"
            onClick={onDuplicateBlock}
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            className="rc-icon-btn danger"
            title="Excluir bloco (Delete)"
            aria-label="Excluir bloco"
            onClick={() => onRemoveBlock(block.id)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div
        className="rc-inspector-tabs"
        role="tablist"
        aria-label="Propriedades do bloco"
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            const next: InspectorTab =
              e.key === "Home"
                ? "content"
                : e.key === "End"
                  ? "appearance"
                  : inspectorTab === "content"
                    ? "appearance"
                    : "content";
            onChangeTab(next);
            e.currentTarget
              .querySelectorAll<HTMLButtonElement>("button")
              [next === "content" ? 0 : 1]?.focus();
          }
        }}
      >
        <button
          type="button"
          role="tab"
          id={`${inspectorId}-content`}
          aria-controls={`${inspectorId}-panel`}
          tabIndex={inspectorTab === "content" ? 0 : -1}
          aria-selected={inspectorTab === "content"}
          className={inspectorTab === "content" ? "is-active" : ""}
          onClick={() => onChangeTab("content")}
        >
          Conteúdo
        </button>
        <button
          type="button"
          role="tab"
          id={`${inspectorId}-appearance`}
          aria-controls={`${inspectorId}-panel`}
          tabIndex={inspectorTab === "appearance" ? 0 : -1}
          aria-selected={inspectorTab === "appearance"}
          className={inspectorTab === "appearance" ? "is-active" : ""}
          onClick={() => onChangeTab("appearance")}
        >
          Aparência
        </button>
      </div>

      <div
        role="tabpanel"
        id={`${inspectorId}-panel`}
        aria-labelledby={`${inspectorId}-${inspectorTab}`}
      >
        <section className="rc-section" hidden={inspectorTab !== "content"}>
          <label className="rc-field">
            <span>Título / Rótulo</span>
            <input
              type="text"
              maxLength={300}
              placeholder="Opcional"
              value={block.title || ""}
              onChange={(e) =>
                onUpdateBlock(
                  block.id,
                  "Editar título do bloco",
                  (b) => ({ ...b, title: e.target.value }),
                  `title:${block.id}`,
                )
              }
            />
          </label>

          {block.type === "text" && (
            <label className="rc-field">
              <span>Conteúdo de texto</span>
              <textarea
                maxLength={20000}
                rows={5}
                placeholder="Texto livre ou variáveis como {{report_name}}"
                value={block.text || ""}
                onChange={(e) =>
                  onUpdateBlock(
                    block.id,
                    "Editar texto do bloco",
                    (b) => ({ ...b, text: e.target.value }),
                    `text:${block.id}`,
                  )
                }
              />
              <span className="rc-hint">
                Variáveis suportadas: <code>{"{{report_name}}"}</code> ou parâmetros da execução.
              </span>
            </label>
          )}
        </section>

        <GeometryFields
          block={block}
          pageConfig={pageConfig}
          hidden={inspectorTab !== "appearance"}
          onUpdateBlock={onUpdateBlock}
        />

        <AppearanceFields
          block={block}
          hidden={inspectorTab !== "appearance"}
          onUpdateBlock={onUpdateBlock}
        />

        {block.type === "image" && (
          <section className="rc-section" hidden={inspectorTab !== "content"}>
            <div className="rc-section-head">
              <h3>Imagem vinculada</h3>
              <button
                type="button"
                className="rc-mini-btn"
                disabled={uploadingAsset}
                onClick={() => onTriggerImageUpload(block.id)}
              >
                <Upload size={12} />
                Enviar nova
              </button>
            </div>
            <label className="rc-field">
              <span>Arquivo do relatório</span>
              <Select
                value={block.asset_id || ""}
                onChange={(e) =>
                  onUpdateBlock(block.id, "Vincular imagem ao bloco", (b) => ({
                    ...b,
                    asset_id: e.target.value || undefined,
                  }))
                }
              >
                <option value="">Selecione uma imagem enviada</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.filename} ({a.width}×{a.height}px)
                  </option>
                ))}
              </Select>
            </label>
          </section>
        )}

        {block.type !== "text" && block.type !== "image" && (
          <DataFields
            block={block}
            hidden={inspectorTab !== "content"}
            sources={sources}
            knownColumns={knownColumns}
            resolveKnownColumns={resolveKnownColumns}
            onOpenCreateSource={onOpenCreateSource}
            onColumnWidthsValidation={onColumnWidthsValidation}
            onUpdateBlock={onUpdateBlock}
          />
        )}
      </div>
    </>
  );
}
