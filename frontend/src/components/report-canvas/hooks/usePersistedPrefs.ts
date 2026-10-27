import { useCallback, useState } from "react";
import { clamp } from "../model";

export type LibraryTab = "components" | "pages" | "data" | "images";

export function readPreference(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`scv.canvas.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePreference(key: string, value: string | number | boolean): void {
  try {
    localStorage.setItem(`scv.canvas.${key}`, String(value));
  } catch {
    /* Editor remains usable without storage. */
  }
}

export function usePersistedPrefs() {
  const [leftOpen, setLeftOpen] = useState(() => readPreference("left", "true") !== "false");
  const [rightOpen, setRightOpen] = useState(() => readPreference("right", "true") !== "false");
  const [leftWidth, setLeftWidth] = useState(() =>
    clamp(Number(readPreference("leftWidth", "224")) || 224, 200, 360),
  );
  const [rightWidth, setRightWidth] = useState(() =>
    clamp(Number(readPreference("rightWidth", "280")) || 280, 240, 420),
  );
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("components");

  const closeLeftPanel = useCallback(() => {
    setLeftOpen(false);
    writePreference("left", false);
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
    setLeftWidth(value);
    writePreference("leftWidth", value);
  }, []);

  const updateRightWidth = useCallback((value: number) => {
    setRightWidth(value);
    writePreference("rightWidth", value);
  }, []);

  return {
    leftOpen,
    rightOpen,
    leftWidth,
    rightWidth,
    libraryTab,
    closeLeftPanel,
    selectLibrary,
    toggleRightPanel,
    openRightPanel,
    updateLeftWidth,
    updateRightWidth,
  };
}
