import type { Appointment } from "../types";
import { whatsappStatus } from "../whatsappStatus";

export default function WhatsAppStatus({ appointment }: { appointment: Appointment }) {
  const status = whatsappStatus(appointment);
  return <span className={`whatsapp-status whatsapp-status-${status.state}`} role="img" aria-label={status.label} title={status.label}>
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
      <path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.8a8.5 8.5 0 1 1 16.2-4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8.2 7.3c.3-.2.6-.2.8.2l1 2c.1.3.1.5-.1.7l-.7.8c.7 1.3 1.7 2.3 3.1 3l.8-1c.2-.2.4-.3.7-.1l2.1 1c.3.2.4.4.3.8-.2 1.1-1 1.8-2.1 1.7-3.7-.4-7.2-3.7-7.7-7.1-.1-.9.6-1.7 1.1-2Z" fill="currentColor" />
    </svg>
  </span>;
}
