import FormAction, { FormActionContext } from "./FormAction";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowLeft,
  Building2,
  Check,
  ClipboardList,
  Clock3,
  Database,
  Download,
  FileSpreadsheet,
  MessageCircle,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { query, request } from "../api";
import { dateTime, labels } from "../format";
import type { Issue, Paginated, PageName } from "../types";
import "../operations.css";
import ObservationModal from "./ObservationModal";
import OperationsAdministration from "./OperationsAdministration";
import { Panel, Empty } from "./ui";

type Origin = {
  id: number;
  patient: string;
  phone: string;
  source: string;
  external_id: string;
  occurred_at: string;
  revision: number;
  synthetic: boolean;
  data: Record<string, string>;
};
type CareCase = {
  id: string;
  event: Origin;
  purpose: string;
  purpose_label: string;
  state: string;
  state_label: string;
  assignee: number | null;
  assignee_name: string;
  priority: string;
  response_state: string;
  outcome: string;
  version: number;
  created_at: string;
};
type Interaction = {
  id: number;
  kind: string;
  text: string;
  actor_name: string;
  channel: string;
  outcome: string;
  interlocutor: string;
  occurred_at: string;
};
type Row = {
  id: string | number;
  name?: string;
  code?: string;
  text?: string;
  state?: string;
  enabled?: boolean;
  unavailable_reason?: string;
  report_name?: string;
  error_code?: string;
  delivery_state?: string;
  format?: string;
  created_at?: string;
  procedure_code?: string;
  version?: number;
  purpose?: string;
  cases?: string[];
  row_count?: number;
  duplicates?: number;
  errors?: { line: number; code: string }[];
  active?: boolean;
  verified?: boolean;
  phone?: string;
  verified_at?: string;
  user?: number;
  mapping?: Record<string, string>;
};
const purposes: Record<string, string> = {
  appointment: "Agendamento",
  waitlist: "Permanência na fila CDR",
  summons: "Convocação CDR",
  postoperative: "Pós-cirúrgico",
  absence: "Motivo de ausência",
  movement: "Movimentação",
  report: "Relatório",
};
const outcomes: Record<string, string> = {
  confirmed: "Confirmou",
  declined: "Recusou",
  wrong_person: "Não conhece o paciente",
  opt_out: "Não deseja receber mensagens",
  review: "Precisa de análise",
  stay_waitlist: "Permanece na fila",
  leave_waitlist: "Saiu da fila",
  acknowledged: "Ciente",
  well: "Informou estar bem",
  needs_attention: "Requer atendimento",
  reason_received: "Motivo informado",
};
const byPurpose: Record<string, string[]> = {
  appointment: ["confirmed", "declined"],
  waitlist: ["stay_waitlist", "leave_waitlist"],
  summons: ["acknowledged", "declined"],
  postoperative: ["well", "needs_attention"],
  absence: ["reason_received"],
  movement: ["acknowledged"],
  report: ["acknowledged"],
};
const status: Record<string, string> = {
  pending: "Aguardando",
  no_response: "Sem resposta no prazo",
  review: "Em análise",
  answered: "Respondido",
  preview: "Somente análise",
  draft: "Rascunho",
  confirmed: "Importação confirmada",
  pending_external: "Aguardando hospitalar",
  confirmed_external: "Execução confirmada",
  ready: "Disponível",
  failed: "Falha",
  blocked: "Bloqueado",
  not_requested: "Entrega não solicitada",
  blocked_channel_not_configured: "Canal de entrega não homologado",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="op-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Notice({ children }: { children: ReactNode }) {
  return <div className="op-notice">{children}</div>;
}
function Pager({
  page,
  count,
  onChange,
}: {
  page: number;
  count: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="op-pager">
      <span>
        {count} registros · página {page}
      </span>
      <button
        className="button"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        Anterior
      </button>
      <button
        className="button"
        disabled={page * 50 >= count}
        onClick={() => onChange(page + 1)}
      >
        Próxima
      </button>
    </div>
  );
}

