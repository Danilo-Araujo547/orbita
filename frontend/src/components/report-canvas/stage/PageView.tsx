import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  CanvasAssetMeta,
  CanvasBlock,
  CanvasPageConfig,
  CanvasSource,
  CatalogSqlSource,
} from "../model";
import { isDarkHex } from "../model";
import EmptyState from "../common/EmptyState";
import type { CanvasProblemItem } from "../shell/problems";
import BlockFrame from "./BlockFrame";
import type { ResizeHandle, SnapGuide } from "./geometry";

export interface PageViewProps {
  pageConfig: CanvasPageConfig;
  blocks: CanvasBlock[];
  zoom: number;
  showGrid: boolean;
  selectedBlockId: string | null;
  draggingBlockId: string | null;
  sources: CanvasSource[];
  assets: CanvasAssetMeta[];
  assetUrls: Record<string, string>;
  availableSources: CatalogSqlSource[];
  localDatasets: Map<string, { columns: string[]; rows: unknown[][] }>;
  reportName: string;
  showSampleData: boolean;
  pageName?: string;
  pageIndex?: number;
  tempGeometries?: Record<
    string,
    { x: number; y: number; width: number; height: number; tooltip?: string }
  >;
  activeGuides?: SnapGuide[];
  blockProblems?: Record<string, CanvasProblemItem>;
  onOpenProblem?: (problem: CanvasProblemItem) => void;
  onLoadSourcePreview?: (sourceId: string) => void;
  onClearSelection: () => void;
  onSelectBlock: (blockId: string) => void;
  onStartDrag: (e: ReactPointerEvent, block: CanvasBlock) => void;
  onStartResize: (e: ReactPointerEvent, block: CanvasBlock, handle: ResizeHandle) => void;
  onAddBlock?: () => void;
}

export default function PageView({
  pageConfig,
  blocks,
  zoom,
  showGrid,
  selectedBlockId,
  draggingBlockId,
  sources,
  assets,
  assetUrls,
  availableSources,
  localDatasets,
  reportName,
  showSampleData,
  pageName,
  pageIndex = 0,
  tempGeometries,
  activeGuides,
  blockProblems,
  onOpenProblem,
  onLoadSourcePreview,
  onClearSelection,
  onSelectBlock,
  onStartDrag,
  onStartResize,
  onAddBlock,
}: PageViewProps) {
  return (
    <div
      className="cv-page-frame"
      style={{
        width: `${Math.round(pageConfig.width * zoom)}px`,
        height: `${Math.round(pageConfig.height * zoom)}px`,
      }}
    >
      <div
        className="cv-page"
        data-page-tone={isDarkHex(pageConfig.background) ? "dark" : "light"}
        style={{
          width: `${pageConfig.width}px`,
          height: `${pageConfig.height}px`,
          backgroundColor: pageConfig.background,
          transform: `scale(${zoom})`,
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onClearSelection();
        }}
      >
        {showGrid && (
          <div
            className="cv-column-grid"
            style={{
              gridTemplateColumns: `repeat(${pageConfig.columns}, minmax(0, 1fr))`,
            }}
            aria-hidden="true"
          >
            {Array.from({ length: pageConfig.columns }).map((_, i) => (
              <div key={i} className="cv-column-guide" />
            ))}
          </div>
        )}

        {/* Smart Guides Overlay */}
        {activeGuides &&
          activeGuides.map((guide, idx) => (
            <div
              key={idx}
              className={`cv-snap-guide cv-snap-guide-${guide.type}`}
              style={
                guide.type === "vertical"
                  ? { left: `${guide.position}px` }
                  : { top: `${guide.position}px` }
              }
              aria-hidden="true"
            >
              {guide.label && <span className="cv-snap-guide-label">{guide.label}</span>}
            </div>
          ))}

        {blocks.length === 0 && (
          <div className="cv-page-empty-wrap">
            <EmptyState
              title="A página está vazia"
              description="Adicione gráficos, tabelas ou indicadores para compor esta página."
              actionLabel="Adicionar bloco"
              onAction={onAddBlock}
            />
          </div>
        )}

        {blocks.map((block) => (
          <BlockFrame
            key={block.id}
            block={block}
            isSelected={block.id === selectedBlockId}
            isDragging={draggingBlockId === block.id}
            background={pageConfig.background}
            sources={sources}
            assets={assets}
            assetUrls={assetUrls}
            availableSources={availableSources}
            localDatasets={localDatasets}
            reportName={reportName}
            showSampleData={showSampleData}
            pageName={pageName}
            pageIndex={pageIndex}
            tempGeometry={tempGeometries ? tempGeometries[block.id] : undefined}
            problem={blockProblems ? blockProblems[block.id] : undefined}
            onOpenProblem={onOpenProblem}
            onLoadSourcePreview={onLoadSourcePreview}
            onStartDrag={onStartDrag}
            onStartResize={onStartResize}
            onFocusBlock={onSelectBlock}
          />
        ))}
      </div>
    </div>
  );
}
