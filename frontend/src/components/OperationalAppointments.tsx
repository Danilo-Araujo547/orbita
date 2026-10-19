import FilterSelect from "./FilterSelect";
import WhatsAppStatus from "./WhatsAppStatus";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  MessageSquare,
  Search,
  User,
  X,
} from "lucide-react";
import { query, request } from "../api";
import { dateTime, kinds, labels } from "../format";
import type { Appointment, Issue, Paginated } from "../types";
import AppointmentMessagesModal from "./AppointmentMessagesModal";
import AppointmentResponseModal from "./AppointmentResponseModal";
import ObservationModal from "./ObservationModal";
import { AppointmentDetail } from "./OperationsWorkspace";

const responseLabels: Record<string, string> = {
  pending: "Aguardando",
  not_requested: "Não solicitado",
  no_response: "Sem resposta no prazo",
  answered: "Respondido",
  reason_received: "Motivo informado",
  stay_waitlist: "Permanece na fila",
  leave_waitlist: "Saiu da fila",
  well: "Informou estar bem",
  needs_attention: "Requer atendimento",
  acknowledged: "Ciente",
  confirmed: "Confirmou",
  declined: "Recusou",
  review: "Revisar",
  wrong_person: "Não conhece o paciente",
  opt_out: "Não receber mensagens",
  not_queued: "Sem envio",
};

function responseLabel(item: Appointment, now: number) {
  const status = item.tracking?.outcome || item.tracking?.response || "pending";
  if (status === "pending") {
    const delivered = Date.parse(item.tracking?.awaiting_since || "");
    if (Number.isFinite(delivered)) {
      const hours = Math.floor(Math.max(0, now - delivered) / 3_600_000);
      return `Aguardando há ${hours} ${hours === 1 ? "hora" : "horas"}`;
    }
  }
  return responseLabels[status] || labels[status] || status;
}

function pendingIssueLabel(item: Appointment, now: number) {
  if (item.tracking?.response !== "pending" || item.tracking?.outcome)
    return responseLabel(item, now);
  const deliveries = item.tracking.contacts.map((contact) => contact.delivery);
  if (deliveries.includes("uncertain")) return "Resultado incerto";
  if (deliveries.includes("failed")) return "Falha de entrega";
  if (deliveries.includes("blocked")) return "Entrega bloqueada";
  return "Correção pendente";
}

export function isAppointmentIssue(item: Appointment): boolean {
  const outcome = (item.tracking?.outcome || "").toLowerCase();
  const response = (item.tracking?.response || "").toLowerCase();
  if (outcome === "confirmed" || response === "confirmed") return false;

  // 1. Responderam não (recusou)
  if (outcome === "declined" || response === "declined") {
    return true;
  }

  // 2. Outros problemas de resposta ou decisão
  if (
    outcome === "needs_attention" ||
    response === "needs_attention" ||
    outcome === "review" ||
    response === "review" ||
    outcome === "wrong_person" ||
    response === "wrong_person" ||
    outcome === "opt_out" ||
    response === "opt_out" ||
    outcome === "no_response" ||
    response === "no_response"
  ) {
    return true;
  }

  // 3. Correções abertas
  if ((item.tracking?.corrections ?? 0) > 0) {
    return true;
  }

  // 4. Deu número inválido, falha de entrega ou contato com problema
  if (item.tracking?.contacts?.length) {
    const hasContactProblem = item.tracking.contacts.some((contact) => {
      const status = (contact.status || "").toLowerCase();
      const delivery = (contact.delivery || "").toLowerCase();
      const resp = (contact.response || "").toLowerCase();
      return (
        Boolean(contact.opted_out) ||
        status === "invalid" ||
        status === "wrong_person" ||
        delivery === "failed" ||
        delivery === "blocked" ||
        delivery === "uncertain" ||
        resp === "declined" ||
        resp === "wrong_person" ||
        resp === "opt_out"
      );
    });
    if (hasContactProblem) {
      return true;
    }
  } else if (!item.phone) {
    return true;
  }

  return false;
}

