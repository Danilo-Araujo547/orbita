import { Image as ImageIcon } from "lucide-react";
import type { CanvasAssetMeta, CanvasBlock } from "../model";

export interface ImagePreviewProps {
  block: CanvasBlock;
  assets: CanvasAssetMeta[];
  assetUrls: Record<string, string>;
}

export default function ImagePreview({ block, assets, assetUrls }: ImagePreviewProps) {
  const blobUrl = block.asset_id ? assetUrls[block.asset_id] : undefined;
  const meta = assets.find((a) => a.id === block.asset_id);

  return (
    <div className="rc-block-inner">
      {blobUrl ? (
        <div className="rc-image-box">
          <img
            src={blobUrl}
            alt={meta?.filename || block.title || "Imagem do relatório"}
            draggable={false}
          />
        </div>
      ) : (
        <div className="rc-sql-placeholder">
          <span className="rc-sql-badge">
            <ImageIcon size={12} />
            Imagem
          </span>
          <span className="rc-sql-meta">
            {block.asset_id
              ? meta
                ? `Carregando ${meta.filename}…`
                : "Imagem selecionada"
              : "Selecione ou envie uma imagem no painel direito."}
          </span>
        </div>
      )}
    </div>
  );
}
