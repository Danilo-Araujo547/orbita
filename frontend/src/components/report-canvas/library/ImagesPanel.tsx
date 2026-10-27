import { useMemo, useState } from "react";
import { Image as ImageIcon, PanelLeftClose, Trash2, Upload } from "lucide-react";
import InlineDialog from "../../InlineDialog";
import EmptyState from "../common/EmptyState";
import type { CanvasAssetMeta, CanvasBlock, CanvasPage } from "../model";
import { classifyLimitRatio } from "../state/limits";

export interface ImagesPanelProps {
  active: boolean;
  assets: CanvasAssetMeta[];
  assetUrls: Record<string, string>;
  uploadingAsset: boolean;
  pages?: CanvasPage[];
  selectedBlock?: CanvasBlock | null;
  onTriggerUpload: () => void;
  onInsertImageBlock: (assetId: string) => void;
  onUseInSelectedBlock?: (assetId: string) => void;
  onDeleteAsset?: (assetId: string) => void;
  onClosePanel?: () => void;
}

const MAX_IMAGES = 20;

export default function ImagesPanel({
  active,
  assets,
  assetUrls,
  uploadingAsset,
  pages = [],
  selectedBlock = null,
  onTriggerUpload,
  onInsertImageBlock,
  onUseInSelectedBlock,
  onDeleteAsset,
  onClosePanel,
}: ImagesPanelProps) {
  const [pendingDelete, setPendingDelete] = useState<CanvasAssetMeta | null>(null);

  const usageByAssetId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const page of pages) {
      for (const block of page.blocks) {
        if (block.type === "image" && block.asset_id) {
          counts[block.asset_id] = (counts[block.asset_id] || 0) + 1;
        }
      }
    }
    return counts;
  }, [pages]);

  const severity = classifyLimitRatio(assets.length / MAX_IMAGES);
  const canUseOnSelected = selectedBlock?.type === "image" && Boolean(onUseInSelectedBlock);

  return (
    <>
      <section className="cv-panel" hidden={!active} aria-label="Imagens do relatório">
        <header className="cv-panel-header">
          <div className="cv-panel-title-group">
            <h2>Imagens</h2>
            <span
              className={`cv-panel-counter ${severity !== "ok" ? `is-${severity}` : ""}`.trim()}
              aria-label={`Uso de imagens: ${assets.length} de ${MAX_IMAGES}`}
            >
              {assets.length}/{MAX_IMAGES}
            </span>
          </div>

          <div className="cv-panel-header-actions">
            <button
              type="button"
              className="cv-panel-action-btn"
              aria-label="Enviar imagem"
              disabled={uploadingAsset || assets.length >= MAX_IMAGES}
              onClick={onTriggerUpload}
            >
              <Upload size={12} aria-hidden="true" />
              <span>{uploadingAsset ? "Enviando…" : "Enviar imagem"}</span>
            </button>

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
          {assets.length === 0 ? (
            <EmptyState
              title="Nenhuma imagem disponível"
              description="Envie logotipos e imagens institucionais em PNG ou JPEG de até 2 MB."
              actionLabel="Enviar imagem"
              actionDisabled={uploadingAsset || assets.length >= MAX_IMAGES}
              onAction={onTriggerUpload}
            />
          ) : (
            <div className="cv-image-list" role="list">
              {assets.map((asset) => {
                const usedCount = usageByAssetId[asset.id] || 0;
                const usageLabel =
                  usedCount === 1 ? "usada em 1 bloco" : `usada em ${usedCount} blocos`;

                return (
                  <div key={asset.id} role="listitem" className="cv-image-row">
                    {assetUrls[asset.id] ? (
                      <img
                        src={assetUrls[asset.id]}
                        alt={asset.filename}
                        className="cv-image-thumb"
                      />
                    ) : (
                      <span className="cv-image-thumb" aria-hidden="true">
                        <ImageIcon
                          size={16}
                          style={{ margin: "11px", color: "var(--cv-text-3)" }}
                        />
                      </span>
                    )}

                    <div className="cv-image-meta">
                      <span className="cv-image-name" title={asset.filename}>
                        {asset.filename}
                      </span>
                      <span className="cv-image-sub">
                        {asset.width}×{asset.height} px · {usageLabel}
                      </span>
                    </div>

                    <div className="cv-image-actions">
                      {canUseOnSelected ? (
                        <button
                          type="button"
                          className="cv-panel-action-btn"
                          aria-label={`Usar ${asset.filename} no bloco selecionado`}
                          title="Usar no bloco de imagem selecionado"
                          disabled={selectedBlock?.asset_id === asset.id}
                          onClick={() => onUseInSelectedBlock?.(asset.id)}
                        >
                          {selectedBlock?.asset_id === asset.id ? "Ativa" : "Usar"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="cv-panel-action-btn"
                          aria-label={`Inserir ${asset.filename} na página`}
                          title="Inserir novo bloco com esta imagem"
                          onClick={() => onInsertImageBlock(asset.id)}
                        >
                          Inserir
                        </button>
                      )}

                      <button
                        type="button"
                        className="cv-panel-icon-btn is-danger"
                        aria-label={`Excluir imagem ${asset.filename}`}
                        title={
                          usedCount > 0
                            ? `Não é possível excluir: ${usageLabel}`
                            : "Excluir imagem não utilizada"
                        }
                        disabled={usedCount > 0 || !onDeleteAsset}
                        onClick={() => setPendingDelete(asset)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {pendingDelete && (
        <InlineDialog
          title="Excluir imagem?"
          subtitle=""
          onClose={() => setPendingDelete(null)}
          className="cv-root cv-dialog"
          footer={
            <>
              <button
                type="button"
                className="cv-btn"
                onClick={() => setPendingDelete(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="cv-btn cv-btn-danger"
                onClick={() => {
                  const id = pendingDelete.id;
                  setPendingDelete(null);
                  onDeleteAsset?.(id);
                }}
              >
                Excluir
              </button>
            </>
          }
        >
          <p className="cv-dialog-text">
            Remover <strong>{pendingDelete.filename}</strong> da lista de imagens disponíveis?
          </p>
        </InlineDialog>
      )}
    </>
  );
}
