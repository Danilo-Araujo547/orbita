import { useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Check, CheckCircle2, Copy, RefreshCw, X } from "lucide-react";
import { isCanvasConflictMessage } from "../api/useCanvasApi";

export interface BannerMessage {
  tone: "error" | "conflict" | "ok";
  text: string;
  details?: string;
  localVersion?: number;
  remoteVersion?: number;
}

export interface BannerProps {
  banner: BannerMessage | null;
  disabled: boolean;
  currentVersion?: number;
  onReload: () => void;
  onDismiss: () => void;
}

const OK_AUTODISMISS_MS = 4000;

function resolveConflictText(banner: BannerMessage, currentVersion?: number): {
  isVersionConflict: boolean;
  displayText: string;
} {
  if (banner.tone !== "conflict") {
    return { isVersionConflict: false, displayText: banner.text };
  }
  const isVersionConflict = Boolean(
    banner.localVersion !== undefined ||
      banner.remoteVersion !== undefined ||
      isCanvasConflictMessage(banner.text),
  );
  if (!isVersionConflict) {
    return { isVersionConflict: false, displayText: banner.text };
  }
  const fromVer = banner.localVersion ?? currentVersion ?? 1;
  const matched = banner.text.match(/→\s*v?(\d+)/i);
  const parsedTo = matched ? Number(matched[1]) : NaN;
  const toVer =
    banner.remoteVersion ??
    (Number.isFinite(parsedTo) && parsedTo > fromVer ? parsedTo : fromVer + 1);

  return {
    isVersionConflict: true,
    displayText: `Este relatório foi alterado por outra pessoa (v${fromVer} → v${toVer}). Recarregue para buscar a versão atual ou mantenha suas alterações.`,
  };
}

export default function Banner({
  banner,
  disabled,
  currentVersion,
  onReload,
  onDismiss,
}: BannerProps) {
  const [copied, setCopied] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    setCopied(false);
    if (!banner || banner.tone !== "ok") return;
    const timer = window.setTimeout(() => {
      dismissRef.current();
    }, OK_AUTODISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [banner]);

  if (!banner) return null;

  const { isVersionConflict, displayText } = resolveConflictText(banner, currentVersion);
  const detailsText = banner.details || banner.text;

  const handleCopyDetails = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(detailsText).then(
        () => setCopied(true),
        () => setCopied(false),
      );
    }
  };

  return (
    <div
      className={`cv-banner cv-banner-${banner.tone}`}
      role={banner.tone === "ok" ? "status" : "alert"}
      aria-live={banner.tone === "ok" ? "polite" : "assertive"}
    >
      <div className="cv-banner-main">
        {banner.tone === "ok" ? (
          <CheckCircle2 size={15} aria-hidden="true" />
        ) : banner.tone === "conflict" ? (
          <AlertTriangle size={15} aria-hidden="true" />
        ) : (
          <AlertCircle size={15} aria-hidden="true" />
        )}
        <span className="cv-banner-text">{displayText}</span>
      </div>

      <div className="cv-banner-actions">
        {isVersionConflict ? (
          <>
            <button
              type="button"
              className="cv-btn"
              aria-label="Recarregar relatório e descartar alterações locais"
              disabled={disabled}
              onClick={onReload}
            >
              <RefreshCw size={13} aria-hidden="true" />
              <span>Recarregar (perde alterações)</span>
            </button>
            <button
              type="button"
              className="cv-btn"
              aria-label="Manter minhas alterações locais"
              onClick={onDismiss}
            >
              <span>Manter minhas alterações</span>
            </button>
            <button
              type="button"
              className="cv-btn"
              aria-label="Copiar detalhes do conflito"
              onClick={handleCopyDetails}
            >
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              <span>{copied ? "Copiado" : "Copiar detalhes"}</span>
            </button>
          </>
        ) : (
          <>
            {banner.tone === "error" && (
              <button
                type="button"
                className="cv-btn"
                aria-label="Recarregar relatório"
                disabled={disabled}
                onClick={onReload}
              >
                <RefreshCw size={13} aria-hidden="true" />
                <span>Recarregar</span>
              </button>
            )}
            {banner.tone !== "ok" && (
              <button
                type="button"
                className="cv-btn"
                aria-label="Copiar detalhes"
                onClick={handleCopyDetails}
              >
                {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                <span>{copied ? "Copiado" : "Copiar detalhes"}</span>
              </button>
            )}
            <button
              type="button"
              className="cv-btn"
              aria-label="Fechar aviso"
              onClick={onDismiss}
            >
              <X size={13} aria-hidden="true" />
              <span>Fechar</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
