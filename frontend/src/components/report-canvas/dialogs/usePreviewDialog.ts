import { useCallback, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { CanvasLayout, OutputFormat } from "../model";
import { collectTestParameters, displayParameter, testParameters } from "../parameters";
import type { PreviewModalState } from "./PreviewDialog";

export function usePreviewDialog({
  parameterSchema,
  outputFormat,
  validateBeforeSend,
  previewCanvas,
  trackDownloadUrl,
  revokeDownloadUrl,
}: {
  parameterSchema?: Record<string, unknown>;
  outputFormat: OutputFormat;
  validateBeforeSend: (requireAtLeastOneBlock: boolean) => CanvasLayout | null;
  previewCanvas: (params: {
    layout: CanvasLayout;
    parameters: Record<string, unknown>;
    format: OutputFormat;
  }) => Promise<{ blob: Blob; filename: string; format: string; info: string }>;
  trackDownloadUrl: (blob: Blob) => string;
  revokeDownloadUrl: (url?: string) => void;
}) {
  const [previewModal, setPreviewModal] = useState<PreviewModalState | null>(null);
  const previewFields = useMemo(
    () => testParameters(parameterSchema || {}),
    [parameterSchema],
  );

  const openPreviewDialog = useCallback(() => {
    const clean = validateBeforeSend(true);
    if (!clean) return;
    setPreviewModal({
      format: outputFormat,
      values: Object.fromEntries(
        previewFields.map((f) => [f.name, displayParameter(f.default, f.type)]),
      ),
      busy: false,
      error: "",
      info: "",
    });
  }, [outputFormat, previewFields, validateBeforeSend]);

  const closePreviewDialog = useCallback(() => {
    if (previewModal?.busy) return;
    revokeDownloadUrl(previewModal?.resultUrl);
    setPreviewModal(null);
  }, [previewModal, revokeDownloadUrl]);

  const handleRunPreview = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!previewModal) return;
      const clean = validateBeforeSend(true);
      if (!clean) return;
      let parsedParams: Record<string, unknown>;
      try {
        parsedParams = collectTestParameters(previewFields, previewModal.values);
      } catch (err) {
        setPreviewModal({ ...previewModal, error: (err as Error).message });
        return;
      }
      setPreviewModal((curr) => (curr ? { ...curr, busy: true, error: "", info: "" } : null));
      try {
        const res = await previewCanvas({
          layout: clean,
          parameters: parsedParams,
          format: previewModal.format,
        });
        const url = trackDownloadUrl(res.blob);
        revokeDownloadUrl(previewModal.resultUrl);
        setPreviewModal((curr) =>
          curr
            ? {
                ...curr,
                busy: false,
                resultUrl: url,
                resultName: res.filename,
                resultFormat: res.format,
                info: res.info,
              }
            : null,
        );
      } catch (err) {
        setPreviewModal((curr) =>
          curr ? { ...curr, busy: false, error: (err as Error).message } : null,
        );
      }
    },
    [previewCanvas, previewFields, previewModal, revokeDownloadUrl, trackDownloadUrl, validateBeforeSend],
  );

  return {
    previewModal,
    setPreviewModal,
    previewFields,
    openPreviewDialog,
    closePreviewDialog,
    handleRunPreview,
  };
}
