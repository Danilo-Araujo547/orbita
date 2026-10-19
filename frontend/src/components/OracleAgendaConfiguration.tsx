import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  MessageSquare,
  Phone,
  Reply,
  Search,
  Sparkles,
} from "lucide-react";
import { request } from "../api";
import { Panel } from "./ui";
import InlineDialog from "./InlineDialog";
import { dateTime } from "../format";
import SendCalendar, { weekdayNames } from "./SendCalendar";
import type { DayPolicy } from "./SendCalendar";

type Column = { name: string; type: string };
type Binding = { column: string; format: string };
type Remote = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  supported: boolean;
  unsupported_reason: string;
  parameter_keys: string[];
  components: {
    type: string;
    text?: string;
    buttons?: { type: string; text: string }[];
  }[];
};
type Config = {
  name: string;
  kind: string;
  id: number;
  version: number;
  view_name: string;
  columns: Column[];
  column_mapping: Record<string, string | string[]>;
  template_id: string;
  template_name: string;
  parameter_mapping: Record<string, Binding>;
  horizon_days: number;
  days_before: number;
  send_time: string;
  send_weekdays: number[];
  blocked_day_policy: DayPolicy;
  enabled: boolean;
  last_state: string;
  last_error: string;
  last_completed_at: string | null;
  window_start: string;
  window_end: string;
  appointment_count: number;
  covered_days: number;
  days: { date: string; row_count: number; appointment_count: number }[];
};
type Archived = {
  id: number;
  name: string;
  version: number;
  view_name: string;
  deleted_at: string;
};
type Payload = {
  configurations: Config[];
  archived_configurations: Archived[];
  archived_configuration: {
    id: number;
    version: number;
    view_name: string;
    deleted_at: string;
  } | null;
  configuration: Config | null;
  templates: Remote[];
  default_columns: Record<string, string | string[]>;
};
const fields = [
  ["external_id", "Código do agendamento"],
  ["patient_external_id", "Código do paciente"],
  ["patient", "Nome do paciente"],
  ["date", "Data da consulta"],
  ["time", "Horário"],
  ["arrival_time", "Horário de chegada"],
  ["procedure", "Especialidade"],
  ["appointment_type", "Tipo"],
  ["professional", "Profissional"],
];
const required = new Set(["external_id", "patient", "date", "time"]);
const states: Record<string, string> = {
  pending: "Não importado",
  scheduled: "Aguardando importação",
  running: "Importando",
  completed: "Atualizado",
  failed: "Falha na importação",
};
const kinds: Record<string, string> = {
  consultation: "Consulta",
  exam: "Exame",
  lab: "Laboratório",
};

