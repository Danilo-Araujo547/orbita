import type { RefObject } from "react";
import type { PageViewProps } from "./PageView";
import PageView from "./PageView";

export interface StageProps extends PageViewProps {
  stageRef: RefObject<HTMLDivElement | null>;
}

export default function Stage({ stageRef, onClearSelection, ...pageViewProps }: StageProps) {
  return (
    <div
      ref={stageRef}
      className="rc-stage"
      style={{ gridColumn: 3, gridRow: 1 }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClearSelection();
      }}
    >
      <PageView onClearSelection={onClearSelection} {...pageViewProps} />
    </div>
  );
}
