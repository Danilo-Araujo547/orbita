import { useCallback, useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { CanvasBlock, DragSession } from "../model";
import { computePointerDragUpdater } from "./geometry";

export function usePointerDrag({
  zoom,
  pageWidth,
  pageHeight,
  onSelectBlock,
  onApplyBlockDrag,
}: {
  zoom: number;
  pageWidth: number;
  pageHeight: number;
  onSelectBlock: (blockId: string) => void;
  onApplyBlockDrag: (
    blockId: string,
    label: string,
    coalesceKey: string,
    updater: (b: CanvasBlock) => CanvasBlock,
  ) => void;
}) {
  const [dragState, setDragState] = useState<DragSession | null>(null);

  const startBlockDrag = useCallback(
    (e: ReactPointerEvent, block: CanvasBlock) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onSelectBlock(block.id);
      setDragState({
        kind: "move",
        blockId: block.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: block.x,
        startY: block.y,
        width: block.width,
        height: block.height,
      });
    },
    [onSelectBlock],
  );

  const startBlockResize = useCallback(
    (e: ReactPointerEvent, block: CanvasBlock, handle: "se" | "e" | "s") => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onSelectBlock(block.id);
      setDragState({
        kind: "resize",
        handle,
        blockId: block.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: block.x,
        startY: block.y,
        startW: block.width,
        startH: block.height,
      });
    },
    [onSelectBlock],
  );

  useEffect(() => {
    if (!dragState) return;
    const currentDrag = dragState;
    function onPointerMove(e: PointerEvent) {
      const updater = computePointerDragUpdater(
        currentDrag,
        e.clientX,
        e.clientY,
        zoom,
        pageWidth,
        pageHeight,
      );
      const label = currentDrag.kind === "move" ? "Mover bloco" : "Redimensionar bloco";
      const coalesceKey = `${currentDrag.kind}:${currentDrag.blockId}`;
      onApplyBlockDrag(currentDrag.blockId, label, coalesceKey, updater);
    }
    function onPointerUp() {
      setDragState(null);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragState, zoom, pageWidth, pageHeight, onApplyBlockDrag]);

  return { dragState, startBlockDrag, startBlockResize };
}
