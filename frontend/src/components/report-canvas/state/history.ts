// Histórico genérico de desfazer/refazer (puro, sem React).
//
// Cada entrada de `past`/`future` guarda o documento, a revisão desse documento e o rótulo
// (pt-BR) da ação que liga a entrada ao estado vizinho. Assim, `past[past.length-1].label`
// é o texto de "Desfazer: …" e `future[0].label` o de "Refazer: …".

export const HISTORY_LIMIT = 100;
export const COALESCE_WINDOW_MS = 800;

export interface HistoryEntry<T> {
  doc: T;
  revision: number;
  label: string;
}

export interface HistoryState<T> {
  doc: T;
  revision: number;
  savedRevision: number;
  nextRevision: number;
  past: HistoryEntry<T>[];
  future: HistoryEntry<T>[];
  lastCoalesce: { key: string; at: number } | null;
}

export type HistoryAction<T> =
  | { type: "apply"; label: string; updater: (prev: T) => T; coalesceKey?: string; at: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "markSaved"; doc?: T }
  | { type: "replace"; doc: T };

export function createHistory<T>(doc: T): HistoryState<T> {
  return {
    doc,
    revision: 0,
    savedRevision: 0,
    nextRevision: 1,
    past: [],
    future: [],
    lastCoalesce: null,
  };
}

export function historyReducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  switch (action.type) {
    case "apply": {
      const next = action.updater(state.doc);
      if (Object.is(next, state.doc)) return state;
      const key = action.coalesceKey;
      const coalesce =
        !!key &&
        state.lastCoalesce !== null &&
        state.lastCoalesce.key === key &&
        action.at >= state.lastCoalesce.at &&
        action.at - state.lastCoalesce.at < COALESCE_WINDOW_MS &&
        state.past.length > 0;
      const past = coalesce
        ? [
            ...state.past.slice(0, -1),
            { ...state.past[state.past.length - 1], label: action.label },
          ]
        : [...state.past, { doc: state.doc, revision: state.revision, label: action.label }].slice(
            -HISTORY_LIMIT,
          );
      return {
        ...state,
        doc: next,
        revision: state.nextRevision,
        nextRevision: state.nextRevision + 1,
        past,
        future: [],
        lastCoalesce: key ? { key, at: action.at } : null,
      };
    }
    case "undo": {
      const entry = state.past[state.past.length - 1];
      if (!entry) return state;
      return {
        ...state,
        doc: entry.doc,
        revision: entry.revision,
        past: state.past.slice(0, -1),
        future: [{ doc: state.doc, revision: state.revision, label: entry.label }, ...state.future],
        lastCoalesce: null,
      };
    }
    case "redo": {
      const entry = state.future[0];
      if (!entry) return state;
      return {
        ...state,
        doc: entry.doc,
        revision: entry.revision,
        past: [
          ...state.past,
          { doc: state.doc, revision: state.revision, label: entry.label },
        ].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        lastCoalesce: null,
      };
    }
    case "markSaved":
      // O documento salvo (normalizado pelo servidor) passa a ser o estado atual sem criar passo.
      return {
        ...state,
        doc: action.doc ?? state.doc,
        savedRevision: state.revision,
        lastCoalesce: null,
      };
    case "replace": {
      const revision = state.nextRevision;
      return {
        doc: action.doc,
        revision,
        savedRevision: revision,
        nextRevision: revision + 1,
        past: [],
        future: [],
        lastCoalesce: null,
      };
    }
    default:
      return state;
  }
}

export const isDirty = (s: HistoryState<unknown>) => s.revision !== s.savedRevision;
export const canUndo = (s: HistoryState<unknown>) => s.past.length > 0;
export const canRedo = (s: HistoryState<unknown>) => s.future.length > 0;
export const undoLabel = (s: HistoryState<unknown>) => s.past[s.past.length - 1]?.label ?? null;
export const redoLabel = (s: HistoryState<unknown>) => s.future[0]?.label ?? null;