export default function OperationalAppointments({
  unit,
  role,
  username,
  initialId,
  refreshKey,
  start,
  end,
  issuesOnly = false,
  groupId,
  periodFilter,
}: {
  unit: string;
  role: string;
  username: string;
  initialId?: number | null;
  refreshKey: number;
  start: string;
  end: string;
  issuesOnly?: boolean;
  groupId?: string;
  periodFilter?: ReactNode;
}) {
  const [items, setItems] = useState<Paginated<Appointment>>({
    count: 0,
    results: [],
    next: null,
    previous: null,
  });
  const [filters, setFilters] = useState({
    search: "",
    date_basis: "appointment",
    kind: "",
    response: "",
    outcome: "",
    delivery: "",
    corrections: "",
    observations: "",
  });
  const [typeOptions, setTypeOptions] = useState<{value: string; label: string; group: string}[]>([]);
  useEffect(() => {
    let active = true;
    request<{value: string; label: string; group: string}[]>(query("agenda-items/types", {unit}))
      .then(options => {if (active) setTypeOptions(options);})
      .catch(error => {if (active) setError(error.message);});
    return () => {active = false;};
  }, [unit, refreshKey]);
  const [issueFilter, setIssueFilter] = useState("all");
  const handleIssueFilterChange = (value: string) => {
    setIssueFilter(value);
    setPage(1);
    setFilters((v) => {
      switch (value) {
        case "declined":
          return {
            ...v,
            outcome: "declined",
            response: "",
            delivery: "",
            corrections: "",
          };
        case "invalid":
          return {
            ...v,
            outcome: "",
            response: "",
            delivery: "failed",
            corrections: "",
          };
        case "review":
          return {
            ...v,
            outcome: "review",
            response: "",
            delivery: "",
            corrections: "",
          };
        case "corrections":
          return {
            ...v,
            outcome: "",
            response: "",
            delivery: "",
            corrections: "true",
          };
        case "no_response":
          return {
            ...v,
            outcome: "",
            response: "no_response",
            delivery: "",
            corrections: "",
          };
        default:
          return {
            ...v,
            outcome: "",
            response: "",
            delivery: "",
            corrections: "",
          };
      }
    });
  };
  const [messageItem, setMessageItem] = useState<Appointment | null>(null);
  const [responseItem, setResponseItem] = useState<{
    item: Appointment;
    initialOutcome?: "confirmed" | "declined";
  } | null>(null);
  const [noteItem, setNoteItem] = useState<Appointment | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [page, setPage] = useState(1),
    [revision, refresh] = useState(0),
    [selected, select] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    refresh((v) => v + 1);
  }, [refreshKey]);
  const params = {
    unit,
    start,
    end,
    ...filters,
    operational_pending: issuesOnly ? "true" : "",
    group: groupId || "",
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    request<Paginated<Appointment>>(
      query("agenda-items", { ...params, page: String(page) }),
    )
      .then((result) => {
        if (active) {
          setItems(result);
          setError("");
        }
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [unit, start, end, filters, page, revision, issuesOnly, groupId]);
  useEffect(() => {
    if (!initialId) return;
    let active = true;
    request<Appointment>(query(`agenda-items/${initialId}`, { unit }))
      .then((item) => {
        if (active) select(item.tracking?.id || null);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [initialId, unit]);
  const act = useCallback(
    async (path: string, data: unknown) => {
      setBusy(true);
      setError("");
      try {
        const result = await request(
          `/api/v1/${path}/?unit=${encodeURIComponent(unit)}`,
          "POST",
          data,
        );
        refresh((v) => v + 1);
        return result;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [unit],
  );
  function filter(key: keyof typeof filters, value: string) {
    setFilters((v) => ({ ...v, [key]: value, ...(key === "kind" ? {response: "", outcome: ""} : {}) }));
    setPage(1);
  }
  const contextualOutcomes: Record<string, string[]> = {
    "cross:absence": ["reason_received"], "cross:waitlist": ["stay_waitlist", "leave_waitlist"],
    "cross:summons": ["acknowledged"], "cross:postoperative": ["well", "needs_attention"],
    "cross:movement": ["acknowledged"],
  };
  const responseOptions = [...new Set(["pending", "no_response", "answered", "confirmed", "declined", "review",
    ...(filters.kind ? contextualOutcomes[filters.kind] || [] : typeOptions.flatMap(option => contextualOutcomes[option.value] || []))])];
  const displayedItems = issuesOnly
    ? items.results.filter(isAppointmentIssue)
    : items.results;

  return (
    <section
      className="operations-workspace appointments-workspace"
      aria-label={
        issuesOnly ? "Pendências operacionais" : "Agendamentos operacionais"
      }
    >
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {messageItem && (
        <AppointmentMessagesModal
          groupId={groupId}
          item={messageItem}
          unit={unit}
          onClose={() => setMessageItem(null)}
        />
      )}
      {responseItem?.item?.tracking?.id && (
        <AppointmentResponseModal
          item={responseItem.item}
          initialOutcome={responseItem.initialOutcome}
          unit={unit}
          onClose={() => setResponseItem(null)}
          save={(version, values) =>
            act(`cases/${responseItem.item.tracking!.id}/act`, {
              version,
              action: "record_response",
              ...values,
            })
          }
        />
      )}
      {noteItem?.tracking?.id && (
        <ObservationModal
          unit={unit}
          trackingId={noteItem.tracking.id}
          patient={noteItem.patient}
          canEdit={role === "admin" || role === "operator"}
          save={async (version, text, options) => {
            const resolveCase = options?.resolveCase ?? true;
            const interlocutor = options?.interlocutor;
            const fullText = resolveCase ? `[Caso resolvido] ${text}` : text;
            await act(`cases/${noteItem.tracking!.id}/act`, {
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
                    iss.case === noteItem.tracking!.id ||
                    (noteItem.id && iss.appointment === noteItem.id),
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
          onClose={() => setNoteItem(null)}
        />
      )}
      {selected ? (
        <AppointmentDetail
          key={`${unit}:${selected}`}
          id={selected}
          unit={unit}
          username={username}
          operate={role === "admin" || role === "operator"}
          revision={revision}
          act={act}
          busy={busy}
          onError={setError}
          onBack={() => select(null)}
        />
      ) : (
        <>
          <div className="op-heading">
            <span className="appointment-result-count">
              <strong>{items.count}</strong>{" "}
              {issuesOnly
                ? items.count === 1
                  ? "pendência"
                  : "pendências"
                : !filters.kind || filters.kind.startsWith("cross:") ? "registros" : "agendamentos"}
            </span>
            <div className="appointment-list-actions">
              {periodFilter}
              <a className="button" href={query("agenda-items/export", params)}>
                <Download size={16} /> Exportar
              </a>
            </div>
          </div>
          <div className="op-card op-appointment-filters">
            <label className="op-field">
              <span>
                <Search size={14} /> Paciente, código ou número
              </span>
              <input
                value={filters.search}
                onChange={(e) => filter("search", e.target.value)}
                placeholder="Buscar agendamento"
              />
            </label>
            <label className="op-field">
              <span>Período referente a</span>
              <FilterSelect label="Período referente a"
                value={filters.date_basis}
                onChange={(e) => filter("date_basis", e.target.value)}
              >
                <option value="appointment">Data do agendamento / registro</option>
                <option value="send">Data prevista do envio</option>
                <option value="reply">Data da resposta</option>
              </FilterSelect>
            </label>
            <label className="op-field">
              <span>Tipo</span>
              <FilterSelect label="Tipo"
                value={filters.kind}
                onChange={(e) => filter("kind", e.target.value)}
              >
                <option value="">Todos</option>
                {typeOptions.map(option => (
                  <option key={option.value} value={option.value} data-group={option.group}>
                    {option.label}
                  </option>
                ))}
              </FilterSelect>
            </label>
            {issuesOnly ? (
              <label className="op-field">
                <span>Tipo de pendência</span>
                <FilterSelect label="Tipo de pendência"
                  value={issueFilter}
                  onChange={(e) => handleIssueFilterChange(e.target.value)}
                >
                  <option value="all">Todas as pendências</option>
                  <option value="declined">Recusou (respondeu não)</option>
                  <option value="invalid">
                    Número inválido / falha de entrega
                  </option>
                  <option value="review">Aguardando revisão</option>
                  <option value="corrections">Com correções abertas</option>
                  <option value="no_response">Sem resposta no prazo</option>
                </FilterSelect>
              </label>
            ) : (
              <>
                <label className="op-field">
                  <span>Resposta consolidada</span>
                  <FilterSelect label="Resposta consolidada"
                    value={filters.outcome || filters.response}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFilters((v) => ({
                        ...v,
                        response: ["pending", "no_response", "answered"].includes(value)
                          ? value
                          : "",
                        outcome: ["pending", "no_response", "answered"].includes(value)
                          ? ""
                          : value,
                      }));
                      setPage(1);
                    }}
                  >
                    <option value="">Todas</option>
                    {responseOptions.map((k) => (
                      <option key={k} value={k}>
                        {responseLabels[k]}
                      </option>
                    ))}
                  </FilterSelect>
                </label>
                <label className="op-field">
                  <span>Entrega por contato</span>
                  <FilterSelect label="Entrega por contato"
                    value={filters.delivery}
                    onChange={(e) => filter("delivery", e.target.value)}
                  >
                    <option value="">Todas</option>
                    {[
                      "preview",
                      "queued",
                      "accepted",
                      "delivered",
                      "read",
                      "failed",
                      "uncertain",
                      "blocked",
                    ].map((k) => (
                      <option key={k} value={k}>
                        {labels[k] || k}
                      </option>
                    ))}
                  </FilterSelect>
                </label>
              </>
            )}
            <label className="op-field">
              <span>Intervenções</span>
              <FilterSelect label="Intervenções"
                value={
                  filters.corrections
                    ? "corrections"
                    : filters.observations === "false"
                      ? "no_observations"
                      : filters.observations === "true"
                        ? "observations"
                        : ""
                }
                onChange={(e) => {
                  setFilters((v) => ({
                    ...v,
                    corrections: e.target.value === "corrections" ? "true" : "",
                    observations:
                      e.target.value === "observations"
                        ? "true"
                        : e.target.value === "no_observations"
                          ? "false"
                          : "",
                  }));
                  setPage(1);
                }}
              >
                <option value="">Todas</option>
                <option value="corrections">Com correções abertas</option>
                <option value="observations">Com observação ou ligação</option>
                <option value="no_observations">Sem observação</option>
              </FilterSelect>
            </label>
          </div>
          <div className="op-card appointment-table-wrap" aria-busy={loading}>
            <table className="appointment-table">
              <colgroup>
                <col style={{ width: "20%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "16%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Paciente / origem</th>
                  <th>Agendamento</th>
                  <th>Contatos e comunicações</th>
                  <th>Resposta</th>
                  <th>Intervenções</th>
                </tr>
              </thead>
              <tbody>
                {displayedItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="patient-cell">
                        <span className="patient-icon" aria-hidden="true">
                          <User size={15} />
                        </span>
                        <div>
                          <button
                            className="op-patient-link"
                            disabled={!item.tracking?.id}
                            onClick={() => select(item.tracking?.id || null)}
                          >
                            {item.patient}
                          </button>
                          <small>
                            {item.patient_external_id
                              ? `Paciente ${item.patient_external_id} · `
                              : ""}
                            {item.external_id}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{item.procedure}</strong>
                      <small>
                        {dateTime(item.scheduled_at)} ·{" "}
                        {item.kind_label || kinds[item.kind] || item.kind}
                      </small>
                      {item.professional && (
                        <small className="appointment-professional">
                          <User
                            size={12}
                            style={{
                              display: "inline-block",
                              verticalAlign: "text-bottom",
                              marginRight: "4px",
                            }}
                            aria-hidden="true"
                          />
                          {item.professional}
                          {item.city ? ` · ${item.city}` : ""}
                        </small>
                      )}
                    </td>
                    <td>
                      {item.tracking?.contacts?.length ? (
                        item.tracking.contacts.map((contact, idx) => (
                          <div
                            className="op-contact-delivery"
                            key={contact.phone || idx}
                          >
                            <strong>{contact.phone || "Sem número"}</strong>
                            <small>
                              {labels[contact.delivery] ||
                                responseLabels[contact.delivery] ||
                                contact.delivery}{" "}
                              {!(
                                issuesOnly && contact.response === "pending"
                              ) && (
                                <>
                                  {" "}
                                  ·{" "}
                                  {responseLabels[contact.response] ||
                                    contact.response}
                                </>
                              )}
                            </small>
                            {(contact.opted_out ||
                              ["invalid", "wrong_person"].includes(
                                contact.status || "",
                              )) && (
                              <small className="op-pill danger">
                                {contact.opted_out
                                  ? "Não receber mensagens"
                                  : contact.status === "invalid"
                                    ? "Contato inválido"
                                    : "Não conhece o paciente"}
                              </small>
                            )}
                          </div>
                        ))
                      ) : item.phone ? (
                        <div className="op-contact-delivery">
                          <strong>{item.phone}</strong>
                          <small>Sem envio</small>
                        </div>
                      ) : (
                        <span className="op-muted">Sem contato</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`op-pill response-status-${item.tracking?.outcome || "pending"} ${item.tracking?.outcome === "review" ? "danger" : ""}`}
                      >
                        {item.tracking?.outcome === "confirmed" && (
                          <Check
                            size={11}
                            strokeWidth={2.5}
                            aria-hidden="true"
                          />
                        )}
                        {item.tracking?.outcome === "declined" && (
                          <X size={11} strokeWidth={2.5} aria-hidden="true" />
                        )}
                        {issuesOnly
                          ? pendingIssueLabel(item, now)
                          : responseLabel(item, now)}
                      </span>
                      {(role === "admin" || role === "operator") &&
                        item.tracking?.id &&
                        item.record_type !== "cross" &&
                        ["pending", "no_response"].includes(
                          item.tracking.response,
                        ) && (
                          <div className="appointment-response-actions">
                            <button
                              type="button"
                              className="response-quick-btn confirm"
                              onClick={() =>
                                setResponseItem({
                                  item,
                                  initialOutcome: "confirmed",
                                })
                              }
                              title="Registrar confirmação deste agendamento"
                            >
                              <Check
                                size={11}
                                strokeWidth={2.5}
                                aria-hidden="true"
                              />
                              <span>Confirmar</span>
                            </button>
                            <button
                              type="button"
                              className="response-quick-btn decline"
                              onClick={() =>
                                setResponseItem({
                                  item,
                                  initialOutcome: "declined",
                                })
                              }
                              title="Registrar recusa deste agendamento"
                            >
                              <X
                                size={11}
                                strokeWidth={2.5}
                                aria-hidden="true"
                              />
                              <span>Recusar</span>
                            </button>
                          </div>
                        )}
                    </td>
                    <td>
                      <button
                        className="button op-note-button"
                        disabled={!item.tracking?.id}
                        onClick={() => setNoteItem(item)}
                      >
                        <MessageSquare size={13} aria-hidden="true" />
                        <span>Observações</span>
                        {!!item.tracking?.observations && (
                          <span className="appointment-note-count">
                            {item.tracking.observations}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="button appointment-message-button"
                        onClick={() => setMessageItem(item)}
                      >
                        <WhatsAppStatus appointment={item} />
                        <span>Ver mensagem</span>
                      </button>
                      {!!item.tracking?.corrections && (
                        <span className="op-pill danger">
                          {item.tracking.corrections}{" "}
                          {item.tracking.corrections === 1
                            ? "correção"
                            : "correções"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!displayedItems.length && (
              <p className="op-muted">
                {loading
                  ? "Carregando…"
                  : issuesOnly
                    ? "Nenhuma pendência para os filtros selecionados."
                    : "Nenhum agendamento para os filtros selecionados."}
              </p>
            )}
          </div>
          <div className="op-pager">
            <span>
              {items.count} registros · página {page}
            </span>
            <button
              className="button"
              disabled={page === 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={15} /> Anterior
            </button>
            <button
              className="button"
              disabled={!items.next || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima <ChevronRight size={15} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
