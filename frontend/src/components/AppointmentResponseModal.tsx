import { useEffect, useId, useState } from "react";
import { Check, X } from "lucide-react";
import { query, request } from "../api";
import type { Appointment } from "../types";
import InlineDialog from "./InlineDialog";

export default function AppointmentResponseModal({
  item,
  initialOutcome = "confirmed",
  unit,
  save,
  onClose,
}: {
  item: Appointment;
  initialOutcome?: "confirmed" | "declined";
  unit: string;
  save: (version: number, values: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
}) {
  const formId = useId();
  const contactList = item.tracking?.contacts || [];
  const defaultPhone = contactList[0]?.phone || item.phone || "";
  const [version, setVersion] = useState<number | null>(null),
    [channel, setChannel] = useState("phone"),
    [outcome, setOutcome] = useState<"confirmed" | "declined">(
      initialOutcome === "declined" ? "declined" : "confirmed",
    ),
    [phone, setPhone] = useState(defaultPhone),
    [person, setPerson] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [at, setAt] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 19);
  });
  useEffect(() => {
    let active = true;
    const trackingId = item.tracking?.id;
    if (!trackingId) return;
    request<{ version: number }>(query(`cases/${trackingId}`, { unit }))
      .then((value) => active && setVersion(value.version))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [unit, item.tracking?.id]);
  return (
    <InlineDialog
      title="Confirmar ou recusar agendamento"
      subtitle={item.patient}
      onClose={onClose}
      busy={busy}
      footer={
        <footer className="inline-dialog-footer">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form={formId}
            className={`button response-submit-${outcome}`}
            disabled={busy || version === null || !phone}
          >
            {outcome === "confirmed" ? (
              <Check size={15} strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <X size={15} strokeWidth={2.5} aria-hidden="true" />
            )}
            {busy
              ? "Salvando…"
              : outcome === "confirmed"
                ? "Registrar confirmação"
                : "Registrar recusa"}
          </button>
        </footer>
      }
    >
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <form
        id={formId}
        className="response-registration"
        onSubmit={async (event) => {
          event.preventDefault();
          if (version === null || busy) return;
          setBusy(true);
          setError("");
          try {
            await save(version, {
              outcome,
              channel,
              phone,
              interlocutor: person.trim(),
              occurred_at: new Date(at).toISOString(),
              text:
                text.trim() ||
                `${outcome === "confirmed" ? "Confirmação" : "Recusa"} registrada por ${channel === "phone" ? "telefone" : "WhatsApp"}.`,
            });
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="response-options">
          <legend>Resposta do paciente</legend>
          <div className="response-choice-cards">
            <button
              type="button"
              className={`response-choice-card choice-confirmed ${outcome === "confirmed" ? "active" : ""}`}
              onClick={() => setOutcome("confirmed")}
              aria-pressed={outcome === "confirmed"}
            >
              <div className="choice-icon">
                <Check size={18} strokeWidth={2.5} />
              </div>
              <div className="choice-info">
                <strong>Confirmado</strong>
                <span>Presença confirmada</span>
              </div>
              <div className="choice-badge-check">
                <Check size={13} strokeWidth={3} />
              </div>
            </button>
            <button
              type="button"
              className={`response-choice-card choice-declined ${outcome === "declined" ? "active" : ""}`}
              onClick={() => setOutcome("declined")}
              aria-pressed={outcome === "declined"}
            >
              <div className="choice-icon">
                <X size={18} strokeWidth={2.5} />
              </div>
              <div className="choice-info">
                <strong>Recusado</strong>
                <span>Não comparecerá</span>
              </div>
              <div className="choice-badge-check">
                <Check size={13} strokeWidth={3} />
              </div>
            </button>
          </div>
        </fieldset>
        <div className="response-form-grid">
          <label className="op-field">
            <span>Recebida por</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="phone">Telefone</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </label>
          <label className="op-field">
            <span>Contato da resposta</span>
            <select
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            >
              <option value="">Selecione um contato</option>
              {contactList
                .filter((c) => Boolean(c.phone))
                .map((c) => (
                  <option key={c.phone} value={c.phone}>
                    {c.phone}
                  </option>
                ))}
              {item.phone &&
                !contactList.some((c) => c.phone === item.phone) && (
                  <option value={item.phone}>{item.phone}</option>
                )}
            </select>
          </label>
          <label className="op-field">
            <span>Respondido por</span>
            <input
              required
              maxLength={200}
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              placeholder="Nome de quem respondeu"
            />
          </label>
          <label className="op-field">
            <span>Data e hora da resposta</span>
            <input
              required
              type="datetime-local"
              step={1}
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
        </div>
        <label className="op-field">
          <span>Observação sobre a resposta (opcional)</span>
          <textarea
            rows={3}
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <p className="communication-empty"></p>
      </form>
    </InlineDialog>
  );
}
