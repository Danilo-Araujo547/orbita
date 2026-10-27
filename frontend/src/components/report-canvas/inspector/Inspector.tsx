import { useCallback, useEffect, useRef } from "react";
import "../inspector.css";
import type {
  BlockType,
  CanvasBlock,
  CanvasPage,
  CanvasPageConfig,
  OutputFormat,
  XlsxMode,
} from "../model";
import type { BlockInspectorProps, InspectorTab } from "./BlockInspector";
import BlockInspector from "./BlockInspector";
import PageInspector from "./PageInspector";

export interface InspectorProps extends Omit<BlockInspectorProps, "block"> {
  rightOpen: boolean;
  selectedBlock: CanvasBlock | null;
  activePage: CanvasPage | undefined;
  outputFormat?: OutputFormat;
  xlsxMode?: XlsxMode;
  onSelectBlock: (blockId: string) => void;
  onUpdatePageConfig?: (patch: Partial<CanvasPageConfig>, coalesceKey?: string) => void;
  onRenameActivePage?: (name: string) => void;
  onChangeOutputFormat?: (format: OutputFormat) => void;
  onChangeXlsxMode?: (mode: XlsxMode) => void;
}

export default function Inspector({
  rightOpen,
  selectedBlock,
  activePage,
  inspectorTab,
  onChangeTab,
  onSelectBlock,
  onRemoveBlock,
  outputFormat,
  xlsxMode,
  onUpdatePageConfig,
  onRenameActivePage,
  onChangeOutputFormat,
  onChangeXlsxMode,
  ...blockInspectorProps
}: InspectorProps) {
  // Persist active tab across selections of the same block type
  const tabByTypeRef = useRef<Partial<Record<BlockType, InspectorTab>>>({});
  const lastBlockIdRef = useRef<string | null>(null);

  const selectedId = selectedBlock?.id || null;
  const selectedType = selectedBlock?.type || null;

  useEffect(() => {
    if (!selectedId || !selectedType) {
      lastBlockIdRef.current = null;
      return;
    }
    if (lastBlockIdRef.current !== selectedId) {
      lastBlockIdRef.current = selectedId;
      const remembered = tabByTypeRef.current[selectedType];
      if (remembered && remembered !== inspectorTab) {
        onChangeTab(remembered);
      } else if (!remembered) {
        const safeTab: InspectorTab =
          selectedType === "image" && inspectorTab === "data" ? "content" : inspectorTab;
        tabByTypeRef.current[selectedType] = safeTab;
        if (safeTab !== inspectorTab) {
          onChangeTab(safeTab);
        }
      }
    }
  }, [inspectorTab, onChangeTab, selectedId, selectedType]);

  const handleChangeTab = useCallback(
    (nextTab: InspectorTab) => {
      if (selectedType) {
        tabByTypeRef.current[selectedType] = nextTab;
      }
      onChangeTab(nextTab);
    },
    [onChangeTab, selectedType],
  );

  return (
    <aside
      style={{ gridColumn: 4, gridRow: 1 }}
      hidden={!rightOpen}
      className="cv-inspector"
      aria-label="Inspetor de propriedades"
    >
      {selectedBlock ? (
        <BlockInspector
          block={selectedBlock}
          activePage={activePage}
          inspectorTab={inspectorTab}
          onChangeTab={handleChangeTab}
          onRemoveBlock={onRemoveBlock}
          {...blockInspectorProps}
        />
      ) : (
        <PageInspector
          activePage={activePage}
          pageConfig={blockInspectorProps.pageConfig}
          layout={blockInspectorProps.layout}
          outputFormat={outputFormat}
          xlsxMode={xlsxMode}
          onSelectBlock={onSelectBlock}
          onRemoveBlock={onRemoveBlock}
          onUpdatePageConfig={onUpdatePageConfig}
          onRenameActivePage={onRenameActivePage}
          onChangeOutputFormat={onChangeOutputFormat}
          onChangeXlsxMode={onChangeXlsxMode}
        />
      )}
    </aside>
  );
}
