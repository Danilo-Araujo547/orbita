import type { CanvasLayout, OutputFormat } from "../model";
import { sanitizeLayoutForApi } from "../model";

export const MAX_DRAFT_BYTES = 700 * 1024; // 700 KB limit

export interface DraftPayload {
  layout: CanvasLayout;
  enabled: boolean;
  outputFormat: OutputFormat;
  timestamp: number;
}

export function getDraftStorageKey(unit: string, reportId: number, version: number): string {
  return `orbita:canvas_draft:${unit}:${reportId}:${version}`;
}

export function formatDraftTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    const d = new Date(timestamp);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
}

export function saveDraftToStorage(
  unit: string,
  reportId: number,
  version: number,
  payload: {
    layout: CanvasLayout;
    enabled: boolean;
    outputFormat: OutputFormat;
  },
): boolean {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }
  try {
    const key = getDraftStorageKey(unit, reportId, version);
    const sanitized = sanitizeLayoutForApi(payload.layout);
    const data: DraftPayload = {
      layout: sanitized,
      enabled: Boolean(payload.enabled),
      outputFormat: payload.outputFormat,
      timestamp: Date.now(),
    };
    const json = JSON.stringify(data);
    const byteLength =
      typeof Blob !== "undefined"
        ? new Blob([json]).size
        : new TextEncoder().encode(json).length;
    if (byteLength > MAX_DRAFT_BYTES) {
      return false;
    }
    window.localStorage.setItem(key, json);
    return true;
  } catch {
    return false;
  }
}

export function loadDraftFromStorage(
  unit: string,
  reportId: number,
  version: number,
): DraftPayload | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const key = getDraftStorageKey(unit, reportId, version);
    const item = window.localStorage.getItem(key);
    if (!item) return null;
    const parsed = JSON.parse(item) as DraftPayload;
    if (!parsed || !parsed.layout || !Array.isArray(parsed.layout.pages)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraftFromStorage(unit: string, reportId: number, version: number): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const key = getDraftStorageKey(unit, reportId, version);
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function isDraftDifferent(
  draft: DraftPayload,
  current: {
    layout: CanvasLayout;
    enabled: boolean;
    outputFormat: OutputFormat;
  },
): boolean {
  if (draft.enabled !== current.enabled) return true;
  if (draft.outputFormat !== current.outputFormat) return true;
  const draftSanitized = JSON.stringify(sanitizeLayoutForApi(draft.layout));
  const currentSanitized = JSON.stringify(sanitizeLayoutForApi(current.layout));
  return draftSanitized !== currentSanitized;
}
