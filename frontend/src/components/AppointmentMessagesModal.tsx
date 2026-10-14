import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { query, request } from "../api";
import { labels } from "../format";
import type { Appointment, Paginated } from "../types";
import InlineDialog from "./InlineDialog";

export function responseDate(value?: string | null) {
  return value
    ? new Date(value).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "Não registrado";
}
type Received = {
  classification: string;
  id: number;
  text: string;
  occurred_at: string;
  sender: string;
  responded_by: string;
};
type Sent = {
  id: string;
  body: string;
  recipient: string;
  state: string;
  sent_at: string | null;
  created_at: string;
  sender_phone: string;
  channel_id: string;
  template_name: string;
  responses: Received[];
  appointment_revision?: number;
};
type Manual = {
  id: number;
  outcome: string;
  interlocutor: string;
  occurred_at: string;
  channel: string;
  actor_name: string;
  text: string;
  data: {
    phone?: string;
    message_id?: string;
    historical?: boolean;
    revision?: number;
  };
};
type Communications = Paginated<Sent> & { manual_responses: Manual[] };
function WhatsAppResponse({
  response,
  sender,
}: {
  response: Received;
  sender: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const content = [
    `Resposta: ${response.text}`,
    `Data Resposta: ${responseDate(response.occurred_at).replace(/,\s*/, " ")}`,
    `Respondido por: ${response.responded_by || "Não informado"}`,
    `Contato da Resposta: ${response.sender || "Não informado"}`,
    `enviado por: ${sender}`,
  ].join("\n");
  async function copy() {
    setCopied(false);
    setCopyError(false);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        // Support the internal HTTP deployment as well as localhost/HTTPS.
        const field = document.createElement("textarea");
        field.value = content;
        field.style.position = "fixed";
        field.style.opacity = "0";
        const previousFocus = document.activeElement as HTMLElement | null;
        document.body.appendChild(field);
        try {
          field.select();
          if (!document.execCommand("copy"))
            throw new Error("Copy unavailable");
        } finally {
          field.remove();
          previousFocus?.focus();
        }
      }
      setCopied(true);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <article className="communication-response">
      <div className="communication-response-actions">
        <button
          className="button"
          onClick={() => void copy()}
          aria-label="Copiar resposta do WhatsApp"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copiado" : "Copiar resposta"}
        </button>
        <span role="status">
          {copied
            ? "Resposta copiada."
            : copyError
              ? "Não foi possível copiar. Selecione o texto abaixo."
              : ""}
        </span>
      </div>
      {copyError && (
        <textarea
          className="communication-copy-fallback"
          aria-label="Resposta para copiar"
          readOnly
          value={content}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <Details
        outcome={response.classification}
        text={response.text}
        date={response.occurred_at}
        person={response.responded_by}
        contact={response.sender}
        sender={sender}
        channel="WhatsApp"
      />
    </article>
  );
}
function Details({
  text,
  date,
  person,
  contact,
  sender,
  channel,
  operator,
  outcome,
}: {
  text: string;
  date: string;
  person: string;
  contact: string;
  sender: string;
  channel: string;
  operator?: string;
  outcome?: string;
}) {
  return (
    <dl className="communication-facts">
      <div>
        <dt>Resposta</dt>
        <dd
          className={`response-original response-status-${outcome || "pending"}`}
        >
          {text}
        </dd>
      </div>
      <div>
        <dt>Data Resposta</dt>
        <dd>{responseDate(date)}</dd>
      </div>
      <div>
        <dt>Respondido por</dt>
        <dd>{person || "Não informado"}</dd>
      </div>
      <div>
        <dt>Contato da resposta</dt>
        <dd>{contact || "Não informado"}</dd>
      </div>
      <div>
        <dt>Enviado por</dt>
        <dd>{sender || "Não registrado"}</dd>
      </div>
      <div>
        <dt>Canal</dt>
        <dd>{channel}</dd>
      </div>
      {operator && (
        <div>
          <dt>Registrado por</dt>
          <dd>{operator}</dd>
        </div>
      )}
    </dl>
  );
}
export default function AppointmentMessagesModal({
  item,
  unit,
  onClose,
  groupId,
}: {
  item: Appointment;
  unit: string;
  onClose: () => void;
  groupId?: string;
}) {
  const [data, setData] = useState<Communications | null>(null),
    [selected, select] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    request<Communications>(
      query(`appointments/${item.id}/communications`, {
        unit,
        page: String(page),
        group: groupId || "",
      }),
    )
      .then((result) => {
        if (active) {
          setData(result);
          select(
            result.results.find((m) =>
              ["accepted", "sent", "delivered", "read"].includes(m.state),
            )?.id ||
              result.results[0]?.id ||
              "",
          );
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [item.id, unit, page, groupId]);
  const message = data?.results.find((m) => m.id === selected);
  const sender =
    message?.sender_phone ||
    (message?.channel_id === "simulated" ? "Simulado" : "Não registrado");
  return (
    <InlineDialog
      title="Mensagem e resposta"
      subtitle={item.patient}
      onClose={onClose}
      footer={
        <footer className="inline-dialog-footer">
          <button type="button" className="button" onClick={onClose}>
            Fechar
          </button>
        </footer>
      }
    >
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {!data && !error && <p>Carregando mensagens…</p>}
      {data && (
        <>
          {!!data.results.length && (
            <label className="op-field">
              <span>Mensagem / destinatário</span>
              <select value={selected} onChange={(e) => select(e.target.value)}>
                {data.results.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.recipient || "Sem contato"} ·{" "}
                    {responseDate(m.sent_at || m.created_at)} ·{" "}
                    {labels[m.state] || m.state}
                  </option>
                ))}
              </select>
            </label>
          )}
          {message ? (
            <>
              <h3 className="communication-section-title">
                Respostas recebidas pelo WhatsApp
              </h3>
              {message.responses.length ? (
                [...message.responses]
                  .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
                  .map((r) => (
                    <WhatsAppResponse key={r.id} response={r} sender={sender} />
                  ))
              ) : (
                <p className="communication-empty">
                  Nenhuma resposta recebida para esta mensagem.
                </p>
              )}
              <h3 className="communication-section-title">Mensagem enviada</h3>
              <div className="communication-meta">
                <span className="op-pill">
                  {labels[message.state] || message.state}
                </span>
                <span>{message.template_name}</span>
              </div>
              <div className="communication-content">
                {message.body || "Conteúdo indisponível"}
              </div>
              <dl className="communication-facts">
                <div>
                  <dt>Destinatário</dt>
                  <dd>{message.recipient || "Sem número"}</dd>
                </div>
                <div>
                  <dt>Número de envio</dt>
                  <dd>{sender}</dd>
                </div>
                <div>
                  <dt>Data do envio / aceite</dt>
                  <dd>
                    {message.sent_at
                      ? responseDate(message.sent_at)
                      : [
                            "preview",
                            "queued",
                            "blocked",
                            "cancelled",
                            "expired",
                          ].includes(message.state)
                        ? "Sem envio confirmado"
                        : "Não registrado"}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="communication-empty">
              Nenhuma mensagem registrada neste agendamento.
            </p>
          )}
          {!!data.manual_responses.length && (
            <>
              <h3 className="communication-section-title">
                Respostas registradas pela equipe
              </h3>
              {data.manual_responses.map((r) => (
                <article className="communication-response" key={r.id}>
                  <Details
                    outcome={r.outcome}
                    text={
                      r.outcome === "confirmed"
                        ? "SIM — confirmado"
                        : r.outcome === "declined"
                          ? "NÃO — recusado"
                          : r.outcome
                    }
                    date={r.occurred_at}
                    person={r.interlocutor}
                    contact={r.data.phone || ""}
                    sender={
                      data.results.find((m) => m.id === r.data.message_id)
                        ?.sender_phone ||
                      (r.channel === "phone"
                        ? "Não se aplica ao contato por telefone"
                        : "Não registrado")
                    }
                    channel={
                      r.channel === "phone"
                        ? "Telefone"
                        : r.channel === "whatsapp"
                          ? "WhatsApp (registro manual)"
                          : "Painel"
                    }
                    operator={r.actor_name}
                  />
                  {r.text && (
                    <p className="communication-annotation">{r.text}</p>
                  )}
                  {r.data.historical && (
                    <small>
                      Registro histórico; não substituiu a resposta mais
                      recente.
                    </small>
                  )}
                </article>
              ))}
            </>
          )}
          {(data.next || data.previous) && (
            <div className="op-pager">
              <button
                className="button"
                disabled={!data.previous}
                onClick={() => setPage((v) => v - 1)}
              >
                Anteriores
              </button>
              <span>Página {page}</span>
              <button
                className="button"
                disabled={!data.next}
                onClick={() => setPage((v) => v + 1)}
              >
                Próximas
              </button>
            </div>
          )}
        </>
      )}
    </InlineDialog>
  );
}
