import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject, WheelEvent as ReactWheelEvent } from "react";
import type { CanvasPage } from "../model";
import { clamp, round2 } from "../model";
import type { PageViewProps } from "./PageView";
import PageView from "./PageView";

export interface StageProps extends Omit<PageViewProps, "blocks" | "pageName" | "pageIndex"> {
  stageRef: RefObject<HTMLDivElement | null>;
  pages?: CanvasPage[];
  activePageId?: string;
  onSelectPage?: (pageId: string) => void;
  blocks?: PageViewProps["blocks"];
  onChangeZoom?: (updater: (prev: number) => number) => void;
}

export default function Stage({
  stageRef,
  pages,
  activePageId,
  onSelectPage,
  blocks,
  onChangeZoom,
  onClearSelection,
  ...pageViewProps
}: StageProps) {
  const isSpaceDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; scrollLeft: number; scrollTop: number }>({
    clientX: 0,
    clientY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space" && !e.repeat) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
        ) {
          return;
        }
        isSpaceDownRef.current = true;
        if (stageRef.current) {
          stageRef.current.classList.add("is-panning");
        }
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") {
        isSpaceDownRef.current = false;
        if (stageRef.current) {
          stageRef.current.classList.remove("is-panning");
          stageRef.current.classList.remove("is-panning-active");
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [stageRef]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isSpaceDownRef.current && stageRef.current) {
      isPanningRef.current = true;
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        scrollLeft: stageRef.current.scrollLeft,
        scrollTop: stageRef.current.scrollTop,
      };
      stageRef.current.classList.add("is-panning-active");
      e.preventDefault();
      return;
    }
    if (e.target === e.currentTarget) {
      onClearSelection();
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isPanningRef.current && stageRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      stageRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      stageRef.current.scrollTop = panStartRef.current.scrollTop - dy;
      e.preventDefault();
    }
  };

  const handlePointerUp = () => {
    if (isPanningRef.current && stageRef.current) {
      isPanningRef.current = false;
      stageRef.current.classList.remove("is-panning-active");
    }
  };

  const handleWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey) {
      e.preventDefault();
      if (onChangeZoom) {
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        onChangeZoom((z) => round2(clamp(z + delta, 0.25, 2)));
      }
    }
  };

  const renderPages = pages && pages.length > 0;

  return (
    <div
      ref={stageRef}
      className="cv-stage"
      tabIndex={-1}
      style={{ gridColumn: 3, gridRow: 1 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      {renderPages ? (
        pages.map((p, idx) => {
          const isActive = p.id === activePageId;
          return (
            <div
              key={p.id}
              className="cv-page-wrapper"
              onClick={() => {
                if (!isActive) onSelectPage?.(p.id);
              }}
            >
              <button
                type="button"
                className={`cv-page-header ${isActive ? "is-active" : ""}`.trim()}
                aria-label={`Página ${idx + 1} de ${pages.length} · ${p.name || `Página ${idx + 1}`}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectPage?.(p.id);
                }}
              >
                Página {idx + 1} de {pages.length} · {p.name || `Página ${idx + 1}`}
              </button>
              <PageView
                pageName={p.name || `Página ${idx + 1}`}
                pageIndex={idx}
                blocks={p.blocks}
                onClearSelection={onClearSelection}
                {...pageViewProps}
              />
            </div>
          );
        })
      ) : (
        <PageView
          blocks={blocks || []}
          onClearSelection={onClearSelection}
          {...pageViewProps}
        />
      )}
    </div>
  );
}
