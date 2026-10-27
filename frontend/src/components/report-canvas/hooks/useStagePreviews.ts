import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSourcePreviewRequest, hashSourceSpec, isUnavailableStatus } from "../api/useSourcePreview";
import type { SourcePreviewState } from "../api/useSourcePreview";
import type { CanvasSource } from "../model";

export function useStagePreviews(reportId: number, unit: string, sources: CanvasSource[], enabled: boolean) {
  const [entries, setEntries] = useState<Record<string, { key: string; state: SourcePreviewState }>>({});
  const current = useRef({ reportId, unit, sources });
  current.current = { reportId, unit, sources };
  const pending = useRef(new Map<string, AbortController>());
  const keyFor = (source: CanvasSource) => `${unit}:${reportId}:${hashSourceSpec(source)}`;
  const states = useMemo(() => Object.fromEntries(sources.flatMap(source => {
    const entry = entries[source.id];
    return entry?.key === keyFor(source) ? [[source.id, entry.state]] : [];
  })), [entries, sources, unit, reportId]);
  const load = useCallback(async (sourceId: string, retry = false) => {
    const source = current.current.sources.find(s => s.id === sourceId);
    if (!source || source.type !== "report") return;
    const key = `${current.current.unit}:${current.current.reportId}:${hashSourceSpec(source)}`;
    if (pending.current.has(key) && !retry) return;
    pending.current.get(key)?.abort();
    const controller = new AbortController();
    pending.current.set(key, controller);
    const put = (state: SourcePreviewState) => {
      const latest = current.current.sources.find(s => s.id === sourceId);
      if (!latest || `${current.current.unit}:${current.current.reportId}:${hashSourceSpec(latest)}` !== key) return;
      if (!controller.signal.aborted) setEntries(prev => ({ ...prev, [sourceId]: {key, state} }));
    };
    put({ status: "loading", data: null, error: null, loadedAt: null });
    try {
      const data = await fetchSourcePreviewRequest(current.current.reportId, current.current.unit, source,
        source.parameters || {}, 50, controller.signal);
      put({ status: "ready", data, error: null, loadedAt: new Date() });
    } catch (err: any) {
      const unavailable = isUnavailableStatus(err?.status, err?.message);
      put({ status: unavailable ? "unavailable" : "error", data: null, loadedAt: null,
        error: unavailable ? "Prévia indisponível: o servidor não respondeu à rota de prévia" : `Prévia indisponível: ${err?.message || "falha de conexão com o servidor"}` });
    } finally { if (pending.current.get(key) === controller) pending.current.delete(key); }
  }, []);
  useEffect(() => {
    if (enabled) for (const source of sources) {
      if (source.type === "report" && !states[source.id]) void load(source.id);
    }
  }, [enabled, sources, states, load]);
  useEffect(() => () => { for (const controller of pending.current.values()) controller.abort(); }, []);
  return { states, load };
}
