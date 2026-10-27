import { useCallback, useEffect, useRef, useState } from "react";
import { query, request } from "../../../api";
import type { CanvasSource, ColumnInfo, SourcePreview } from "../model";
import { isParameterBinding } from "../model";

export type SourcePreviewStatus = "idle" | "loading" | "ready" | "error" | "unavailable";

export interface SourcePreviewState {
  status: SourcePreviewStatus;
  data: SourcePreview | null;
  error: string | null;
  errorCode?: string;
  loadedAt: Date | null;
}

export interface UseSourcePreviewOptions {
  reportId?: number;
  unit?: string;
  source?: CanvasSource | null;
  parameters?: Record<string, unknown>;
  limit?: number;
  autoLoad?: boolean;
}

// In-memory cache by specification hash
const previewCache = new Map<string, SourcePreview>();

export function hashSourceSpec(
  source: CanvasSource | null | undefined,
  parameters: Record<string, unknown> = {},
  limit = 50,
): string {
  if (!source) return "null";
  const sortedParams = Object.keys(parameters)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = parameters[key];
      return acc;
    }, {});
  return JSON.stringify({
    source,
    parameters: sortedParams,
    limit,
  });
}

export function clearSourcePreviewCache(): void {
  previewCache.clear();
}

export function getCachedSourcePreview(
  source: CanvasSource | null | undefined,
  parameters: Record<string, unknown> = {},
  limit = 50,
): SourcePreview | undefined {
  const key = hashSourceSpec(source, parameters, limit);
  return previewCache.get(key);
}

export function setCachedSourcePreview(
  source: CanvasSource,
  data: SourcePreview,
  parameters: Record<string, unknown> = {},
  limit = 50,
): void {
  const key = hashSourceSpec(source, parameters, limit);
  previewCache.set(key, data);
}

export function isUnavailableStatus(status: number | string | undefined, message?: string): boolean {
  if (status === 404 || status === 405) return true;
  if (!message) return false;
  return /404|405|not found|endpoint n[ãa]o encontrad|recurso n[ãa]o encontrad|indispon[íi]vel nesta vers[ãa]o|m[ée]todo n[ãa]o permitido/i.test(
    message,
  );
}

export function findMissingRequiredParameter(
  parameterSchema: Record<string, any> | undefined,
  parameters: Record<string, unknown> = {},
): { name: string; label: string } | null {
  if (!parameterSchema) return null;
  for (const [name, rawSpec] of Object.entries(parameterSchema)) {
    const spec = (typeof rawSpec === "string" ? { type: rawSpec } : rawSpec || {}) as Record<
      string,
      any
    >;
    if (spec.required !== false && spec.default == null) {
      const val = parameters[name];
      const isMissing =
        val === undefined ||
        val === null ||
        (typeof val === "string" && val.trim() === "") ||
        (typeof val === "object" && !isParameterBinding(val) && Object.keys(val).length === 0);
      if (isMissing) {
        const key = name.toLowerCase().replace(/^wpa_/, "");
        const fallback = key.replaceAll("_", " ");
        const label = spec.label || fallback.charAt(0).toUpperCase() + fallback.slice(1);
        return { name, label };
      }
    }
  }
  return null;
}

