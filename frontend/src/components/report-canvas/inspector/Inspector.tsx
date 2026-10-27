import type { CanvasBlock, CanvasPage } from "../model";
import type { BlockInspectorProps } from "./BlockInspector";
import BlockInspector from "./BlockInspector";
import PageInspector from "./PageInspector";

export interface InspectorProps extends Omit<BlockInspectorProps, "block"> {
  rightOpen: boolean;
  selectedBlock: CanvasBlock | null;
  activePage: CanvasPage | undefined;
  onSelectBlock: (blockId: string) => void;
}

export default function Inspector({
  rightOpen,
  selectedBlock,
  activePage,
  onSelectBlock,
  onRemoveBlock,
  ...blockInspectorProps
}: InspectorProps) {
  return (
    <aside
      style={{ gridColumn: 4, gridRow: 1 }}
      hidden={!rightOpen}
      className="rc-sidebar rc-sidebar-right"
      aria-label="Inspetor de propriedades"
    >
      {selectedBlock ? (
        <BlockInspector
          block={selectedBlock}
          onRemoveBlock={onRemoveBlock}
          {...blockInspectorProps}
        />
      ) : (
        <PageInspector
          activePage={activePage}
          onSelectBlock={onSelectBlock}
          onRemoveBlock={onRemoveBlock}
        />
      )}
    </aside>
  );
}
