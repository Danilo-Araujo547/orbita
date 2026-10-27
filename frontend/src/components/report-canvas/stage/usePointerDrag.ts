import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { CanvasBlock, DragSession } from "../model";
import type { ResizeHandle, SnapGuide } from "./geometry";
import { computeResizeSnapping, computeSnapping } from "./geometry";

export interface ActiveDragInfo {
  kind: "move" | "resize";
  handle?: ResizeHandle;
  blockId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  guides: SnapGuide[];
  tooltip: string;
}

export function usePointerDrag({
  zoom,
  pageWidth,
  pageHeight,
  columns = 24,
  blocks = [],
  onSelectBlock,
  onApplyBlockDrag,
}: {
  zoom: number;
  pageWidth: number;
  pageHeight: number;
  columns?: number;
  blocks?: CanvasBlock[];
  onSelectBlock: (blockId: string) => void;
  onApplyBlockDrag: (
    blockId: string,
    label: string,
    coalesceKey: string,
    updater: (b: CanvasBlock) => CanvasBlock,
  ) => void;
}) {
  const [dragSession, setDragSession] = useState<
    | {
        kind: "move";
        blockId: string;
        startClientX: number;
        startClientY: number;
        startX: number;
        startY: number;
        width: number;
        height: number;
      }
    | {
        kind: "resize";
        handle: ResizeHandle;
        blockId: string;
        startClientX: number;
        startClientY: number;
        startX: number;
        startY: number;
        startW: number;
        startH: number;
      }
    | null
  >(null);

  const [activeDrag, setActiveDrag] = useState<ActiveDragInfo | null>(null);
  const latestDragRef = useRef<ActiveDragInfo | null>(null);

  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const startBlockDrag = useCallback(
    (e: ReactPointerEvent, block: CanvasBlock) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onSelectBlock(block.id);
      const session = {
        kind: "move" as const,
        blockId: block.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: block.x,
        startY: block.y,
        width: block.width,
        height: block.height,
      };
      setDragSession(session);
      const initial: ActiveDragInfo = {
        kind: "move",
        blockId: block.id,
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        guides: [],
        tooltip: `${Math.round(block.x)}, ${Math.round(block.y)}`,
      };
      latestDragRef.current = initial;
      setActiveDrag(initial);
    },
    [onSelectBlock],
  );

  const startBlockResize = useCallback(
    (e: ReactPointerEvent, block: CanvasBlock, handle: ResizeHandle) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onSelectBlock(block.id);
      const session = {
        kind: "resize" as const,
        handle,
        blockId: block.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: block.x,
        startY: block.y,
        startW: block.width,
        startH: block.height,
      };
      setDragSession(session);
      const initial: ActiveDragInfo = {
        kind: "resize",
        handle,
        blockId: block.id,
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        guides: [],
        tooltip: `${Math.round(block.width)}×${Math.round(block.height)}`,
      };
      latestDragRef.current = initial;
      setActiveDrag(initial);
    },
    [onSelectBlock],
  );

  useEffect(() => {
    if (!dragSession) return;
    const session = dragSession;
    const otherBlocks = blocksRef.current.filter((b) => b.id !== session.blockId);

    function onPointerMove(e: PointerEvent) {
      const dx = (e.clientX - session.startClientX) / zoom;
      const dy = (e.clientY - session.startClientY) / zoom;

      if (session.kind === "move") {
        const rawRect = {
          x: session.startX + dx,
          y: session.startY + dy,
          width: session.width,
          height: session.height,
        };
        const snap = computeSnapping({
          rect: rawRect,
          otherBlocks,
          pageWidth,
          pageHeight,
          columns,
          zoom,
          disabled: e.altKey,
        });

        const nextInfo: ActiveDragInfo = {
          kind: "move",
          blockId: session.blockId,
          x: snap.x,
          y: snap.y,
          width: session.width,
          height: session.height,
          guides: snap.guides,
          tooltip: `${Math.round(snap.x)}, ${Math.round(snap.y)}`,
        };
        latestDragRef.current = nextInfo;
        setActiveDrag(nextInfo);
      } else {
        // resize
        let rawX = session.startX;
        let rawY = session.startY;
        let rawW = session.startW;
        let rawH = session.startH;

        if (session.handle === "e" || session.handle === "se" || session.handle === "ne") {
          rawW = session.startW + dx;
        }
        if (session.handle === "w" || session.handle === "sw" || session.handle === "nw") {
          rawX = session.startX + dx;
          rawW = session.startW - dx;
        }
        if (session.handle === "s" || session.handle === "se" || session.handle === "sw") {
          rawH = session.startH + dy;
        }
        if (session.handle === "n" || session.handle === "nw" || session.handle === "ne") {
          rawY = session.startY + dy;
          rawH = session.startH - dy;
        }

        const snap = computeResizeSnapping({
          handle: session.handle,
          rect: { x: rawX, y: rawY, width: rawW, height: rawH },
          otherBlocks,
          pageWidth,
          pageHeight,
          columns,
          zoom,
          disabled: e.altKey,
        });

        const nextInfo: ActiveDragInfo = {
          kind: "resize",
          handle: session.handle,
          blockId: session.blockId,
          x: snap.x,
          y: snap.y,
          width: snap.width,
          height: snap.height,
          guides: snap.guides,
          tooltip: `${Math.round(snap.width)}×${Math.round(snap.height)}`,
        };
        latestDragRef.current = nextInfo;
        setActiveDrag(nextInfo);
      }
    }

    function onPointerUp() {
      const finalInfo = latestDragRef.current;
      if (finalInfo) {
        const { kind, blockId, x, y, width, height } = finalInfo;
        const initialX = session.startX;
        const initialY = session.startY;
        const initialW = session.kind === "move" ? session.width : session.startW;
        const initialH = session.kind === "move" ? session.height : session.startH;

        if (x !== initialX || y !== initialY || width !== initialW || height !== initialH) {
          const label = kind === "move" ? "Mover bloco" : "Redimensionar bloco";
          const coalesceKey = `${kind}:${blockId}`;
          onApplyBlockDrag(blockId, label, coalesceKey, (b) => ({
            ...b,
            x,
            y,
            width,
            height,
          }));
        }
      }
      latestDragRef.current = null;
      setDragSession(null);
      setActiveDrag(null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragSession, zoom, pageWidth, pageHeight, columns, onApplyBlockDrag]);

  // Backward-compatible dragState object for components checking draggingBlockId
  const dragState: DragSession | null = dragSession
    ? dragSession.kind === "move"
      ? {
          kind: "move",
          blockId: dragSession.blockId,
          startClientX: dragSession.startClientX,
          startClientY: dragSession.startClientY,
          startX: dragSession.startX,
          startY: dragSession.startY,
          width: dragSession.width,
          height: dragSession.height,
        }
      : {
          kind: "resize",
          handle:
            dragSession.handle === "se" || dragSession.handle === "e" || dragSession.handle === "s"
              ? dragSession.handle
              : "se",
          blockId: dragSession.blockId,
          startClientX: dragSession.startClientX,
          startClientY: dragSession.startClientY,
          startX: dragSession.startX,
          startY: dragSession.startY,
          startW: dragSession.startW,
          startH: dragSession.startH,
        }
    : null;

  return {
    dragState,
    activeDrag,
    startBlockDrag,
    startBlockResize,
  };
}