export default function OperationsWorkspace({
  page,
  unit,
  role,
  username,
}: {
  page: PageName;
  unit: string;
  role: string;
  username: string;
}) {
  const [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, refresh] = useState(0);
  const operate = role === "admin" || role === "operator";
  const act = async (path: string, data: unknown) => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await request<unknown>(
        `/api/v1/${path}/?unit=${encodeURIComponent(unit)}`,
        "POST",
        data,
      );
      refresh((v) => v + 1);
      setSuccess("Operação registrada.");
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormActionContext.Provider value={{ busy, error, revision }}>
      <section
        className="operations-workspace"
        aria-label="Operação de acompanhamento"
      >
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="op-success" role="status">
            <Check size={15} />
            {success}
          </div>
        )}
        {page === "care" && (
          <Care
            unit={unit}
            username={username}
            operate={operate}
            revision={revision}
            act={act}
            busy={busy}
            onError={setError}
          />
        )}
        {page === "campaigns" && (
          <Campaigns
            unit={unit}
            operate={operate}
            revision={revision}
            act={act}
            busy={busy}
            onError={setError}
          />
        )}
        {page === "reports" && (
          <Reports
            unit={unit}
            operate={operate}
            revision={revision}
            act={act}
            busy={busy}
            onError={setError}
          />
        )}
        {page === "operationsAdmin" && (
          <Administration
            unit={unit}
            admin={role === "admin"}
            revision={revision}
            act={act}
            busy={busy}
            onError={setError}
          />
        )}
      </section>
    </FormActionContext.Provider>
  );
}
type Action = (path: string, data: unknown) => Promise<unknown>;
type Common = {
  unit: string;
  revision: number;
  act: Action;
  busy: boolean;
  onError: (e: string) => void;
};

function Care(_props: Common & { username: string; operate: boolean }) {
  return (
    <p className="op-muted">
      As intervenções estão disponíveis em Agendamentos. Use Correções para
      tratar pendências.
    </p>
  );
}

export function AppointmentDetail({
  id,
  ...props
}: Common & {
  id: string;
  username: string;
  operate: boolean;
  onBack: () => void;
}) {
  const [item, setItem] = useState<CareCase | null>(null);
  useEffect(() => {
    setItem(null);
    request<CareCase>(query(`cases/${id}`, { unit: props.unit }))
      .then(setItem)
      .catch((e) => props.onError(e.message));
  }, [id, props.unit, props.onError]);
  return item ? (
    <CaseDetail item={item} {...props} />
  ) : (
    <p>Carregando agendamento…</p>
  );
}

