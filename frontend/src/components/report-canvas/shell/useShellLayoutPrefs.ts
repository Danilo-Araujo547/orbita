import { useCallback, useState } from "react";
import { clamp } from "../model";
import type { LibraryTab } from "../hooks/usePersistedPrefs";
import { readPreference, writePreference } from "../hooks/usePersistedPrefs";

export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 400;
export const DEFAULT_LEFT_WIDTH = 288;
export const DEFAULT_RIGHT_WIDTH = 320;

export function clampPanelWidth(value: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.round(clamp(num, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH));
}

export function useShellLayoutPrefs() {
  const [leftOpen, setLeftOpen] = useState(() => readPreference("left", "true") !== "false");
  const [rightOpen, setRightOpen] = useState(() => readPreference("right", "true") !== "false");
  const [leftWidth, setLeftWidth] = useState(() =>
    clampPanelWidth(
      Number(readPreference("leftWidth", String(DEFAULT_LEFT_WIDTH))),
      DEFAULT_LEFT_WIDTH,
    ),
  );
  const [rightWidth, setRightWidth] = useState(() =>
    clampPanelWidth(
      Number(readPreference("rightWidth", String(DEFAULT_RIGHT_WIDTH))),
      DEFAULT_RIGHT_WIDTH,
    ),
  );
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("components");

  const closeLeftPanel = useCallback(() => {
    setLeftOpen(false);
    writePreference("left", false);
  }, []);

  const toggleLeftPanel = useCallback(() => {
    setLeftOpen((prev) => {
      const next = !prev;
      writePreference("left", next);
      return next;
    });
  }, []);

  const openLeftPanel = useCallback((tab?: LibraryTab) => {
    if (tab) setLibraryTab(tab);
    setLeftOpen(true);
    writePreference("left", true);
  }, []);

  const selectLibrary = useCallback(
    (tab: LibraryTab) => {
      if (leftOpen && libraryTab === tab) {
        setLeftOpen(false);
        writePreference("left", false);
      } else {
        setLibraryTab(tab);
        setLeftOpen(true);
        writePreference("left", true);
      }
    },
    [leftOpen, libraryTab],
  );

  const toggleRightPanel = useCallback(() => {
    setRightOpen((prev) => {
      const next = !prev;
      writePreference("right", next);
      return next;
    });
  }, []);

  const openRightPanel = useCallback(() => {
    setRightOpen(true);
    writePreference("right", true);
  }, []);

  const updateLeftWidth = useCallback((value: number) => {
    const next = clampPanelWidth(value, DEFAULT_LEFT_WIDTH);
    setLeftWidth(next);
    writePreference("leftWidth", next);
  }, []);

  const updateRightWidth = useCallback((value: number) => {
    const next = clampPanelWidth(value, DEFAULT_RIGHT_WIDTH);
    setRightWidth(next);
    writePreference("rightWidth", next);
  }, []);

  return {
    leftOpen,
    rightOpen,
    leftWidth,
    rightWidth,
    libraryTab,
    closeLeftPanel,
    toggleLeftPanel,
    openLeftPanel,
    selectLibrary,
    toggleRightPanel,
    openRightPanel,
    updateLeftWidth,
    updateRightWidth,
  };
}
