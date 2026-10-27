import type { SourcePreviewState } from "../api/useSourcePreview";
import { memo, useMemo } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import BlockPreview from "../blocks/BlockPreview";
import type {
  CanvasAssetMeta,
  CanvasBlock,
  CanvasSource,
  CatalogSqlSource,
} from "../model";
import { BLOCK_LABELS } from "../model";
import type { CanvasProblemItem } from "../shell/problems";
import { describeBlockLineage } from "../shell/problems";
import type { ResizeHandle } from "./geometry";

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
  pageName?: string;
  pageIndex?: number;
  tempGeometry?: { x: number; y: number; width: number; height: number; tooltip?: string };
  problem?: CanvasProblemItem;
  onOpenProblem?: (problem: CanvasProblemItem) => void;
  previewState?: SourcePreviewState;
  onLoadSourcePreview?: (sourceId: string) => void;
  onStartDrag: (e: ReactPointerEvent, block: CanvasBlock) => void;
  onStartResize: (e: ReactPointerEvent, block: CanvasBlock, handle: ResizeHandle) => void;
  onFocusBlock: (blockId: string) => void;
}

const ALL_HANDLES: { handle: ResizeHandle; label: string; className: string }[] = [
  { handle: "nw", label: "Redimensionar topo-esquerda", className: "cv-resize-handle cv-resize-handle-nw" },
  { handle: "n", label: "Redimensionar altura para cima", className: "cv-resize-handle cv-resize-handle-n" },
  { handle: "ne", label: "Redimensionar topo-direita", className: "cv-resize-handle cv-resize-handle-ne" },
  { handle: "e", label: "Redimensionar largura", className: "cv-resize-handle cv-resize-handle-e" },
  { handle: "se", label: "Redimensionar bloco", className: "cv-resize-handle cv-resize-handle-se" },
  { handle: "s", label: "Redimensionar altura", className: "cv-resize-handle cv-resize-handle-s" },
  { handle: "sw", label: "Redimensionar base-esquerda", className: "cv-resize-handle cv-resize-handle-sw" },
  { handle: "w", label: "Redimensionar largura para esquerda", className: "cv-resize-handle cv-resize-handle-w" },
];

