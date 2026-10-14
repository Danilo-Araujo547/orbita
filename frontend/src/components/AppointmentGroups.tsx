import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, CalendarClock, ChevronRight, Pencil } from "lucide-react";
import { query, request } from "../api";
import { kinds } from "../format";
import type { Paginated } from "../types";
import InlineDialog from "./InlineDialog";
import OperationalAppointments from "./OperationalAppointments";

type Group = {
  id: string;
  kind: string;
  appointment_date: string;
  rule_name: string;
  rule_version: number;
  scheduled_for: string;
  delay_seconds: number;
  version: number;
  appointments_total: number;
  appointments_sent: number;
  messages_total: number;
  messages_sent: number;
  messages_delivered: number;
  messages_pending: number;
  paused: boolean;
};
const day = (value: string) => value.split("-").reverse().join("/");
const sendDate = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export function groupInputTime(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (name: string) => parts.find((p) => p.type === name)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function groupInputToIso(value: string) {
  const guess = new Date(`${value}:00Z`);
  const offset =
    new Intl.DateTimeFormat("en", {
      timeZone: "America/Sao_Paulo",
      timeZoneName: "longOffset",
    })
      .formatToParts(guess)
      .find((p) => p.type === "timeZoneName")
      ?.value.replace("GMT", "") || "+00:00";
  return new Date(`${value}:00${offset}`).toISOString();
}

function ScheduleDialog({
  group,
  unit,
  onClose,
  onSaved,
}: {
  group: Group;
  unit: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [stamp, setStamp] = useState(groupInputTime(group.scheduled_for));
  const [delay, setDelay] = useState(String(group.delay_seconds));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(
        query(`appointment-groups/${group.id}/schedule`, { unit }),
        "POST",
        {
          version: group.version,
          scheduled_for: groupInputToIso(stamp),
          delay_seconds: Number(delay),
        },
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <InlineDialog
      title="Editar envio do grupo"
      subtitle={`${kinds[group.kind] || group.kind} · ${day(group.appointment_date)}`}
      busy={busy}
      onClose={onClose}
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
            className="button primary"
            disabled={busy}
          >
            {busy ? "Salvando…" : "Salvar programação"}
          </button>
        </footer>
      }
    >
      <form
        id={formId}
        className="group-schedule-form"
        onSubmit={(event) => void save(event)}
      >
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <label className="op-field">
          <span>Data e hora do envio · Brasília</span>
          <input
            type="datetime-local"
            required
            value={stamp}
            onChange={(e) => setStamp(e.target.value)}
          />
        </label>
        <label className="op-field">
          <span>Intervalo entre mensagens (segundos)</span>
          <input
            type="number"
            required
            min="0"
            max="3600"
            step="1"
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
          />
        </label>

        {group.paused && (
          <p className="group-edit-description">Envios pausados.</p>
        )}
      </form>
    </InlineDialog>
  );
}

export default function AppointmentGroups({
  unit,
  role,
  username,
  groupId,
  onOpen,
  onBack,
  refreshKey,
}: {
  unit: string;
  role: string;
  username: string;
  groupId: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
  refreshKey: number;
}) {
  const [page, setPage] = useState(1),
    [revision, refresh] = useState(0);
  const [filters, setFilters] = useState({ kind: "", start: "", end: "" });
  const [list, setList] = useState<Paginated<Group>>({
    count: 0,
    results: [],
    next: null,
    previous: null,
  });
  const [group, setGroup] = useState<Group | null>(null),
    [editing, setEditing] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setGroup(null);
    const url = groupId
      ? query(`appointment-groups/${groupId}`, { unit })
      : query("appointment-groups", { unit, page: String(page), ...filters });
    request<Group | Paginated<Group>>(url)
      .then((result) => {
        if (!active) return;
        if (groupId) setGroup(result as Group);
        else setList(result as Paginated<Group>);
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [unit, groupId, page, filters, revision, refreshKey]);
  function filter(key: keyof typeof filters, value: string) {
    setFilters((v) => ({ ...v, [key]: value }));
    setPage(1);
  }
  return (
    <section
      className="operations-workspace groups-workspace"
      aria-label="Grupos de agendamentos"
    >
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {editing && (
        <ScheduleDialog
          key={`${editing.id}:${editing.version}`}
          group={editing}
          unit={unit}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh((v) => v + 1);
          }}
        />
      )}
      <div className="op-heading">
        {groupId ? (
          <button className="button" onClick={onBack}>
            <ArrowLeft size={16} />
            Voltar aos grupos
          </button>
        ) : (
          <span className="appointment-result-count">
            <strong>{list.count}</strong> grupos
          </span>
        )}
      </div>
      {!groupId && (
        <div className="op-card group-filters">
          <label className="op-field">
            <span>Tipo de agendamento</span>
            <select
              value={filters.kind}
              onChange={(e) => filter("kind", e.target.value)}
            >
              <option value="">Todos</option>
              {["consultation", "exam", "lab"].map((k) => (
                <option key={k} value={k}>
                  {kinds[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="op-field">
            <span>Atendimentos a partir de</span>
            <input
              type="date"
              value={filters.start}
              onChange={(e) => filter("start", e.target.value)}
            />
          </label>
          <label className="op-field">
            <span>Atendimentos até</span>
            <input
              type="date"
              value={filters.end}
              onChange={(e) => filter("end", e.target.value)}
            />
          </label>
        </div>
      )}
      {loading ? (
        <p role="status">Carregando grupos…</p>
      ) : groupId && group ? (
        <>
          <div className="op-card group-summary">
            <div className="group-summary-heading">
              <div>
                <h2>
                  {kinds[group.kind] || group.kind} ·{" "}
                  {day(group.appointment_date)}
                </h2>
                <p>{group.rule_name}</p>
              </div>
              {role === "admin" && (
                <button className="button" onClick={() => setEditing(group)}>
                  <Pencil size={15} />
                  Editar envio
                </button>
              )}
            </div>
            <div className="group-stats">
              <div>
                <span>Agendamentos únicos</span>
                <strong>{group.appointments_total}</strong>
              </div>
              <div>
                <span>Com pelo menos um envio aceito</span>
                <strong>{group.appointments_sent}</strong>
              </div>
              <div>
                <span>Mensagens enviadas / previstas</span>
                <strong>
                  {group.messages_sent} / {group.messages_total}
                </strong>
              </div>
              <div>
                <span>Entregues ou lidas</span>
                <strong>{group.messages_delivered}</strong>
              </div>
            </div>
            <p>
              <CalendarClock size={16} /> Envio:{" "}
              <strong>{sendDate(group.scheduled_for)}</strong> · Intervalo:{" "}
              <strong>{group.delay_seconds}s</strong>
              {group.paused ? " · Envios pausados" : ""}
            </p>
          </div>
          <OperationalAppointments
            key={`${unit}:${groupId}`}
            unit={unit}
            role={role}
            username={username}
            groupId={groupId}
            refreshKey={revision + refreshKey}
            start=""
            end=""
          />
        </>
      ) : !groupId ? (
        <>
          <div className="op-card group-table-wrap">
            <table className="group-table">
              <thead>
                <tr>
                  <th>Grupo / atendimento</th>
                  <th>Agendamentos</th>
                  <th>Enviados</th>
                  <th>Mensagens</th>
                  <th>Programação do envio</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {list.results.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button
                        className="group-title"
                        onClick={() => onOpen(item.id)}
                      >
                        {kinds[item.kind] || item.kind} ·{" "}
                        {day(item.appointment_date)}
                      </button>
                      <small>{item.rule_name}</small>
                    </td>
                    <td>
                      <strong>{item.appointments_total}</strong>
                    </td>
                    <td title="Agendamentos com ao menos uma mensagem aceita pelo provedor">
                      {item.appointments_sent}
                    </td>
                    <td>
                      {item.messages_sent} / {item.messages_total}
                      <small>Enviadas / previstas por número</small>
                    </td>
                    <td>
                      {sendDate(item.scheduled_for)}
                      <small>
                        Intervalo: {item.delay_seconds}s
                        {item.paused ? " · Pausado" : ""}
                      </small>
                    </td>
                    <td>
                      <div className="group-actions">
                        <button
                          className="button"
                          onClick={() => onOpen(item.id)}
                          aria-label={`Ver agendamentos de ${kinds[item.kind]} em ${day(item.appointment_date)}`}
                        >
                          Ver
                          <ChevronRight size={15} />
                        </button>
                        {role === "admin" && (
                          <button
                            className="icon-button"
                            title="Editar envio"
                            aria-label={`Editar envio de ${kinds[item.kind]} em ${day(item.appointment_date)}`}
                            onClick={() => setEditing(item)}
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.results.length && (
              <p>Nenhum grupo para os filtros selecionados.</p>
            )}
          </div>
          <div className="op-pager">
            <button
              className="button"
              disabled={!list.previous}
              onClick={() => setPage((v) => v - 1)}
            >
              Anteriores
            </button>
            <span>
              {list.count} grupos · página {page}
            </span>
            <button
              className="button"
              disabled={!list.next}
              onClick={() => setPage((v) => v + 1)}
            >
              Próximos
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
