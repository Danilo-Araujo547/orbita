import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { CanvasAssetMeta, CanvasBlock } from "../model";

export interface ImagePreviewProps {
  block: CanvasBlock;
  assets: CanvasAssetMeta[];
  assetUrls: Record<string, string>;
}

export default function ImagePreview({ block, assets, assetUrls }: ImagePreviewProps) {
  const [loadError, setLoadError] = useState(false);
  const blobUrl = block.asset_id ? assetUrls[block.asset_id] : undefined;
  const meta = assets.find((a) => a.id === block.asset_id);

  const hasImage = Boolean(blobUrl && !loadError);

  return (
    <div className="rc-block-inner cv-block-inner cv-block-image-inner">
      {hasImage ? (
        <div className="cv-image-box rc-image-box">
          <img
            src={blobUrl}
            alt={meta?.filename || block.title || "Imagem do relatório"}
            draggable={false}
            onError={() => setLoadError(true)}
          />
        </div>
      ) : (
        <div className="cv-image-placeholder rc-sql-placeholder" role="status">
          <div className="cv-image-placeholder-icon" aria-hidden="true">
            <ImageIcon size={20} strokeWidth={1.5} />
          </div>
          <div className="cv-image-placeholder-text">
            <span className="cv-image-placeholder-title">
              {block.asset_id ? (meta?.filename || "Imagem") : "Imagem"}
            </span>
            <span className="cv-image-placeholder-hint">
              {block.asset_id
                ? loadError
                  ? "Falha ao carregar imagem"
                  : `Carregando ${meta?.filename || "imagem"}…`
                : "Selecione ou envie uma imagem no painel"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