function CaseDetail({
  item,
  unit,
  operate,
  revision,
  act,
  busy,
  onError,
  onBack,
}: Common & {
  item: CareCase;
  username: string;
  operate: boolean;
  onBack: () => void;
}) {
  const [c, setCase] = useState(item),
    [timeline, setTimeline] = useState<Paginated<Interaction>>({
      count: 0,
      results: [],
      next: null,
      previous: null,
    }),
    [timelinePage, setTimelinePage] = useState(1);
  const [phone, setPhone] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [mode, setMode] = useState("call"),
    [text, setText] = useState(""),
    [outcome, setOutcome] = useState(""),
    [interlocutor, setInterlocutor] = useState(""),
    [callResult, setCallResult] = useState("not_answered");
  const [comms, setComms] = useState<{
    messages: {
      id: string;
      body: string;
      state: string;
      created_at: string;
      recipient: string;
    }[];
    replies: {
      id: number;
      text: string;
      occurred_at: string;
      classification: string;
      sender: string;
    }[];
  }>({ messages: [], replies: [] });
  const [movements, setMovements] = useState<Row[]>([]),
    [movementKind, setMovementKind] = useState("reschedule"),
    [movementDate, setMovementDate] = useState(""),
    [evidence, setEvidence] = useState("");
  const [contacts, setContacts] = useState<
    (Row & { status: string; opted_out: boolean })[]
  >([]);
  useEffect(() => {
    let active = true;
    Promise.all([
      request<CareCase>(query(`cases/${item.id}`, { unit })),
      request<Paginated<Interaction>>(
        query(`cases/${item.id}/timeline`, {
          unit,
          page: String(timelinePage),
        }),
      ),
      request<typeof comms>(query(`cases/${item.id}/communications`, { unit })),
      request<Paginated<Row>>(query("movements", { unit, case: item.id })),
      request<Paginated<(typeof contacts)[number]>>(
        query("contacts", { unit, event: String(item.event.id) }),
      ),
    ])
      .then(([current, history, communications, moves, numbers]) => {
        if (active) {
          setCase(current);
          setTimeline(history);
          setComms(communications);
          setMovements(moves.results);
          setContacts(numbers.results);
          setPhone((previous) => previous || numbers.results[0]?.phone || "");
        }
      })
      .catch((e) => active && onError((e as Error).message));
    return () => {
      active = false;
    };
  }, [item.id, item.event.id, unit, revision, timelinePage, onError]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await act(`cases/${c.id}/act`, {
        version: c.version,
        action: mode,
        text,
        outcome: outcome || undefined,
        interlocutor,
        call_result: callResult,
        phone,
      });
      setText("");
    } catch {
      /* Error is displayed by the parent. */
    }
  };
  return (
    <>
      {noteOpen && (
        <ObservationModal
          unit={unit}
          trackingId={c.id}
          patient={c.event.patient}
          canEdit={operate}
          save={async (version, text, options) => {
            const resolveCase = options?.resolveCase ?? true;
            const interlocutor = options?.interlocutor;
            const fullText = resolveCase ? `[Caso resolvido] ${text}` : text;
            await act(`cases/${c.id}/act`, {
              version,
              action: "note",
              text: fullText,
              ...(interlocutor ? { interlocutor } : {}),
              ...(resolveCase ? { priority: "normal" } : {}),
            });
            if (resolveCase) {
              try {
                const openIssues = await request<Paginated<Issue>>(
                  query("issues", { unit }),
                );
                const relevant = openIssues.results.filter(
                  (iss) =>
                    iss.case === c.id ||
                    (c.event?.id && iss.appointment === c.event.id),
                );
                await Promise.all(
                  relevant.map((iss) =>
                    act(`issues/${iss.id}/resolve`, {
                      resolution:
                        text.length >= 5
                          ? text
                          : `Resolvido via observação: ${text}`,
                    }),
                  ),
                );
              } catch {
                // Secondary issue resolution failure ignored
              }
            }
          }}
          onClose={() => setNoteOpen(false)}
        />
      )}
      <button className="button" onClick={onBack}>
        <ArrowLeft size={15} />
        Voltar para agendamentos
      </button>
      <div className="op-case-heading">
        <div>
          <span className="eyebrow">{c.purpose_label}</span>
          <h2 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="patient-icon" aria-hidden="true">
              <UserRound size={18} />
            </span>
            {c.event.patient}
          </h2>
          <p>
            {c.event.phone} · {dateTime(c.event.occurred_at)}
          </p>
        </div>
        <span
          className={`op-pill response-status-${c.outcome || "pending"} ${c.priority === "high" ? "danger" : ""}`}
        >
          {outcomes[c.outcome] || status[c.response_state]}
        </span>
      </div>
      <div className="op-detail-grid">
        <div className="op-stack">
          <article className="op-card">
            <h3>Resumo do acompanhamento</h3>
            <button
              className="button op-note-button"
              onClick={() => setNoteOpen(true)}
            >
              Observações
            </button>
            <dl className="op-facts">
              <div>
                <dt>Origem</dt>
                <dd>
                  {c.event.source} · {c.event.external_id}
                </dd>
              </div>
              <div>
                <dt>Procedimento</dt>
                <dd>
                  {c.event.data.procedure ||
                    c.event.data.surgery ||
                    "Não informado"}
                </dd>
              </div>
            </dl>
            {contacts.map((contact) => (
              <div className="op-contact" key={contact.id}>
                <span>
                  {contact.phone} ·{" "}
                  {contact.opted_out
                    ? "Não deseja receber mensagens"
                    : {
                        unverified: "Não verificado",
                        verified: "Verificado",
                        invalid: "Inválido",
                        wrong_person: "Não conhece o paciente",
                      }[contact.status] || contact.status}
                </span>
                {operate && (
                  <select
                    aria-label={`Revisar contato ${contact.phone}`}
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      if (text.trim().length < 3) {
                        onError(
                          "Escreva a justificativa no campo de atendimento antes de revisar o contato.",
                        );
                        return;
                      }
                      void act(`contacts/${contact.id}/review`, {
                        version: contact.version,
                        status: e.target.value,
                        text,
                      }).catch(() => {});
                    }}
                  >
                    <option value="">Revisar contato</option>
                    <option value="verified">Verificado</option>
                    <option value="invalid">Inválido</option>
                    <option value="wrong_person">Destinatário incorreto</option>
                  </select>
                )}
              </div>
            ))}
          </article>
          <article className="op-card">
            <h3>
              <MessageCircle size={17} /> Mensagens e respostas
            </h3>
            {comms.messages.map((message) => (
              <div className="op-message" key={message.id}>
                <small>
                  {dateTime(message.created_at)} ·{" "}
                  {labels[message.state] || message.state} · {message.recipient}
                </small>
                <p>{message.body || "Conteúdo indisponível"}</p>
              </div>
            ))}
            {comms.replies.map((reply) => (
              <div className="op-reply" key={reply.id}>
                <small>
                  {dateTime(reply.occurred_at)} · {reply.sender} ·{" "}
                  {outcomes[reply.classification] || reply.classification}
                </small>
                <p>{reply.text}</p>
              </div>
            ))}
            {!comms.messages.length && !comms.replies.length && (
              <p className="op-muted">
                Ainda não há comunicações neste agendamento.
              </p>
            )}
          </article>
          <article className="op-card">
            <h3>
              <Clock3 size={17} /> Linha do tempo
            </h3>
            {timeline.results.map((i) => (
              <div className="op-timeline" key={i.id}>
                <span className="op-dot" />
                <div>
                  <strong>{i.actor_name || "Sistema"}</strong>
                  <small>
                    {dateTime(i.occurred_at)} ·{" "}
                    {i.channel === "phone"
                      ? "Telefone"
                      : i.channel === "whatsapp"
                        ? "WhatsApp"
                        : "Painel"}
                  </small>
                  <p>{i.text}</p>
                  {i.outcome && ["classification", "call"].includes(i.kind) && (
                    <span className="op-pill">
                      {outcomes[i.outcome] ||
                        {
                          answered: "Ligação atendida",
                          not_answered: "Ligação não atendida",
                        }[i.outcome] ||
                        i.outcome}
                    </span>
                  )}
                  {i.interlocutor && <small>Contato: {i.interlocutor}</small>}
                </div>
              </div>
            ))}
            <Pager
              page={timelinePage}
              count={timeline.count}
              onChange={setTimelinePage}
            />
          </article>
        </div>
        <div className="op-stack">
          {operate ? (
            <FormAction
              title="Registrar atendimento"
              label="Registrar atendimento"
            >
              <form className="op-card op-form" onSubmit={submit}>
                <h3>
                  <UserRound size={17} /> Registrar atendimento
                </h3>
                <Field label="Ação">
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    {[
                      ["call", "Tentativa de ligação"],
                      ["classify", "Classificar resposta"],
                    ].map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                {["call", "classify"].includes(mode) && (
                  <Field label="Número utilizado">
                    <select
                      value={phone}
                      required={contacts.length > 1}
                      onChange={(e) => setPhone(e.target.value)}
                    >
                      <option value="">Selecione o contato</option>
                      {contacts.map((contact) => (
                        <option key={contact.id} value={contact.phone}>
                          {contact.phone}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {mode === "classify" && (
                  <Field label="Resultado">
                    <select
                      required
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value)}
                    >
                      <option value="">Selecione</option>
                      {[
                        ...(byPurpose[c.purpose] || []),
                        "wrong_person",
                        "opt_out",
                        "review",
                      ].map((v) => (
                        <option key={v} value={v}>
                          {outcomes[v]}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {mode === "call" && (
                  <>
                    <Field label="Resultado da ligação">
                      <select
                        value={callResult}
                        onChange={(e) => setCallResult(e.target.value)}
                      >
                        <option value="not_answered">Não atendida</option>
                        <option value="answered">Atendida</option>
                      </select>
                    </Field>
                    {callResult === "answered" && (
                      <Field label="Pessoa com quem falou">
                        <input
                          required
                          maxLength={200}
                          value={interlocutor}
                          onChange={(e) => setInterlocutor(e.target.value)}
                        />
                      </Field>
                    )}
                  </>
                )}
                <Field label="Descrição / justificativa">
                  <textarea
                    required
                    minLength={3}
                    maxLength={4000}
                    rows={5}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Descreva o contato realizado ou o motivo da ação."
                  />
                </Field>
                <small className="op-muted">
                  {text.length}/4.000 · autoria e horário ficam no histórico.
                </small>
                <button className="button primary" disabled={busy}>
                  Registrar
                </button>
              </form>
            </FormAction>
          ) : (
            <Notice>Seu perfil permite consultar o histórico.</Notice>
          )}
          {c.purpose === "appointment" && (
            <FormAction
              title="Movimentação de agenda"
              label="Adicionar solicitação"
            >
              {" "}
              <article className="op-card op-form">
                <h3>Movimentação de agenda</h3>
                <Notice>
                  A equipe realiza a alteração no hospitalar e registra a
                  confirmação aqui.
                </Notice>
                {operate && (
                  <>
                    <Field label="Solicitação">
                      <select
                        value={movementKind}
                        onChange={(e) => setMovementKind(e.target.value)}
                      >
                        <option value="reschedule">Reagendamento</option>
                        <option value="transfer">Transferência</option>
                        <option value="cancel">Cancelamento</option>
                      </select>
                    </Field>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void act("movements", {
                          case: c.id,
                          case_version: c.version,
                          kind: movementKind,
                          requested: { description: text },
                        }).catch(() => {})
                      }
                    >
                      Registrar solicitação
                    </button>
                  </>
                )}
                {movements.map((m) => (
                  <div className="op-movement" key={m.id}>
                    <strong>{status[m.state || ""] || m.state}</strong>
                    {m.state === "pending_external" && operate && (
                      <>
                        <Field label="Nova data e horário">
                          <input
                            type="datetime-local"
                            value={movementDate}
                            onChange={(e) => setMovementDate(e.target.value)}
                          />
                        </Field>
                        <Field label="Evidência da execução">
                          <textarea
                            value={evidence}
                            onChange={(e) => setEvidence(e.target.value)}
                            maxLength={4000}
                          />
                        </Field>
                        <button
                          className="button"
                          disabled={busy || evidence.trim().length < 5}
                          onClick={() =>
                            void act(`movements/${m.id}/confirm`, {
                              version: m.version,
                              evidence,
                              final: movementDate
                                ? {
                                    scheduled_at: new Date(
                                      movementDate,
                                    ).toISOString(),
                                  }
                                : {},
                            }).catch(() => {})
                          }
                        >
                          Confirmar execução hospitalar
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </article>
            </FormAction>
          )}
        </div>
      </div>
    </>
  );
}

function useRows<T>(
  path: string,
  unit: string,
  revision: number,
  onError: (e: string) => void,
) {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    let active = true;
    const [resource, filters] = path.split("?");
    request<Paginated<T>>(
      query(resource, {
        unit,
        ...Object.fromEntries(new URLSearchParams(filters)),
      }),
    )
      .then((v) => active && setRows(v.results))
      .catch((e) => active && onError((e as Error).message));
    return () => {
      active = false;
    };
  }, [path, unit, revision, onError]);
  return rows;
}

function Campaigns({
  unit,
  operate,
  revision,
  act,
  busy,
  onError,
}: Common & { operate: boolean }) {
  const campaigns = useRows<Row>("campaigns", unit, revision, onError),
    batches = useRows<Row>("sheet-imports", unit, revision, onError),
    layouts = useRows<Row>("layouts", unit, revision, onError),
    templates = useRows<Row>("templates", unit, revision, onError);
  const [layout, setLayout] = useState(""),
    [purpose, setPurpose] = useState("waitlist"),
    [name, setName] = useState(""),
    [template, setTemplate] = useState(""),
    [sendAt, setSendAt] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const cases = useRows<CareCase>(
    `cases?purpose=${purpose}`,
    unit,
    revision,
    onError,
  );
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      onError("Arquivo excede 5 MB.");
      return;
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const b of buffer) binary += String.fromCharCode(b);
    await act("sheet-imports", {
      layout: Number(layout),
      filename: file.name,
      content_base64: btoa(binary),
    });
  }
  return (
    <div className="op-stack">
      <Notice>
        Importar uma lista cria acompanhamentos. A prévia da campanha prepara
        mensagens em análise; nenhuma destas ações libera envio real.
      </Notice>
      {operate && (
        <div className="op-two">
          <FormAction title="Importar CROSS" label="Adicionar importação">
            {" "}
            <article className="op-card op-form">
              <h3>
                <FileSpreadsheet size={18} /> Importar CROSS
              </h3>
              <Field label="Layout validado">
                <select
                  value={layout}
                  onChange={(e) => setLayout(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {layouts
                    .filter((l) => l.verified)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} · versão {l.version}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Planilha CSV ou XLSX">
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  disabled={!layout || busy}
                  onChange={(e) =>
                    void upload(e.target.files?.[0]).catch(() => {})
                  }
                />
              </Field>
              {!layouts.some((l) => l.verified) && (
                <p className="op-muted">
                  Cadastre e valide o layout desta unidade em Administração.
                </p>
              )}
            </article>
          </FormAction>
          <FormAction title="Nova campanha" label="Adicionar campanha">
            <form
              className="op-card op-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act("campaigns", {
                  name,
                  purpose,
                  cases: selected,
                  template: Number(template),
                  scheduled_for: new Date(sendAt).toISOString(),
                })
                  .then(() => {
                    setName("");
                    setSelected([]);
                  })
                  .catch(() => {});
              }}
            >
              <h3>Nova campanha</h3>
              <Field label="Nome">
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Finalidade">
                <select
                  value={purpose}
                  onChange={(e) => {
                    setPurpose(e.target.value);
                    setSelected([]);
                  }}
                >
                  <option value="waitlist">Permanência na fila CDR</option>
                  <option value="summons">Convocação CDR</option>
                  <option value="postoperative">Pós-cirúrgico</option>
                </select>
              </Field>
              <Field label="Template">
                <select
                  required
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {templates
                    .filter((t) => t.purpose === purpose)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Data prevista">
                <input
                  required
                  type="datetime-local"
                  value={sendAt}
                  onChange={(e) => setSendAt(e.target.value)}
                />
              </Field>
              <div className="op-checklist">
                {cases
                  .filter((c) => c.purpose === purpose)
                  .map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        onChange={(e) =>
                          setSelected((v) =>
                            e.target.checked
                              ? [...v, c.id]
                              : v.filter((id) => id !== c.id),
                          )
                        }
                      />
                      {c.event.patient}
                    </label>
                  ))}
              </div>
              <button
                className="button primary"
                disabled={busy || !selected.length}
              >
                Criar rascunho · {selected.length} casos
              </button>
            </form>
          </FormAction>
        </div>
      )}
      <article className="op-card">
        <h3>Importações</h3>
        {batches.map((b) => (
          <div className="op-list-row" key={b.id}>
            <div>
              <strong>
                {b.row_count} linhas · {status[b.state || ""]}
              </strong>
              <small>
                {b.duplicates} duplicidades · {b.errors?.length || 0} erros
              </small>
              {b.errors?.slice(0, 5).map((e) => (
                <small key={`${e.line}:${e.code}`}>
                  Linha {e.line}: {e.code}
                </small>
              ))}
            </div>
            <button
              className="button"
              onClick={() =>
                request<Paginated<Record<string, string>>>(
                  query(`sheet-imports/${b.id}/rows`, { unit }),
                )
                  .then((v) => setPreview(v.results))
                  .catch((e) => onError(e.message))
              }
            >
              Ver prévia
            </button>
            {operate && b.state === "preview" && !b.errors?.length && (
              <>
                <select
                  aria-label="Finalidade da importação"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                >
                  <option value="waitlist">Permanência na fila</option>
                  <option value="summons">Convocação</option>
                </select>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void act(`sheet-imports/${b.id}/confirm`, {
                      purpose,
                    }).catch(() => {})
                  }
                >
                  Confirmar importação
                </button>
              </>
            )}
          </div>
        ))}
        {!batches.length && (
          <p className="op-muted">Nenhuma importação de planilha.</p>
        )}
        {preview.length > 0 && (
          <div className="op-table">
            <table>
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Contato</th>
                  <th>Referência</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i}>
                    <td>{r.patient}</td>
                    <td>{r.phone}</td>
                    <td>{r.external_id}</td>
                    <td>{dateTime(r.occurred_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
      <article className="op-card">
        <h3>Campanhas</h3>
        {campaigns.map((c) => (
          <div className="op-list-row" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <small>
                {purposes[c.purpose || ""]} · {c.cases?.length || 0} casos ·{" "}
                {status[c.state || ""]}
              </small>
            </div>
            {operate && c.state === "draft" && (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void act(`campaigns/${c.id}/preview`, {
                    version: c.version,
                  }).catch(() => {})
                }
              >
                Preparar prévia
              </button>
            )}
          </div>
        ))}
        {!campaigns.length && (
          <p className="op-muted">Nenhuma campanha cadastrada.</p>
        )}
      </article>
    </div>
  );
}

function Reports({
  unit,
  operate,
  revision,
  act,
  busy,
  onError,
}: Common & { operate: boolean }) {
  const reports = useRows<Row>("reports", unit, revision, onError),
    jobs = useRows<Row>("report-requests", unit, revision, onError);
  const [report, setReport] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [format, setFormat] = useState("csv");
  return (
    <div className="op-stack">
      {operate && (
        <FormAction title="Solicitar relatório" label="Solicitar relatório">
          <form
            className="op-card op-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act("report-requests", {
                report: Number(report),
                format,
                parameters: {
                  ...(start ? { start } : {}),
                  ...(end ? { end } : {}),
                },
              }).catch(() => {});
            }}
          >
            <h3>Solicitar relatório</h3>
            <div className="op-toolbar">
              <Field label="Relatório">
                <select
                  required
                  value={report}
                  onChange={(e) => setReport(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {reports
                    .filter((r) => r.enabled)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="De">
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </Field>
              <Field label="Até">
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </Field>
              <Field label="Formato">
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option value="csv">Planilha CSV</option>
                  <option value="pdf">PDF</option>
                  <option value="text">Texto</option>
                </select>
              </Field>
              <button className="button primary" disabled={busy}>
                Gerar relatório
              </button>
            </div>
          </form>
        </FormAction>
      )}
      <article className="op-card">
        <h3>Solicitações</h3>
        {jobs.map((j) => (
          <div className="op-list-row" key={j.id}>
            <div>
              <strong>{j.report_name}</strong>
              <small>
                {j.created_at && dateTime(j.created_at)} ·{" "}
                {status[j.state || ""] || j.state} ·{" "}
                {status[j.delivery_state || ""] || j.delivery_state}
              </small>
              {j.error_code && <small>{j.error_code}</small>}
            </div>
            {j.state === "ready" && (
              <a
                className="button"
                href={query(`report-requests/${j.id}/download`, { unit })}
              >
                <Download size={15} />
                Baixar {j.format?.toUpperCase()}
              </a>
            )}
          </div>
        ))}
        {!jobs.length && (
          <p className="op-muted">Nenhum relatório solicitado.</p>
        )}
      </article>
      <article className="op-card">
        <h3>Catálogo da unidade</h3>
        {reports.map((r) => (
          <div className="op-list-row" key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <small>
                {r.enabled
                  ? "Disponível"
                  : r.unavailable_reason || "Ainda não homologado"}
              </small>
            </div>
            <span className="op-pill">
              {r.enabled ? "Ativo" : "Indisponível"}
            </span>
          </div>
        ))}
      </article>
    </div>
  );
}

function Administration({
  unit,
  admin,
  revision,
  act,
  busy,
  onError,
}: Common & { admin: boolean }) {
  const preparations = useRows<Row>("preparations", unit, revision, onError),
    layouts = useRows<Row>("layouts", unit, revision, onError);
  const [code, setCode] = useState(""),
    [name, setName] = useState(""),
    [text, setText] = useState("");
  const [layoutName, setLayoutName] = useState(""),
    [mapping, setMapping] = useState({
      external_id: "",
      patient: "",
      phone: "",
      occurred_at: "",
    }),
    [evidence, setEvidence] = useState(""),
    [verified, setVerified] = useState(false);
  const labels: Record<string, string> = {
    external_id: "Coluna do identificador",
    patient: "Coluna do paciente",
    phone: "Coluna do telefone",
    occurred_at: "Coluna da data (AAAA-MM-DD)",
  };
  const [category, setCategory] = useState(admin ? "sources" : "preparations");
  type CategoryTab = [string, string, typeof Database];
  const categories: CategoryTab[] = [
    ...(admin
      ? ([
          ["sources", "Origens e regras", Database],
          ["units", "Unidades", Building2],
          ["team", "Equipe da unidade", UserRound],
          ["access", "Acesso a relatórios", ShieldCheck],
          ["schedules", "Relatórios agendados", Clock3],
        ] as CategoryTab[])
      : []),
    ["preparations", "Preparos", ClipboardList],
    ["layouts", "Layouts CROSS", FileSpreadsheet],
  ];
  return (
    <div className="admin-workspace">
      <nav
        className="admin-category-nav"
        aria-label="Cadastros administrativos"
      >
        {categories.map(([id, label, Icon]) => (
          <button
            type="button"
            key={id}
            className={category === id ? "active" : ""}
            onClick={() => setCategory(id)}
            aria-current={category === id ? "page" : undefined}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="admin-category-content" key={category}>
        {admin &&
          ["sources", "units", "team", "access", "schedules"].includes(category) && (
            <OperationsAdministration
              unit={unit}
              revision={revision}
              act={act}
              busy={busy}
              onError={onError}
              activeTab={category}
            />
          )}
        {category === "preparations" && (
          <Panel
            title="Preparos de procedimentos"
            action={
              admin ? (
                <FormAction title="Cadastro de preparo" label="Adicionar preparo">
                  <form
                    className="op-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act("preparations", {
                        procedure_code: code,
                        name,
                        text,
                      })
                        .then(() => setText(""))
                        .catch(() => {});
                    }}
                  >
                    <h3>Cadastro de preparo</h3>
                    <Field label="Código do procedimento">
                      <input
                        required
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="Ex: 0301010072"
                      />
                    </Field>
                    <Field label="Nome">
                      <input
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Nome do procedimento ou exame"
                      />
                    </Field>
                    <Field label="Orientações">
                      <textarea
                        required
                        rows={6}
                        maxLength={12000}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Orientações de preparo, jejum ou recomendações..."
                      />
                    </Field>
                    <button className="button primary" disabled={busy}>
                      Salvar nova versão
                    </button>
                  </form>
                </FormAction>
              ) : null
            }
          >
            {preparations.length ? (
              <div className="table-scroll">
                <table className="directory-table">
                  <thead>
                    <tr>
                      <th>Procedimento</th>
                      <th>Código</th>
                      <th>Versão</th>
                      <th>Situação</th>
                      <th>Orientações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preparations.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                        </td>
                        <td>
                          <span className="directory-code">{p.procedure_code}</span>
                        </td>
                        <td>
                          <span className="directory-detail" style={{ margin: 0 }}>
                            v{p.version}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`directory-status ${p.active ? "active" : "paused"}`}
                          >
                            {p.active ? "Ativo" : "Histórico"}
                          </span>
                        </td>
                        <td style={{ maxWidth: "420px" }}>
                          <details className="preparations-preview">
                            <summary>Ver orientações</summary>
                            <p className="op-prewrap">{p.text}</p>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="Nenhum preparo cadastrado nesta unidade." />
            )}
          </Panel>
        )}
        {category === "layouts" && (
          <Panel
            title="Layouts de importação CROSS"
            action={
              admin ? (
                <FormAction
                  title="Layout de importação CROSS"
                  label="Adicionar layout CROSS"
                >
                  <form
                    className="op-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act("layouts", {
                        name: layoutName,
                        mapping,
                        evidence,
                        verified,
                      }).catch(() => {});
                    }}
                  >
                    <h3>Layout de importação CROSS</h3>
                    <Field label="Nome do layout">
                      <input
                        required
                        value={layoutName}
                        onChange={(e) => setLayoutName(e.target.value)}
                        placeholder="Ex: Layout CROSS Ambulatorial"
                      />
                    </Field>
                    {Object.entries(mapping).map(([k, v]) => (
                      <Field key={k} label={labels[k]}>
                        <input
                          required
                          value={v}
                          onChange={(e) =>
                            setMapping({ ...mapping, [k]: e.target.value })
                          }
                          placeholder="Nome da coluna no CSV"
                        />
                      </Field>
                    ))}
                    <Field label="Referência da validação">
                      <textarea
                        value={evidence}
                        onChange={(e) => setEvidence(e.target.value)}
                        maxLength={4000}
                        rows={3}
                        placeholder="Referência da validação com a unidade..."
                      />
                    </Field>
                    <label className="op-check">
                      <input
                        type="checkbox"
                        checked={verified}
                        onChange={(e) => setVerified(e.target.checked)}
                      />
                      Layout conferido com a unidade
                    </label>
                    <button className="button primary" disabled={busy}>
                      Cadastrar layout
                    </button>
                  </form>
                </FormAction>
              ) : null
            }
          >
            {layouts.length ? (
              <div className="table-scroll">
                <table className="directory-table">
                  <thead>
                    <tr>
                      <th>Nome do layout</th>
                      <th>Mapeamento de colunas</th>
                      <th>Validação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {layouts.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <strong>{l.name}</strong>
                        </td>
                        <td>
                          <div className="mapping-chips">
                            {l.mapping &&
                              Object.entries(
                                l.mapping as Record<string, string>,
                              ).map(([k, v]) => (
                                <span key={k} className="mapping-chip">
                                  <small>{labels[k] || k}:</small> {v}
                                </span>
                              ))}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`directory-status ${l.verified ? "active" : "paused"}`}
                          >
                            {l.verified ? "Validado" : "Pendente de validação"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="Nenhum layout CROSS cadastrado." />
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
