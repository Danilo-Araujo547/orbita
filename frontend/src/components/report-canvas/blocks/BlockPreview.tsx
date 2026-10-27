import { memo } from "react";
import type {
  CanvasAssetMeta,
  CanvasBlock,
  CanvasSource,
  CatalogSqlSource,
} from "../model";
import { BLOCK_LABELS, clamp, isDarkHex, validColor } from "../model";
import { sampleDataset } from "../sampleData";
import ChartPreview from "./ChartPreview";
import ImagePreview from "./ImagePreview";
import KpiPreview from "./KpiPreview";
import TablePreview from "./TablePreview";
import TextPreview from "./TextPreview";

export interface BlockPreviewProps {
  block: CanvasBlock;
  background: string;
  sources: CanvasSource[];
  assets: CanvasAssetMeta[];
  assetUrls: Record<string, string>;
  availableSources: CatalogSqlSource[];
  localDatasets: Map<string, { columns: string[]; rows: unknown[][] }>;
  reportName: string;
  showSampleData?: boolean;
}

function BlockPreview({
  block,
  background,
  sources,
  assets,
  assetUrls,
  availableSources,
  localDatasets,
  reportName,
  showSampleData = false,
}: BlockPreviewProps) {
  const opt = block.options || {};
  const primaryColor = validColor(opt.color, "#075b94");
  const fontSize = clamp(Number(opt.font_size) || 14, 6, 100);
  const pageDark = isDarkHex(background);
  const axisColor = pageDark ? "#9fb3c8" : "#526980";
  const gridColor = pageDark ? "rgba(255,255,255,0.14)" : "#dbe4ee";

  if (block.type === "text") {
    return (
      <TextPreview
        block={block}
        fontSize={fontSize}
        primaryColor={primaryColor}
        sources={sources}
        availableSources={availableSources}
        reportName={reportName}
        showSampleData={showSampleData}
      />
    );
  }

  if (block.type === "image") {
    return <ImagePreview block={block} assets={assets} assetUrls={assetUrls} />;
  }

  const src = sources.find((s) => s.id === block.source_id);
  if (!src) {
    return (
      <div className="rc-block-inner">
        {block.title && <div className="rc-block-title">{block.title}</div>}
        <div className="rc-sql-placeholder">
          <span className="rc-sql-badge">{BLOCK_LABELS[block.type]}</span>
          <span className="rc-sql-meta">Selecione uma fonte de dados no inspetor à direita.</span>
        </div>
      </div>
    );
  }

  const catalog =
    src.type === "report" ? availableSources.find((c) => c.id === src.report_id) : undefined;
  const local = localDatasets.get(src.id);
  const dataset =
    showSampleData && (src.type === "report" || (src.type === "goals" && !local?.rows.length))
      ? sampleDataset(block, src, catalog)
      : local || { columns: [], rows: [] };

  if (block.type === "kpi") {
    return (
      <KpiPreview
        block={block}
        source={src}
        catalog={catalog}
        dataset={dataset}
        fontSize={fontSize}
        primaryColor={primaryColor}
        showSampleData={showSampleData}
      />
    );
  }

  if (block.type === "table") {
    return (
      <TablePreview
        block={block}
        source={src}
        catalog={catalog}
        dataset={dataset}
        fontSize={fontSize}
        primaryColor={primaryColor}
        axisColor={axisColor}
        showSampleData={showSampleData}
      />
    );
  }

  return (
    <ChartPreview
      block={block}
      source={src}
      catalog={catalog}
      dataset={dataset}
      primaryColor={primaryColor}
      axisColor={axisColor}
      gridColor={gridColor}
      showSampleData={showSampleData}
    />
  );
}

// Moving a block changes its position, not its rendered contents.
export default memo(BlockPreview, (a, b) => {
  const x = a.block;
  const y = b.block;
  return (
    a.showSampleData === b.showSampleData &&
    a.background === b.background &&
    a.sources === b.sources &&
    a.assets === b.assets &&
    a.assetUrls === b.assetUrls &&
    a.availableSources === b.availableSources &&
    a.localDatasets === b.localDatasets &&
    a.reportName === b.reportName &&
    x.id === y.id &&
    x.type === y.type &&
    x.width === y.width &&
    x.height === y.height &&
    x.title === y.title &&
    x.text === y.text &&
    x.source_id === y.source_id &&
    x.asset_id === y.asset_id &&
    x.options === y.options
  );
});
