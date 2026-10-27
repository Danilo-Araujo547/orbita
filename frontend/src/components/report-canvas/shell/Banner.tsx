import { AlertTriangle, Check, RefreshCw } from "lucide-react";

export interface BannerMessage {
  tone: "error" | "conflict" | "ok";
  text: string;
}

export interface BannerProps {
  banner: BannerMessage | null;
  disabled: boolean;
  onReload: () => void;
  onDismiss: () => void;
}

export default function Banner({ banner, disabled, onReload, onDismiss }: BannerProps) {
  if (!banner) return null;
  return (
    <div
      className={`rc-banner rc-banner-${banner.tone}`}
      role={banner.tone === "ok" ? "status" : "alert"}
    >
      <div className="rc-banner-content">
        {banner.tone === "ok" ? <Check size={15} /> : <AlertTriangle size={15} />}
        <span>{banner.text}</span>
      </div>
      <div className="rc-banner-actions">
        {banner.tone === "conflict" && (
          <button
            type="button"
            className="rc-mini-btn"
            disabled={disabled}
            onClick={onReload}
          >
            <RefreshCw size={13} />
            Recarregar agora
          </button>
        )}
        <button type="button" className="rc-mini-btn" onClick={onDismiss}>
          Ocultar
        </button>
      </div>
    </div>
  );
}