export default function OracleAgendaConfiguration({ unit }: { unit: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Config | null | undefined>(undefined);
  const [selected, setSelected] = useState<number | null>(null);
  const [removing, setRemoving] = useState<Config | null>(null);
  const endpoint = "/api/v1/oracle-agendas/";
  const load = useCallback(async () => {
    setData(
      await request<Payload>(endpoint + "?unit=" + encodeURIComponent(unit)),
    );
  }, [unit]);
  useEffect(() => {
    setData(null);
    setSelected(null);
    setEditing(undefined);
    setRemoving(null);
    void load().catch((e) => setError(e.message));
  }, [load]);
  const running = data?.configurations.some((c) =>
    ["scheduled", "running"].includes(c.last_state),
  );
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => void load().catch((e) => setError(e.message)),
      4000,
    );
    return () => window.clearInterval(timer);
  }, [running, load]);
  async function act(
    action: string,
    record: Config | Archived,
    refresh = false,
  ) {
    setBusy(true);
    setError("");
    try {
      setData(
        await request<Payload>(
          endpoint + action + "/?unit=" + encodeURIComponent(unit),
          "POST",
          {
            id: record.id,
            version: record.version,
            ...(action === "synchronize" ? { refresh } : {}),
          },
        ),
      );
      setRemoving(null);
      if (action === "remove") setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const config = data?.configurations.find((c) => c.id === selected);
  return (
    <Panel
      title="Agendas Oracle"
      action={
        <button
          className="button primary"
          disabled={busy || !data}
          onClick={() => setEditing(null)}
        >
          Nova agenda
        </button>
      }
    >
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <p>Carregando…</p>
      ) : (
        <>
          {!data.configurations.length ? (
            <p>Nenhuma agenda configurada.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Agenda</th>
                    <th>Origem</th>
                    <th>Template</th>
                    <th>Importação</th>
                    <th>Agendamentos</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.configurations.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        <br />
                        <small>{kinds[c.kind]}</small>
                      </td>
                      <td>
                        <span className="oracle-origin-name">
                          {c.view_name}
                        </span>
                      </td>
                      <td>{c.template_name}</td>
                      <td>
                        {c.enabled ? "Ativa" : "Pausada"}
                        <br />
                        <small>{states[c.last_state] || c.last_state}</small>
                      </td>
                      <td>
                        {c.appointment_count}
                        <br />
                        <small>
                          {c.covered_days}/{c.horizon_days} dias
                        </small>
                      </td>
                      <td>
                        <div className="panel-actions-group">
                          <button
                            className="button"
                            onClick={() => setSelected(c.id)}
                          >
                            Detalhes
                          </button>
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() => setEditing(c)}
                          >
                            Editar
                          </button>
                          <button
                            className="button danger"
                            disabled={busy}
                            onClick={() => setRemoving(c)}
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!!data.archived_configurations.length && (
            <details className="oracle-archived">
              <summary>
                Excluídas ({data.archived_configurations.length})
              </summary>
              {data.archived_configurations.map((c) => (
                <div className="oracle-archived-row" key={c.id}>
                  <span>
                    <strong>{c.name}</strong>
                    <br />
                    <small>{c.view_name}</small>
                  </span>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void act("restore", c)}
                  >
                    Restaurar
                  </button>
                </div>
              ))}
            </details>
          )}
        </>
      )}
      {config && (
        <InlineDialog
          title={config.name}
          subtitle=""
          busy={busy}
          onClose={() => setSelected(null)}
          footer={
            <footer className="form-action-footer">
              <button
                className="button"
                disabled={
                  busy || ["running", "scheduled"].includes(config.last_state)
                }
                onClick={() => void act("synchronize", config)}
              >
                Completar janela
              </button>
              <button
                className="button primary"
                disabled={
                  busy || ["running", "scheduled"].includes(config.last_state)
                }
                onClick={() => void act("synchronize", config, true)}
              >
                Atualizar dados
              </button>
            </footer>
          }
        >
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <dl className="agenda-config-summary">
            <div>
              <dt>View</dt>
              <dd>{config.view_name}</dd>
            </div>
            <div>
              <dt>Template</dt>
              <dd>{config.template_name}</dd>
            </div>
            <div>
              <dt>Janela</dt>
              <dd>
                {config.horizon_days} dias ·{" "}
                {config.window_start.split("-").reverse().join("/")} a{" "}
                {config.window_end.split("-").reverse().join("/")}
              </dd>
            </div>
            <div>
              <dt>Programação do lembrete</dt>
              <dd>
                {config.days_before} dias antes · {config.send_time.slice(0, 5)}
              </dd>
            </div>
            <div>
              <dt>Última execução</dt>
              <dd>
                {states[config.last_state]} ·{" "}
                {config.last_completed_at
                  ? dateTime(config.last_completed_at)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Dias permitidos</dt>
              <dd>
                {config.send_weekdays
                  .map((d) => weekdayNames[d].slice(0, 3))
                  .join(" · ")}
              </dd>
            </div>
            <div>
              <dt>Envios</dt>
              <dd>Somente prévia</dd>
            </div>
          </dl>
          {config.last_error && (
            <p className="inline-error" role="alert">
              {config.last_error}
            </p>
          )}
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Linhas da view</th>
                  <th>Agendamentos únicos</th>
                </tr>
              </thead>
              <tbody>
                {config.days.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date.split("-").reverse().join("/")}</td>
                    <td>{day.row_count}</td>
                    <td>{day.appointment_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </InlineDialog>
      )}
      {removing && (
        <InlineDialog
          title={"Excluir " + removing.name + "?"}
          subtitle=""
          busy={busy}
          onClose={() => setRemoving(null)}
          footer={
            <footer className="form-action-footer">
              <button
                className="button"
                disabled={busy}
                onClick={() => setRemoving(null)}
              >
                Cancelar
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => void act("remove", removing)}
              >
                Excluir configuração
              </button>
            </footer>
          }
        >
          <p>
            A importação desta agenda será interrompida e suas prévias pendentes
            serão canceladas. Os agendamentos e o histórico serão preservados.
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </InlineDialog>
      )}
      {editing !== undefined && data && (
        <Editor
          key={editing?.id || "new"}
          data={data}
          config={editing}
          unit={unit}
          onClose={() => setEditing(undefined)}
          onSaved={(result) => {
            setData(result);
            setEditing(undefined);
          }}
        />
      )}
    </Panel>
  );
}