function BlockFrameComponent({
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
  pageName,
  pageIndex = 0,
  tempGeometry,
  problem,
  onOpenProblem,
  onLoadSourcePreview,
  previewState,
  onStartDrag,
  onStartResize,
  onFocusBlock,
}: BlockFrameProps) {
  const currentX = tempGeometry ? tempGeometry.x : block.x;
  const currentY = tempGeometry ? tempGeometry.y : block.y;
  const currentW = tempGeometry ? tempGeometry.width : block.width;
  const currentH = tempGeometry ? tempGeometry.height : block.height;

  const assetFilenames = useMemo(
    () => Object.fromEntries(assets.map((a) => [a.id, a.filename])),
    [assets],
  );
  const lineage = useMemo(
    () => describeBlockLineage(block, sources, assetFilenames),
    [block, sources, assetFilenames],
  );

  let originState: "no_source" | "preview" | "sample" = "sample";
  let originLabel = "Exemplo";
  let hasMissingSource = false;
  let canLoadPreview = false;
  let blockSourceId: string | undefined;

  if (block.type === "image") {
    if (!block.asset_id) {
      originState = "no_source";
      originLabel = "Sem imagem";
      hasMissingSource = true;
    } else {
      originState = "preview";
      originLabel = "Imagem vinculada";
    }
  } else if (block.type === "text") {
    if (block.source_id) {
      blockSourceId = block.source_id;
      const src = sources.find((s) => s.id === block.source_id);
      if (!src) {
        originState = "no_source";
        originLabel = "Sem fonte";
        hasMissingSource = true;
      } else {
        const local = localDatasets.get(src.id);
        const rowsCount = local?.rows?.length || 0;
        if (!showSampleData && local) {
          originState = "preview";
          originLabel = `Prévia · ${rowsCount} linhas`;
        } else {
          originState = "sample";
          originLabel = "Exemplo";
          if (!showSampleData && rowsCount === 0 && src.type === "report") {
            canLoadPreview = true;
          }
        }
      }
    } else {
      originState = "sample";
      originLabel = "Exemplo";
    }
  } else {
    // table, kpi, bar, line, pie
    if (!block.source_id) {
      originState = "no_source";
      originLabel = "Sem fonte";
      hasMissingSource = true;
    } else {
      blockSourceId = block.source_id;
      const src = sources.find((s) => s.id === block.source_id);
      if (!src) {
        originState = "no_source";
        originLabel = "Sem fonte";
        hasMissingSource = true;
      } else {
        const local = localDatasets.get(src.id);
        const rowsCount = local?.rows?.length || 0;
        if (!showSampleData && local) {
          originState = "preview";
          originLabel = `Prévia · ${rowsCount} linhas`;
        } else {
          originState = "sample";
          originLabel = "Exemplo";
          if (!showSampleData && rowsCount === 0 && src.type === "report") {
            canLoadPreview = true;
          }
        }
      }
    }
  }

  if (!showSampleData && blockSourceId && sources.find(s => s.id === blockSourceId)?.type === "report" && !localDatasets.has(blockSourceId)) {
    originState = "preview";
    originLabel = previewState?.status === "loading" ? "Prévia · carregando…" : "Prévia · indisponível";
    canLoadPreview = false;
  }

  const blockDisplayName = block.title || BLOCK_LABELS[block.type];
  const pageLabel = pageName || `página ${pageIndex + 1}`;
  const ariaLabel = `${BLOCK_LABELS[block.type]}, ${blockDisplayName}, ${pageLabel}`;

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={ariaLabel}
      className={`cv-block cv-block-${block.type} ${isSelected ? "is-selected" : ""} ${
        isDragging ? "is-dragging" : ""
      } ${problem ? `has-problem is-${problem.severity}` : ""}`.trim()}
      style={{
        left: `${isDragging ? block.x : currentX}px`,
        top: `${isDragging ? block.y : currentY}px`,
        transform: isDragging ? `translate3d(${currentX - block.x}px, ${currentY - block.y}px, 0)` : undefined,
        width: `${currentW}px`,
        height: `${currentH}px`,
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button, input, select, textarea, a, [contenteditable]")) return;
        onStartDrag(e, block);
      }}
      onFocus={() => onFocusBlock(block.id)}
    >
      {/* Origin Chip (Top-Left) */}
      <div
        className={`cv-origin-chip is-${originState}`}
        title={lineage || (hasMissingSource ? "Nenhuma fonte associada ao bloco" : undefined)}
      >
        <span>{originLabel}</span>
        {canLoadPreview && blockSourceId && onLoadSourcePreview && (
          <button
            type="button"
            className="cv-origin-chip-action"
            onClick={(e) => {
              e.stopPropagation();
              onLoadSourcePreview(blockSourceId!);
            }}
          >
            Carregar prévia
          </button>
        )}
      </div>

      {/* Problem Badge in Top-Right */}
      {problem && (
        <button
          type="button"
          className={`cv-problem-badge is-${problem.severity}`}
          title={`${problem.severity === "error" ? "Erro" : "Aviso"}: ${problem.message}`}
          aria-label={`${problem.severity === "error" ? "Erro" : "Aviso"}: ${problem.message}`}
          onClick={(e) => {
            e.stopPropagation();
            onFocusBlock(block.id);
            onOpenProblem?.(problem);
          }}
        >
          !
        </button>
      )}

      {/* Floating Tooltip during Drag/Resize */}
      {isDragging && tempGeometry?.tooltip && (
        <div className="cv-drag-tooltip" aria-hidden="true">
          {tempGeometry.tooltip}
        </div>
      )}

      {/* Static Coordinates when Selected and Not Dragging */}
      {isSelected && !isDragging && (
        <span className="cv-block-coords">
          {Math.round(block.x)}, {Math.round(block.y)} · {Math.round(block.width)}×
          {Math.round(block.height)}
        </span>
      )}

      {!showSampleData && previewState && previewState.status !== "ready" ? (
        <div className="cv-block-inner"><div className="cv-block-problem-inline" role="status">
          <p>{previewState.status === "loading" ? "Carregando prévia…" : previewState.error}</p>
          {previewState.status !== "loading" && blockSourceId && <button type="button" className="cv-btn-compact" onClick={() => onLoadSourcePreview?.(blockSourceId!)}>Tentar de novo</button>}
        </div></div>
      ) : <>
      {/* Block Preview Content or Inline Problem Message */}
      {problem && problem.severity === "error" && hasMissingSource ? (
        <div className="cv-block-inner">
          <div className="cv-block-problem-inline">
            <p className="cv-block-error-text">{problem.message}</p>
          </div>
        </div>
      ) : (
        <BlockPreview
          block={
            tempGeometry
              ? { ...block, x: currentX, y: currentY, width: currentW, height: currentH }
              : block
          }
          background={background}
          sources={sources}
          assets={assets}
          assetUrls={assetUrls}
          availableSources={availableSources}
          localDatasets={localDatasets}
          reportName={reportName}
          showSampleData={showSampleData}
        />
      )}

      </>}
      {/* 8 Resize Handles */}
      {isSelected && (
        <>
          {ALL_HANDLES.map((h) => (
            <button
              key={h.handle}
              type="button"
              tabIndex={-1}
              aria-label={h.label}
              className={h.className}
              onPointerDown={(e) => onStartResize(e, block, h.handle)}
            />
          ))}
        </>
      )}
    </div>
  );
}

export default memo(BlockFrameComponent, (prev, next) => {
  return (
    prev.previewState === next.previewState &&
    prev.isSelected === next.isSelected &&
    prev.isDragging === next.isDragging &&
    prev.background === next.background &&
    prev.showSampleData === next.showSampleData &&
    prev.pageName === next.pageName &&
    prev.pageIndex === next.pageIndex &&
    prev.problem === next.problem &&
    prev.tempGeometry === next.tempGeometry &&
    prev.sources === next.sources &&
    prev.assets === next.assets &&
    prev.assetUrls === next.assetUrls &&
    prev.availableSources === next.availableSources &&
    prev.localDatasets === next.localDatasets &&
    prev.reportName === next.reportName &&
    prev.block.id === next.block.id &&
    prev.block.type === next.block.type &&
    prev.block.x === next.block.x &&
    prev.block.y === next.block.y &&
    prev.block.width === next.block.width &&
    prev.block.height === next.block.height &&
    prev.block.title === next.block.title &&
    prev.block.text === next.block.text &&
    prev.block.source_id === next.block.source_id &&
    prev.block.asset_id === next.block.asset_id &&
    prev.block.options === next.block.options
  );
});
