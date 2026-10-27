import { Upload } from "lucide-react";
import type { CanvasAssetMeta } from "../model";

export interface ImagesPanelProps {
  active: boolean;
  assets: CanvasAssetMeta[];
  assetUrls: Record<string, string>;
  uploadingAsset: boolean;
  onTriggerUpload: () => void;
  onInsertImageBlock: (assetId: string) => void;
}

export default function ImagesPanel({
  active,
  assets,
  assetUrls,
  uploadingAsset,
  onTriggerUpload,
  onInsertImageBlock,
}: ImagesPanelProps) {
  return (
    <section className="rc-section" hidden={!active}>
      <div className="rc-section-head">
        <h3>Imagens ({assets.length})</h3>
        <button
          type="button"
          className="rc-mini-btn"
          disabled={uploadingAsset}
          onClick={onTriggerUpload}
        >
          <Upload size={12} />
          {uploadingAsset ? "Enviando…" : "Enviar"}
        </button>
      </div>
      {assets.length === 0 ? (
        <p className="rc-empty-note">PNG ou JPEG · até 2 MB</p>
      ) : (
        <div className="rc-item-list">
          {assets.map((a) => (
            <div key={a.id} className="rc-list-row">
              <div className="rc-asset-row">
                {assetUrls[a.id] ? (
                  <img src={assetUrls[a.id]} alt={a.filename} className="rc-asset-thumb" />
                ) : (
                  <span className="rc-asset-thumb" aria-hidden="true" />
                )}
                <div className="rc-list-row-main">
                  <span className="rc-list-row-title" title={a.filename}>
                    {a.filename}
                  </span>
                  <span className="rc-list-row-sub">
                    {a.width}×{a.height} px
                  </span>
                </div>
              </div>
              <div className="rc-list-row-actions">
                <button
                  type="button"
                  className="rc-mini-btn"
                  title="Inserir bloco com esta imagem na página atual"
                  onClick={() => onInsertImageBlock(a.id)}
                >
                  Inserir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