function formatWhatsAppBody(
  text: string,
  testParameters?: Record<string, string>,
) {
  if (!text) return null;
  const parts = text.split(/(\{\{\d+\}\})/g);
  return parts.map((part, index) => {
    const match = part.match(/^\{\{(\d+)\}\}$/);
    if (match) {
      const key = match[1];
      if (testParameters && testParameters[key] !== undefined) {
        return (
          <span
            key={index}
            className="whatsapp-filled-token"
            title={`Parâmetro {{${key}}} preenchido pelo paciente`}
          >
            {testParameters[key] || `{{${key}}}`}
          </span>
        );
      }
      return (
        <span key={index} className="whatsapp-var-token">
          {part}
        </span>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function Editor({
  config,
  data,
  unit,
  onClose,
  onSaved,
}: {
  data: Payload;
  config: Config | null;
  unit: string;
  onClose: () => void;
  onSaved: (data: Payload) => void;
}) {
  const [sendDays, setSendDays] = useState(
    config?.send_weekdays || [0, 1, 2, 3, 4, 5, 6],
  );
  const [dayPolicy, setDayPolicy] = useState<DayPolicy>(
    config?.blocked_day_policy || {},
  );
  const [view, setView] = useState(config?.view_name || "");
  const [columns, setColumns] = useState(config?.columns || []);
  const [inspected, setInspected] = useState(config?.view_name || "");
  const [mapping, setMapping] = useState(
    config?.column_mapping || data.default_columns,
  );
  const [template, setTemplate] = useState(config?.template_id || "");
  const [bindings, setBindings] = useState<Record<string, Binding>>(
    config?.parameter_mapping || {},
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [testPatientId, setTestPatientId] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState("");
  const [testResult, setTestResult] = useState<{
    found: boolean;
    patient_external_id: string;
    source: string;
    values: Record<string, string>;
    parameters: Record<string, string>;
  } | null>(null);

  const remote = data.templates.find((t) => t.id === template);

  async function handleTestPatient() {
    if (!testPatientId.trim()) return;
    setTestLoading(true);
    setTestError("");
    try {
      const res = await request<{
        found: boolean;
        source?: string;
        patient_external_id?: string;
        values?: Record<string, string>;
        parameters?: Record<string, string>;
        message?: string;
      }>(
        "/api/v1/oracle-agendas/test_patient/?unit=" + encodeURIComponent(unit),
        "POST",
        {
          ...(config ? { id: config.id } : {}),
          patient_external_id: testPatientId.trim(),
          view_name: view,
          column_mapping: mapping,
          parameter_mapping: bindings,
        },
      );
      if (!res.found) {
        setTestError(res.message || "Paciente não encontrado.");
        setTestResult(null);
      } else {
        setTestResult({
          found: true,
          patient_external_id: res.patient_external_id || testPatientId.trim(),
          source: res.source || "oracle",
          values: res.values || {},
          parameters: res.parameters || {},
        });
      }
    } catch (e) {
      setTestError(
        (e as Error).message || "Erro ao consultar paciente no banco.",
      );
      setTestResult(null);
    } finally {
      setTestLoading(false);
    }
  }

  function clearTest() {
    setTestResult(null);
    setTestError("");
    setTestPatientId("");
  }
  async function inspect() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ columns: Column[] }>(
        "/api/v1/oracle-agendas/inspect/?unit=" + encodeURIComponent(unit),
        "POST",
        { view_name: view },
      );
      setColumns(result.columns);
      setInspected(view);
      const names = new Set(result.columns.map((c) => c.name));
      setMapping((current) =>
        Object.fromEntries(
          Object.entries(current).map(([key, value]) => [
            key,
            Array.isArray(value)
              ? value.filter((v) => names.has(v))
              : names.has(value)
                ? value
                : "",
          ]),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      onSaved(
        await request<Payload>(
          "/api/v1/oracle-agendas/configure/?unit=" + encodeURIComponent(unit),
          "POST",
          {
            ...(config ? { id: config.id } : {}),
            version: config?.version || 0,
            name: values.get("name"),
            kind: values.get("kind"),
            view_name: view,
            column_mapping: mapping,
            template_id: template,
            parameter_mapping: Object.fromEntries(
              (remote?.parameter_keys || []).map((key) => [key, bindings[key]]),
            ),
            horizon_days: Number(values.get("horizon_days")),
            days_before: Number(values.get("days_before")),
            send_time: values.get("send_time"),
            send_weekdays: sendDays,
            blocked_day_policy: Object.fromEntries(
              Object.entries(dayPolicy).filter(
                ([day]) => !sendDays.includes(Number(day)),
              ),
            ),
            enabled: values.get("enabled") === "on",
          },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedPhoneCount = Array.isArray(mapping.phone_columns)
    ? mapping.phone_columns.length
    : 0;
  const isViewModified = inspected !== view;

  return (
    <InlineDialog
      title={config ? "Editar agenda" : "Nova agenda"}
      subtitle=""
      busy={busy}
      onClose={onClose}
      className="oracle-agenda-modal"
      footer={
        <footer className="form-action-footer">
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="button primary"
            form="oracle-agenda-form"
            type="submit"
            disabled={busy || isViewModified || !remote?.supported}
          >
            Salvar
          </button>
        </footer>
      }
    >
      <form
        id="oracle-agenda-form"
        className="op-form oracle-agenda-form"
        onSubmit={save}
      >
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="oracle-agenda-fieldset">
          <div className="agenda-section-card">
            <div className="agenda-mapping-grid">
              <label className="op-field">
                <span>Nome da agenda</span>
                <input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={config?.name || ""}
                  placeholder="Ex.: Consultas Sansaúde"
                />
              </label>
              <label className="op-field">
                <span>Tipo</span>
                <select
                  name="kind"
                  defaultValue={config?.kind || "consultation"}
                  disabled={!!config}
                >
                  {Object.entries(kinds).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {config && (
                  <input type="hidden" name="kind" value={config.kind} />
                )}
              </label>
            </div>
          </div>
          {/* 1. Origem e View no Oracle */}
          <div className="agenda-section-card">
            <div className="agenda-section-header">
              <Database size={15} className="agenda-section-icon" />
              <h3>Origem e View no Oracle</h3>
              {columns.length > 0 && !isViewModified && (
                <span className="agenda-status-pill success">
                  <CheckCircle2 size={12} />
                  {columns.length} colunas carregadas
                </span>
              )}
            </div>
            <div className="agenda-view-row">
              <label className="op-field agenda-view-input-label">
                <span>Nome da View / Tabela</span>
                <input
                  required
                  className="agenda-view-input"
                  value={view}
                  placeholder="DBASISTEMAS.VDIC_CONS_AGENDA_ENVIO_MSG_SAN"
                  onChange={(e) => setView(e.target.value.toUpperCase())}
                />
              </label>
              <button
                className="button agenda-inspect-btn"
                type="button"
                disabled={busy || !view}
                onClick={() => void inspect()}
              >
                <Search size={14} />
                <span>Consultar colunas</span>
              </button>
            </div>
            {isViewModified && inspected && (
              <p className="agenda-field-hint warning">
                <AlertCircle size={13} />O nome da view foi alterado. Clique em
                &ldquo;Consultar colunas&rdquo; para validar os novos campos.
              </p>
            )}
          </div>

          {columns.length > 0 && !isViewModified && (
            <>
              {/* 2. Mapeamento de Campos do Agendamento */}
              <div className="agenda-section-card">
                <div className="agenda-section-header">
                  <Calendar size={15} className="agenda-section-icon" />
                  <h3>Mapeamento de Campos do Agendamento</h3>
                </div>
                <div className="agenda-mapping-grid">
                  {fields.map(([key, label]) => {
                    const isReq = required.has(key);
                    return (
                      <label
                        className="op-field agenda-mapping-field"
                        key={key}
                      >
                        <span className="agenda-field-title">
                          {label}
                          {isReq && (
                            <span
                              className="agenda-required-mark"
                              title="Campo obrigatório"
                            >
                              *
                            </span>
                          )}
                        </span>
                        <select
                          required={isReq}
                          value={String(mapping[key] || "")}
                          onChange={(e) =>
                            setMapping({ ...mapping, [key]: e.target.value })
                          }
                        >
                          <option value="">Selecionar coluna</option>
                          {columns.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 3. Colunas de Telefone */}
              <div className="agenda-section-card">
                <div className="agenda-section-header">
                  <Phone size={15} className="agenda-section-icon" />
                  <h3>Colunas de Telefone para Contato</h3>
                  <span className="agenda-status-pill neutral">
                    {selectedPhoneCount}{" "}
                    {selectedPhoneCount === 1 ? "selecionada" : "selecionadas"}
                  </span>
                </div>
                <div className="agenda-phone-box">
                  <div className="agenda-phone-grid">
                    {columns.map((c) => {
                      const isChecked =
                        Array.isArray(mapping.phone_columns) &&
                        mapping.phone_columns.includes(c.name);
                      return (
                        <label
                          key={c.name}
                          className={`agenda-phone-item ${isChecked ? "active" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const phones = Array.isArray(
                                mapping.phone_columns,
                              )
                                ? mapping.phone_columns
                                : [];
                              setMapping({
                                ...mapping,
                                phone_columns: e.target.checked
                                  ? [...phones, c.name]
                                  : phones.filter((v) => v !== c.name),
                              });
                            }}
                          />
                          <span className="agenda-phone-name">{c.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 4. Modelo da Meta WhatsApp */}
              <div className="agenda-section-card">
                <div className="agenda-section-header">
                  <MessageSquare size={15} className="agenda-section-icon" />
                  <h3>Modelo de Mensagem (Meta WhatsApp)</h3>
                </div>
                <label className="op-field">
                  <span>Template aprovado</span>
                  <select
                    required
                    value={template}
                    onChange={(e) => {
                      setTemplate(e.target.value);
                      setBindings({});
                    }}
                  >
                    <option value="">Selecionar template</option>
                    {data.templates.map((t) => (
                      <option key={t.id} value={t.id} disabled={!t.supported}>
                        {t.name} · {t.category}
                        {!t.supported ? " · indisponível nesta integração" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                {!data.templates.length && (
                  <p className="agenda-field-hint warning" role="alert">
                    <AlertCircle size={13} />
                    Nenhum template aprovado encontrado. Configure e valide a
                    Meta desta unidade.
                  </p>
                )}

                {remote && (
                  <div className="agenda-template-container">
                    <div className="agenda-template-meta-bar">
                      <span className="agenda-badge-code">{remote.name}</span>
                      <span className="agenda-badge-meta">
                        {remote.category}
                      </span>
                      <span className="agenda-badge-lang">
                        {remote.language}
                      </span>
                    </div>

                    {/* Testar com CD_PACIENTE */}
                    <div className="agenda-test-patient-box">
                      <div className="agenda-test-patient-header">
                        <h4>
                          <Sparkles size={14} className="agenda-test-icon" />
                          <span>
                            Testar preenchimento com dados do paciente
                          </span>
                        </h4>
                        {testResult && (
                          <button
                            type="button"
                            className="agenda-test-reset-btn"
                            onClick={clearTest}
                          >
                            Voltar para variáveis ({"{{"}1{"}}"})
                          </button>
                        )}
                      </div>
                      <div className="agenda-test-patient-row">
                        <label className="op-field agenda-test-patient-label">
                          <span>Código do Paciente (CD_PACIENTE)</span>
                          <input
                            type="text"
                            className="agenda-test-patient-input"
                            placeholder="Informe o CD_PACIENTE para buscar no banco..."
                            value={testPatientId}
                            onChange={(e) => setTestPatientId(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void handleTestPatient();
                              }
                            }}
                            disabled={testLoading}
                          />
                        </label>
                        <button
                          className="button primary agenda-test-patient-btn"
                          type="button"
                          disabled={testLoading || !testPatientId.trim()}
                          onClick={() => void handleTestPatient()}
                        >
                          <Search size={14} />
                          <span>{testLoading ? "Buscando..." : "Testar"}</span>
                        </button>
                      </div>
                      {testError && (
                        <p className="agenda-field-hint warning" role="alert">
                          <AlertCircle size={13} />
                          {testError}
                        </p>
                      )}
                      {testResult && (
                        <div className="agenda-test-success-pill">
                          <span>
                            ✓ Agendamento encontrado (
                            {testResult.source === "oracle"
                              ? "Oracle"
                              : "Banco local"}
                            ):{" "}
                            <strong>
                              {testResult.values.PACIENTE ||
                                testResult.values[String(mapping.patient)] ||
                                testResult.patient_external_id}
                            </strong>
                          </span>
                          <span className="agenda-test-source-badge">
                            Mensagem preenchida
                          </span>
                        </div>
                      )}
                    </div>

                    {/* WhatsApp Chat Frame & Bubble Preview */}
                    <div className="whatsapp-chat-frame">
                      <div className="whatsapp-chat-header">
                        <div className="whatsapp-avatar">
                          <MessageSquare size={16} />
                        </div>
                        <div className="whatsapp-header-info">
                          <div className="whatsapp-header-name">
                            <span>Órbita · WhatsApp</span>
                            <span
                              className="whatsapp-verified-badge"
                              title="Conta Comercial Verificada"
                            >
                              ✓
                            </span>
                          </div>
                          <span className="whatsapp-header-sub">
                            Conta comercial oficial
                          </span>
                        </div>
                      </div>

                      <div className="whatsapp-chat-wallpaper">
                        <div className="whatsapp-encryption-notice">
                          <span>
                            🔒 Mensagem protegida com criptografia de ponta a
                            ponta
                          </span>
                        </div>

                        <div className="whatsapp-bubble-wrapper">
                          <div className="whatsapp-message-bubble">
                            {remote.components.find((c) => c.type === "HEADER")
                              ?.text && (
                              <div className="whatsapp-bubble-header">
                                {
                                  remote.components.find(
                                    (c) => c.type === "HEADER",
                                  )?.text
                                }
                              </div>
                            )}
                            <div className="whatsapp-bubble-body">
                              {formatWhatsAppBody(
                                remote.components.find((c) => c.type === "BODY")
                                  ?.text || "",
                                testResult?.parameters,
                              )}
                            </div>
                            {remote.components.find((c) => c.type === "FOOTER")
                              ?.text && (
                              <div className="whatsapp-bubble-footer">
                                {
                                  remote.components.find(
                                    (c) => c.type === "FOOTER",
                                  )?.text
                                }
                              </div>
                            )}
                            <div className="whatsapp-time-row">
                              <span className="whatsapp-time-text">
                                {testResult?.values?.HORA_MARCADA ||
                                  (config?.send_time || "09:00").slice(0, 5)}
                              </span>
                              <svg
                                width="16"
                                height="11"
                                viewBox="0 0 16 11"
                                fill="none"
                                className="whatsapp-double-check"
                              >
                                <path
                                  d="M11.07 0.93L4.93 7.07L2.43 4.57L1.07 5.93L4.93 9.79L12.43 2.29L11.07 0.93Z"
                                  fill="#53bdeb"
                                />
                                <path
                                  d="M14.57 2.29L7.07 9.79L6.14 8.86L7.5 7.5L13.21 0.93L14.57 2.29Z"
                                  fill="#53bdeb"
                                />
                              </svg>
                            </div>

                            {remote.components.find((c) => c.type === "BUTTONS")
                              ?.buttons && (
                              <div className="whatsapp-bubble-buttons">
                                {remote.components
                                  .find((c) => c.type === "BUTTONS")
                                  ?.buttons?.map((btn, idx) => (
                                    <div
                                      key={idx}
                                      className="whatsapp-bubble-button"
                                    >
                                      <Reply
                                        size={13}
                                        className="whatsapp-button-icon"
                                      />
                                      <span>{btn.text}</span>
                                    </div>
                                  ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {remote.parameter_keys.length > 0 && (
                      <div className="agenda-params-container">
                        <div className="agenda-params-header">
                          <h4>Parâmetros do Template</h4>
                          <span className="agenda-params-count">
                            {remote.parameter_keys.length}{" "}
                            {remote.parameter_keys.length === 1
                              ? "parâmetro"
                              : "parâmetros"}
                          </span>
                        </div>
                        <div className="agenda-params-list">
                          {remote.parameter_keys.map((key) => (
                            <div
                              className="agenda-parameter-row-card"
                              key={key}
                            >
                              <div className="agenda-param-badge">
                                <code>{"{{" + key + "}}"}</code>
                              </div>
                              <label className="op-field agenda-param-field">
                                <span>Coluna correspondente</span>
                                <select
                                  aria-label={"Coluna do parâmetro " + key}
                                  required
                                  value={bindings[key]?.column || ""}
                                  onChange={(e) =>
                                    setBindings({
                                      ...bindings,
                                      [key]: {
                                        column: e.target.value,
                                        format: bindings[key]?.format || "text",
                                      },
                                    })
                                  }
                                >
                                  <option value="">Selecionar coluna</option>
                                  {columns.map((c) => (
                                    <option key={c.name} value={c.name}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="op-field agenda-param-field">
                                <span>Formato de exibição</span>
                                <select
                                  aria-label={"Formato do parâmetro " + key}
                                  value={bindings[key]?.format || "text"}
                                  onChange={(e) =>
                                    setBindings({
                                      ...bindings,
                                      [key]: {
                                        column: bindings[key]?.column || "",
                                        format: e.target.value,
                                      },
                                    })
                                  }
                                >
                                  <option value="text">Texto original</option>
                                  <option value="date">
                                    Data (dd/mm/aaaa)
                                  </option>
                                  <option value="time">Hora (hh:mm)</option>
                                </select>
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 5. Janela e Horário de Envio */}
              <div className="agenda-section-card">
                <div className="agenda-section-header">
                  <Clock size={15} className="agenda-section-icon" />
                  <h3>Janela e Horário de Envio</h3>
                </div>
                <div className="agenda-timing-grid">
                  <label className="op-field">
                    <span>Janela futura (dias)</span>
                    <input
                      name="horizon_days"
                      type="number"
                      min="1"
                      max="30"
                      required
                      defaultValue={config?.horizon_days || 10}
                    />
                  </label>
                  <label className="op-field">
                    <span>Antecedência (dias)</span>
                    <input
                      name="days_before"
                      type="number"
                      min="0"
                      max="30"
                      required
                      defaultValue={config?.days_before ?? 5}
                    />
                  </label>
                  <label className="op-field">
                    <span>Horário do disparo</span>
                    <input
                      name="send_time"
                      type="time"
                      required
                      defaultValue={(config?.send_time || "09:00").slice(0, 5)}
                    />
                  </label>
                </div>
                <SendCalendar
                  days={sendDays}
                  policy={dayPolicy}
                  onChange={(days, policy) => {
                    setSendDays(days);
                    setDayPolicy(policy);
                  }}
                />
                <label className="agenda-toggle-card">
                  <input
                    name="enabled"
                    type="checkbox"
                    defaultChecked={config?.enabled ?? true}
                  />
                  <div className="agenda-toggle-text">
                    <strong>Importação contínua automática</strong>
                    <span>
                      Importar automaticamente os dias restantes dentro da
                      janela configurada.
                    </span>
                  </div>
                </label>
              </div>
            </>
          )}
        </fieldset>
      </form>
    </InlineDialog>
  );
}
