import { useCallback } from "react";
import { query, request } from "../../../api";
import type {
  CanvasAssetMeta,
  CanvasGetResponse,
  CanvasLayout,
  CanvasPreviewResponse,
  OutputFormat,
} from "../model";
import { MAX_ASSET_BYTES, base64ToBlob, normalizeLayout } from "../model";

export class CanvasSaveError extends Error {
  readonly isConflict: boolean;
  constructor(message: string, isConflict: boolean) {
    super(message);
    this.name = "CanvasSaveError";
    this.isConflict = isConflict;
  }
}

export function isCanvasConflictMessage(msg: string): boolean {
  return /alterado|conflito|409|atualiz|vers[aã]o/i.test(msg);
}

export function validateAssetFile(file: File): string | null {
  const isAllowedMime = file.type === "image/png" || file.type === "image/jpeg";
  const isAllowedExt = /\.(png|jpe?g)$/i.test(file.name);
  if (!isAllowedMime && !isAllowedExt) {
    return "Formato inválido. Envie apenas imagens PNG ou JPEG.";
  }
  if (file.size === 0) {
    return "Arquivo de imagem vazio.";
  }
  if (file.size > MAX_ASSET_BYTES) {
    return "A imagem excede o limite de 2 MB.";
  }
  return null;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler arquivo local."));
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const commaIdx = dataUrl.indexOf(",");
      resolve(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

export async function fetchCanvasRequest(reportId: number, unit: string) {
  const data = await request<CanvasGetResponse>(query(`reports/${reportId}/canvas`, { unit }));
  const normalizedLayout = normalizeLayout(data.layout);
  return { data, normalizedLayout };
}

export async function saveCanvasRequest(
  reportId: number,
  unit: string,
  params: {
    version: number;
    layout: CanvasLayout;
    enabled: boolean;
    outputFormat: OutputFormat;
  },
) {
  try {
    const saved = await request<CanvasGetResponse>(
      query(`reports/${reportId}/canvas`, { unit }),
      "POST",
      {
        version: Math.max(1, Math.round(Number(params.version) || 1)),
        layout: params.layout,
        enabled: params.enabled,
        output_format: params.outputFormat,
      },
    );
    const normalizedLayout = normalizeLayout(saved.layout ?? params.layout);
    return { saved, normalizedLayout };
  } catch (e) {
    const rawMsg = (e as Error).message || "Falha ao salvar o Canvas.";
    const conflict = isCanvasConflictMessage(rawMsg);
    const formatted = conflict
      ? `${rawMsg} Recarregue os dados do relatório antes de salvar novamente.`
      : rawMsg;
    throw new CanvasSaveError(formatted, conflict);
  }
}

export async function previewCanvasRequest(
  reportId: number,
  unit: string,
  params: {
    layout: CanvasLayout;
    parameters: Record<string, unknown>;
    format: OutputFormat;
  },
) {
  const res = await request<CanvasPreviewResponse>(
    query(`reports/${reportId}/canvas-preview`, { unit }),
    "POST",
    {
      layout: params.layout,
      parameters: params.parameters,
      output_format: params.format,
    },
  );
  const fmt = (res.format || params.format).toLowerCase();
  const mime =
    fmt === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf";
  const blob = base64ToBlob(res.content, mime);
  return {
    blob,
    filename: res.filename || `previa-canvas-${reportId}.${fmt}`,
    format: fmt,
    info: res.rows === 0 ? "Nenhum dado encontrado para os parâmetros informados." : "",
  };
}

export async function uploadCanvasAssetRequest(reportId: number, unit: string, file: File) {
  const pureBase64 = await readFileAsBase64(file);
  const created = await request<CanvasAssetMeta>(
    query(`reports/${reportId}/canvas-assets`, { unit }),
    "POST",
    {
      filename: file.name.slice(0, 160),
      content: pureBase64,
    },
  );
  return {
    created,
    fallbackBase64: pureBase64,
    fallbackMime: file.type,
  };
}

export function useCanvasApi({ reportId, unit }: { reportId: number; unit: string }) {
  const fetchCanvas = useCallback(
    () => fetchCanvasRequest(reportId, unit),
    [reportId, unit],
  );
  const saveCanvas = useCallback(
    (params: Parameters<typeof saveCanvasRequest>[2]) =>
      saveCanvasRequest(reportId, unit, params),
    [reportId, unit],
  );
  const previewCanvas = useCallback(
    (params: Parameters<typeof previewCanvasRequest>[2]) =>
      previewCanvasRequest(reportId, unit, params),
    [reportId, unit],
  );
  const uploadAsset = useCallback(
    (file: File) => uploadCanvasAssetRequest(reportId, unit, file),
    [reportId, unit],
  );

  return { fetchCanvas, saveCanvas, previewCanvas, uploadAsset };
}
