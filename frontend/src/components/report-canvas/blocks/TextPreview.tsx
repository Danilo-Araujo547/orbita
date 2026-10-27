import type { CanvasBlock, CanvasSource, CatalogSqlSource } from "../model";
import { interpolateText } from "../model";
import { sampleDataset } from "../sampleData";

export interface TextPreviewProps {
  block: CanvasBlock;
  fontSize: number;
  primaryColor: string;
  sources: CanvasSource[];
  availableSources: CatalogSqlSource[];
  reportName: string;
  showSampleData: boolean;
}

export default function TextPreview({
  block,
  fontSize,
  primaryColor,
  sources,
  availableSources,
  reportName,
  showSampleData,
}: TextPreviewProps) {
  const displayText = (value: string) =>
    interpolateText(value, reportName).replace(
      /\{\{\s*([\w-]+)\.([\w-]+)\s*\}\}/g,
      (original, id: string, column: string) => {
        if (!showSampleData) return original;
        const source = sources.find((s) => s.id === id);
        if (!source || source.type !== "report") return original;
        const data = sampleDataset(
          { ...block, type: "table", options: { columns: [column] } },
          source,
          availableSources.find((c) => c.id === source.report_id),
        );
        return String(data.rows[0]?.[data.columns.indexOf(column)] ?? original);
      },
    );

  const value = [block.title, block.text]
    .filter(Boolean)
    .map((v) => displayText(v!))
    .join("\n");

  return (
    <div className="rc-block-inner">
      <div
        className="rc-block-text-body"
        style={{ fontSize: `${fontSize}px`, color: primaryColor }}
      >
        {value || "Edite o texto no painel direito"}
      </div>
    </div>
  );
}
