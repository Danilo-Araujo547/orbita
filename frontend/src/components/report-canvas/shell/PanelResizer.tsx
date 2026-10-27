import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, clampPanelWidth } from "./useShellLayoutPrefs";

export interface PanelResizerProps {
  side: "left" | "right";
  width: number;
  onChangeWidth: (width: number) => void;
}

export default function PanelResizer({ side, width, onChangeWidth }: PanelResizerProps) {
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    const startX = event.clientX;
    const startW = width;
    target.setPointerCapture?.(event.pointerId);
    setDragging(true);

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const raw = side === "left" ? startW + delta : startW - delta;
      onChangeWidth(clampPanelWidth(raw, startW));
    };

    const onEnd = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 24 : 8;
    const dir = side === "left" ? 1 : -1;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onChangeWidth(clampPanelWidth(width + step * dir, width));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onChangeWidth(clampPanelWidth(width - step * dir, width));
    } else if (event.key === "Home") {
      event.preventDefault();
      onChangeWidth(PANEL_MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      onChangeWidth(PANEL_MAX_WIDTH);
    }
  };

  const label =
    side === "left" ? "Redimensionar painel esquerdo" : "Redimensionar inspetor de propriedades";

  return (
    <div
      role="separator"
      tabIndex={-1}
      aria-keyshortcuts={side === "left" ? "Alt+Shift+L" : "Alt+Shift+R"}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={PANEL_MAX_WIDTH}
      aria-valuenow={width}
      className={`cv-resizer cv-resizer-${side} ${dragging ? "is-dragging" : ""}`.trim()}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
}
