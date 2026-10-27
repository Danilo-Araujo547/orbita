import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSourcePreviewRequest, hashSourceSpec } from "../api/useSourcePreview";
import type { SourcePreviewState } from "../api/useSourcePreview";
import type { CanvasSource } from "../model";
import { isParameterBinding } from "../model";
import { query, request } from "../../../api";
import { testParameters, displayParameter } from "../parameters";
import type { TestParameter } from "../parameters";

export interface StagePreviewState extends SourcePreviewState {
  fields?: TestParameter[];
  values?: Record<string, string>;
}

export function previewParameters(source: CanvasSource, schema: Record<string, unknown>, ownerSchema: Record<string, any> = {}) {
  const fields = testParameters(schema);
  const values: Record<string,string> = {};
  if (source.type !== "report") return {fields, values};
  for (const field of fields) {
    const configured = source.parameters?.[field.name];
    const bound = isParameterBinding(configured);
    const value = bound ? ownerSchema[configured.parameter]?.default : configured;
    values[field.name] = displayParameter(value ?? field.default, field.type);
    if (bound && value == null && field.default == null) field.required = true;
  }
  for (const [name, value] of Object.entries(source.parameters || {})) {
    if (isParameterBinding(value) && !fields.some(f => f.name === name)) {
      const field = testParameters({[name]: {...ownerSchema[value.parameter], required: true}})[0];
      fields.push(field);
      values[name] = displayParameter(field.default, field.type);
    }
  }
  return {fields, values};
}

export function previewError(message = ""): string {
  if (/404|not found|não encontrad/i.test(message)) return "Fonte ou rota de prévia não encontrada. Verifique a fonte e tente de novo.";
  if (/403|forbidden|permission|permissão|permissões|CSRF/i.test(message)) return "Sem permissão para consultar esta fonte. Confira seu acesso e tente de novo.";
  if (/401|authentication|credentials/i.test(message)) return "Sua sessão expirou. Entre novamente para consultar a prévia.";
  if (/failed to fetch|network|connection/i.test(message)) return "Falha de conexão. Tente de novo.";
  return message || "Verifique a conexão e tente novamente.";
}

export function useStagePreviews(reportId: number, unit: string, sources: CanvasSource[], enabled: boolean, ownerSchema: Record<string, any> = {}) {
  const [entries, setEntries] = useState<Record<string, { key: string; state: StagePreviewState }>>({});
  const current = useRef({ reportId, unit, sources, ownerSchema, enabled });
  current.current = { reportId, unit, sources, ownerSchema, enabled };
  const runtimeParameters = useRef(new Map<string, Record<string, unknown>>());
  const pending = useRef(new Map<string, AbortController>());
  const keyFor = (source: CanvasSource) => `${unit}:${reportId}:${hashSourceSpec(source)}`;
  const states = useMemo(() => Object.fromEntries(sources.flatMap(source => {
    const entry = entries[source.id];
    return entry?.key === keyFor(source) ? [[source.id, entry.state]] : [];
  })), [entries, sources, unit, reportId]);
  const load = useCallback(async (sourceId: string, retry = false, parameters?: Record<string, unknown>) => {
    const snapshot = current.current;
    const source = snapshot.sources.find(s => s.id === sourceId);
    if (!source || source.type !== "report" || !snapshot.enabled) return;
    const key = `${current.current.unit}:${current.current.reportId}:${hashSourceSpec(source)}`;
    if (pending.current.has(key) && !retry) return;
    if (parameters) runtimeParameters.current.set(key, parameters);
    parameters = parameters || runtimeParameters.current.get(key);
    pending.current.get(key)?.abort();
    const controller = new AbortController();
    pending.current.set(key, controller);
    const put = (state: StagePreviewState) => {
      const latest = current.current.sources.find(s => s.id === sourceId);
      if (!latest || `${current.current.unit}:${current.current.reportId}:${hashSourceSpec(latest)}` !== key) return;
      if (!controller.signal.aborted) setEntries(prev => ({ ...prev, [sourceId]: {key, state} }));
    };
    put({ status: "loading", data: null, error: null, loadedAt: null });
    let fields: TestParameter[] = [], values: Record<string,string> = {};
    try {
      const report = await request<{parameter_schema?: Record<string, unknown>}>(query(`reports/${source.report_id}`, {unit: snapshot.unit}));
      ({fields, values} = previewParameters(source, report.parameter_schema || {}, snapshot.ownerSchema));
      if (parameters) for (const field of fields) values[field.name] = displayParameter(parameters[field.name] ?? field.default, field.type);
      const missing = fields.filter(f => f.required !== false && f.default == null && !values[f.name]?.trim());
      if (missing.length) {
        put({status: "idle", data: null, error: `Preencha os parâmetros: ${missing.map(f => f.label).join(", ")}.`, loadedAt: null, fields, values});
        return;
      }
      // Only this request receives resolved values; never change the layout/store.
      const resolved = {...source, parameters: {...source.parameters, ...parameters}} as typeof source;
      for (const field of fields) {
        if (!isParameterBinding(resolved.parameters?.[field.name])) continue;
        const text = values[field.name];
        resolved.parameters![field.name] = field.type === "date" && text ? text.split("/").reverse().join("-")
          : field.type === "integer" || field.type === "number" ? Number(text) : text;
      }
      const data = await fetchSourcePreviewRequest(snapshot.reportId, snapshot.unit, resolved,
        {}, 50, controller.signal);
      put({ status: "ready", data, error: null, loadedAt: new Date(), fields, values });
    } catch (err: any) {
      put({ status: "error", data: null, loadedAt: null, fields, values,
        error: `Não foi possível carregar a prévia. ${previewError(err?.message)}` });
    } finally { if (pending.current.get(key) === controller) pending.current.delete(key); }
  }, []);
  useEffect(() => {
    for (const [key, controller] of pending.current) {
      if (!sources.some(s => keyFor(s) === key)) { controller.abort(); pending.current.delete(key); }
    }
    if (enabled) for (const source of sources) {
      if (source.type === "report" && !states[source.id]) void load(source.id);
    }
  }, [enabled, sources, states, load]);
  useEffect(() => () => { for (const controller of pending.current.values()) controller.abort(); }, []);
  return { states, load };
}
