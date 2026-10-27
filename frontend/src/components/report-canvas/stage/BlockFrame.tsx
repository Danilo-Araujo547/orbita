import type { PointerEvent as ReactPointerEvent } from "react";
import BlockPreview from "../blocks/BlockPreview";
import type {
  CanvasAssetMeta,
  CanvasBlock,
  CanvasSource,
  CatalogSqlSource,
} from "../model";
import { BLOCK_LABELS } from "../model";

export interface BlockFrameProps {
  block: CanvasBlock;
  isSelected: boolean;
  isDragging: boolean;
  background: string;
  sources: CanvasSource[];
  assets: CanvasAssetMeta[];
  assetUrls: Record<string, string>;
  availableSources: CatalogSqlSource[];
  localDatasets: Map<string, { columns: string[]; rows: unknown[][] }>;
  reportName: string;
  showSampleData: boolean;
  onStartDrag: (e: ReactPointerEvent, block: CanvasBlock) => void;
  onStartResize: (e: ReactPointerEvent, block: CanvasBlock, handle: "se" | "e" | "s") => void;
  onFocusBlock: (blockId: string) => void;
}

export default function BlockFrame({
  block,
  isSelected,
  isDragging,
  background,
  sources,
  assets,
  assetUrls,
  availableSources,
  localDatasets,
  reportName,
  showSampleData,
  onStartDrag,
  onStartResize,
  onFocusBlock,
}: BlockFrameProps) {
  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`Bloco ${BLOCK_LABELS[block.type]} ${block.title || block.id}`}
      className={`rc-block rc-block-${block.type} ${isSelected ? "is-selected" : ""} ${
        isDragging ? "is-dragging" : ""
      }`.trim()}
      style={{
        left: `${block.x}px`,
        top: `${block.y}px`,
        width: `${block.width}px`,
        height: `${block.height}px`,
      }}
      onPointerDown={(e) => onStartDrag(e, block)}
      onFocus={() => onFocusBlock(block.id)}
    >
      {isSelected && (
        <span className="rc-block-coords">
          {Math.round(block.x)}, {Math.round(block.y)} · {Math.round(block.width)}×
          {Math.round(block.height)}
        </span>
      )}

      <BlockPreview
        block={block}
        background={background}
        sources={sources}
        assets={assets}
        assetUrls={assetUrls}
        availableSources={availableSources}
        localDatasets={localDatasets}
        reportName={reportName}
        showSampleData={showSampleData}
      />

      {isSelected && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Redimensionar largura"
            className="rc-resize-handle rc-resize-handle-e"
            onPointerDown={(e) => onStartResize(e, block, "e")}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Redimensionar altura"
            className="rc-resize-handle rc-resize-handle-s"
            onPointerDown={(e) => onStartResize(e, block, "s")}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Redimensionar bloco"
            className="rc-resize-handle rc-resize-handle-se"
            onPointerDown={(e) => onStartResize(e, block, "se")}
          />
        </>
      )}
    </div>
  );
}
