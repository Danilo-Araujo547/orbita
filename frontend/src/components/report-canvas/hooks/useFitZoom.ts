import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "../model";

export interface UseFitZoomParams {
  loading: boolean;
  pageWidth: number;
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
}

export function useFitZoom({
  loading,
  pageWidth,
  leftOpen,
  rightOpen,
  leftWidth,
  rightWidth,
}: UseFitZoomParams) {
  const [zoom, setZoom] = useState(0.85);
  const stageRef = useRef<HTMLDivElement>(null);
  const pageWidthRef = useRef(pageWidth);
  pageWidthRef.current = pageWidth;

  const fitToWidth = useCallback((targetPageWidth?: number) => {
    const el = stageRef.current;
    if (!el) return;
    const pw = targetPageWidth ?? pageWidthRef.current;
    const available = Math.max(200, el.clientWidth - 64);
    const computed = clamp(Math.floor((available / pw) * 100) / 100, 0.25, 1.5);
    setZoom(computed);
  }, []);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(() => fitToWidth());
    return () => cancelAnimationFrame(frame);
  }, [loading, leftOpen, rightOpen, leftWidth, rightWidth, fitToWidth]);

  useEffect(() => {
    const stage = stageRef.current;
    if (loading || !stage || typeof ResizeObserver === "undefined") return;
    let lastWidth = stage.clientWidth;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? stage.clientWidth;
      if (Math.abs(width - lastWidth) > 1) {
        lastWidth = width;
        fitToWidth();
      }
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [loading, fitToWidth]);

  return { zoom, setZoom, stageRef, fitToWidth };
}