export async function fetchSourcePreviewRequest(
  reportId: number,
  unit: string,
  source: CanvasSource,
  parameters: Record<string, unknown> = {},
  limit = 50,
  signal?: AbortSignal,
): Promise<SourcePreview> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const url = query(`reports/${reportId}/canvas-source-preview`, { unit });
  const reqPromise = request<SourcePreview>(url, "POST", {
    source,
    parameters,
    limit,
  });

  const res = signal
    ? await Promise.race([
        reqPromise,
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true,
          });
        }),
      ])
    : await reqPromise;

  const columns: ColumnInfo[] = Array.isArray(res.columns)
    ? res.columns.map((c: any) => ({
        name: String(c.name || ""),
        type: c.type || "unknown",
        looks_like: c.looks_like,
        nullable: Boolean(c.nullable),
        null_count: typeof c.null_count === "number" ? c.null_count : 0,
        sample: Array.isArray(c.sample) ? c.sample.map(String) : [],
      }))
    : [];

  const preview: SourcePreview = {
    columns,
    rows: Array.isArray(res.rows) ? res.rows : [],
    total_rows: typeof res.total_rows === "number" ? res.total_rows : (res.rows?.length || 0),
    truncated: Boolean(res.truncated),
    elapsed_ms: res.elapsed_ms,
    loaded_at: new Date().toISOString(),
  };

  return preview;
}

export function useSourcePreview(options: UseSourcePreviewOptions = {}) {
  const { reportId, unit, source, parameters = {}, limit = 50, autoLoad = false } = options;

  const [state, setState] = useState<SourcePreviewState>(() => {
    const cached = getCachedSourcePreview(source, parameters, limit);
    if (cached) {
      return {
        status: "ready",
        data: cached,
        error: null,
        loadedAt: cached.loaded_at ? new Date(cached.loaded_at) : new Date(),
      };
    }
    return {
      status: "idle",
      data: null,
      error: null,
      loadedAt: null,
    };
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadPreview = useCallback(
    async (
      sourceOverride?: CanvasSource,
      paramsOverride?: Record<string, unknown>,
      optionsOverride?: { bypassCache?: boolean; limit?: number },
    ): Promise<SourcePreview | null> => {
      const src = sourceOverride || source;
      const params = paramsOverride || parameters;
      const lim = optionsOverride?.limit ?? limit;

      if (!src) {
        setState({
          status: "idle",
          data: null,
          error: "Nenhuma fonte especificada.",
          loadedAt: null,
        });
        return null;
      }

      if (!reportId || !unit) {
        setState({
          status: "error",
          data: null,
          error: "Relatório ou unidade não informados.",
          loadedAt: null,
        });
        return null;
      }

      // Check cache first
      if (!optionsOverride?.bypassCache) {
        const cached = getCachedSourcePreview(src, params, lim);
        if (cached) {
          setState({
            status: "ready",
            data: cached,
            error: null,
            loadedAt: cached.loaded_at ? new Date(cached.loaded_at) : new Date(),
          });
          return cached;
        }
      }

      // Abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setState((prev) => ({
        ...prev,
        status: "loading",
        error: null,
      }));

      try {
        const result = await fetchSourcePreviewRequest(
          reportId,
          unit,
          src,
          params,
          lim,
          controller.signal,
        );

        setCachedSourcePreview(src, result, params, lim);

        setState({
          status: "ready",
          data: result,
          error: null,
          loadedAt: new Date(),
        });
        return result;
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === "AbortError") {
          return null;
        }

        const msg = err?.message || String(err || "Erro ao carregar prévia.");
        const status = err?.status || err?.response?.status;

        if (isUnavailableStatus(status, msg)) {
          setState({
            status: "unavailable",
            data: null,
            error: "Prévia de dados indisponível nesta versão do servidor",
            loadedAt: null,
          });
        } else {
          setState({
            status: "error",
            data: null,
            error: msg,
            errorCode: err?.code,
            loadedAt: null,
          });
        }
        return null;
      }
    },
    [limit, parameters, reportId, source, unit],
  );

  const clearPreview = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setState({
      status: "idle",
      data: null,
      error: null,
      loadedAt: null,
    });
  }, []);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (autoLoad && source && reportId && unit && state.status === "idle") {
      void loadPreview();
    }
  }, [autoLoad, loadPreview, reportId, source, state.status, unit]);

  return {
    ...state,
    loadPreview,
    clearPreview,
    isUnavailable: state.status === "unavailable",
    isLoading: state.status === "loading",
    isReady: state.status === "ready",
  };
}
