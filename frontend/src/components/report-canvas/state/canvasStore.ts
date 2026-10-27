import { useCallback, useReducer } from "react";
import type { CanvasLayout } from "../model";
import { createDefaultLayout } from "../model";
import type { HistoryEntry, HistoryState } from "./history";
import { createHistory, historyReducer } from "./history";

export interface CanvasHistoryStep {
  layout: CanvasLayout;
  revision: number;
  label: string;
}

export interface CanvasStoreState {
  layout: CanvasLayout;
  past: CanvasHistoryStep[];
  future: CanvasHistoryStep[];
  savedRevision: number;
  revision: number;
  nextRevision: number;
  lastCoalesce: { key: string; at: number } | null;
}

export interface ApplyLayoutOptions {
  coalesceKey?: string;
  at?: number;
}

export type CanvasStoreAction =
  | {
      type: "apply";
      label: string;
      updater: (prev: CanvasLayout) => CanvasLayout;
      coalesceKey?: string;
      at?: number;
    }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "markSaved"; layout?: CanvasLayout }
  | { type: "replace"; layout: CanvasLayout };

function toHistoryEntries(steps: CanvasHistoryStep[]): HistoryEntry<CanvasLayout>[] {
  return steps.map((s) => ({ doc: s.layout, revision: s.revision, label: s.label }));
}

function fromHistoryEntries(entries: HistoryEntry<CanvasLayout>[]): CanvasHistoryStep[] {
  return entries.map((e) => ({ layout: e.doc, revision: e.revision, label: e.label }));
}

function toHistoryState(state: CanvasStoreState): HistoryState<CanvasLayout> {
  return {
    doc: state.layout,
    revision: state.revision,
    savedRevision: state.savedRevision,
    nextRevision: state.nextRevision,
    past: toHistoryEntries(state.past),
    future: toHistoryEntries(state.future),
    lastCoalesce: state.lastCoalesce,
  };
}

function fromHistoryState(hist: HistoryState<CanvasLayout>): CanvasStoreState {
  return {
    layout: hist.doc,
    revision: hist.revision,
    savedRevision: hist.savedRevision,
    nextRevision: hist.nextRevision,
    past: fromHistoryEntries(hist.past),
    future: fromHistoryEntries(hist.future),
    lastCoalesce: hist.lastCoalesce,
  };
}

export function createCanvasStoreState(initialLayout?: CanvasLayout): CanvasStoreState {
  return fromHistoryState(createHistory(initialLayout ?? createDefaultLayout()));
}

export function canvasStoreReducer(
  state: CanvasStoreState,
  action: CanvasStoreAction,
): CanvasStoreState {
  const prevHist = toHistoryState(state);
  const nextHist =
    action.type === "apply"
      ? historyReducer<CanvasLayout>(prevHist, {
          type: "apply",
          label: action.label,
          updater: action.updater,
          coalesceKey: action.coalesceKey,
          at: action.at ?? Date.now(),
        })
      : action.type === "markSaved"
        ? historyReducer<CanvasLayout>(prevHist, { type: "markSaved", doc: action.layout })
        : action.type === "replace"
          ? historyReducer<CanvasLayout>(prevHist, { type: "replace", doc: action.layout })
          : historyReducer<CanvasLayout>(prevHist, action);

  if (nextHist === prevHist) return state;
  return fromHistoryState(nextHist);
}

export const canvasActions = {
  apply: (
    label: string,
    updater: (prev: CanvasLayout) => CanvasLayout,
    options?: ApplyLayoutOptions,
  ): CanvasStoreAction => ({
    type: "apply",
    label,
    updater,
    coalesceKey: options?.coalesceKey,
    at: options?.at,
  }),
  undo: (): CanvasStoreAction => ({ type: "undo" }),
  redo: (): CanvasStoreAction => ({ type: "redo" }),
  markSaved: (layout?: CanvasLayout): CanvasStoreAction => ({ type: "markSaved", layout }),
  replace: (layout: CanvasLayout): CanvasStoreAction => ({ type: "replace", layout }),
};

export const isCanvasDirty = (s: CanvasStoreState): boolean => s.revision !== s.savedRevision;
export const canUndoCanvas = (s: CanvasStoreState): boolean => s.past.length > 0;
export const canRedoCanvas = (s: CanvasStoreState): boolean => s.future.length > 0;
export const getUndoLabel = (s: CanvasStoreState): string | null =>
  s.past[s.past.length - 1]?.label ?? null;
export const getRedoLabel = (s: CanvasStoreState): string | null => s.future[0]?.label ?? null;

export function useCanvasStore(initialLayout?: CanvasLayout) {
  const [state, dispatch] = useReducer(
    canvasStoreReducer,
    initialLayout,
    createCanvasStoreState,
  );

  const apply = useCallback(
    (
      label: string,
      updater: (prev: CanvasLayout) => CanvasLayout,
      options?: ApplyLayoutOptions,
    ) => {
      dispatch(canvasActions.apply(label, updater, options));
    },
    [],
  );

  const undo = useCallback(() => {
    dispatch(canvasActions.undo());
  }, []);

  const redo = useCallback(() => {
    dispatch(canvasActions.redo());
  }, []);

  const markSaved = useCallback((layout?: CanvasLayout) => {
    dispatch(canvasActions.markSaved(layout));
  }, []);

  const replace = useCallback((layout: CanvasLayout) => {
    dispatch(canvasActions.replace(layout));
  }, []);

  return {
    state,
    layout: state.layout,
    dirty: isCanvasDirty(state),
    canUndo: canUndoCanvas(state),
    canRedo: canRedoCanvas(state),
    undoLabel: getUndoLabel(state),
    redoLabel: getRedoLabel(state),
    apply,
    undo,
    redo,
    markSaved,
    replace,
    dispatch,
  };
}

export type CanvasStore = ReturnType<typeof useCanvasStore>;
