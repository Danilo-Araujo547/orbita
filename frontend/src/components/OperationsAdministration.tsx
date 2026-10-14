import FormAction from "./FormAction";
import UnitDirectory from "./UnitDirectory";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { query, request } from "../api";
import type { Paginated, Rule as AppointmentRule } from "../types";

type Common = {
  unit: string;
  revision: number;
  act: (path: string, data: unknown) => Promise<unknown>;
  busy: boolean;
  onError: (e: string) => void;
};
type Member = { id: number; user: number; username: string; role: string };
type Report = { id: number; name: string; enabled: boolean };
type Access = {
  id: number;
  user: number;
  phone: string;
  active: boolean;
  verified_at: string | null;
  version: number;
};
type Source = {
  id: number;
  kind: string;
  view_name: string;
  verified: boolean;
  version: number;
};
type Rule = { id: number; name: string; enabled: boolean; version: number };
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="op-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
const catchAction = () => {};

export default function OperationsAdministration({
  unit,
  revision,
  act,
  busy,
  onError,
  activeTab,
}: Common & { activeTab?: string }) {
  const [internalTab, setTab] = useState("sources"),
    [schedules, setSchedules] = useState<
      { id: number; report: number; send_time: string; enabled: boolean }[]
    >([]),
    [members, setMembers] = useState<Member[]>([]),
    [reports, setReports] = useState<Report[]>([]),
    [accesses, setAccesses] = useState<Access[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [rules, setRules] = useState<Rule[]>([]),
    [appointmentRules, setAppointmentRules] = useState<AppointmentRule[]>([]),
    [templates, setTemplates] = useState<
      { id: number; name: string; purpose: string }[]
    >([]);
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState("operator");
  const [user, setUser] = useState(""),
    [phone, setPhone] = useState(""),
    [allowed, setAllowed] = useState<number[]>([]),
    [evidence, setEvidence] = useState("");
  const [sourceKind, setSourceKind] = useState("postoperative"),
    [view, setView] = useState(""),
    [verified, setVerified] = useState(false);
  const [ruleName, setRuleName] = useState(""),
    [ruleCode, setRuleCode] = useState(""),
    [source, setSource] = useState(""),
    [template, setTemplate] = useState(""),
    [days, setDays] = useState(7),
    [sendTime, setSendTime] = useState("17:30"),
    [weekdays, setWeekdays] = useState([0, 1, 2, 3, 4, 5]);
  const [scheduleAccess, setScheduleAccess] = useState(""),
    [scheduleReport, setScheduleReport] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([
      request<Paginated<(typeof schedules)[number]>>(
        query("report-schedules", { unit }),
      ),
      request<Paginated<Member>>(query("members", { unit })),
      request<Paginated<Report>>(query("reports", { unit })),
      request<Paginated<Access>>(query("report-access", { unit })),
      request<Paginated<Source>>(query("sources", { unit })),
      request<Paginated<Rule>>(query("flow-rules", { unit })),
      request<Paginated<AppointmentRule>>(query("rules", { unit })),
      request<Paginated<(typeof templates)[number]>>(
        query("templates", { unit }),
      ),
    ])
      .then(([scheduled, m, r, a, s, f, agenda, t]) => {
        if (active) {
          setSchedules(scheduled.results);
          setMembers(m.results);
          setReports(r.results);
          setAccesses(a.results);
          setSources(s.results);
          setRules(f.results);
          setAppointmentRules(agenda.results);
          setTemplates(t.results);
        }
      })
      .catch((e) => active && onError(e.message));
    return () => {
      active = false;
    };
  }, [unit, revision, onError]);
  const tab = activeTab || internalTab;
  if (tab === "units" && activeTab) return <UnitDirectory unit={unit} />;
  return (
    <article className="op-card op-stack admin-records">
      {!activeTab && (
        <div className="op-toolbar">
          {[
            ["units", "Unidades"],
            ["sources", "Origens e regras"],
            ["access", "Acesso a relatórios"],
            ["schedules", "Relatórios agendados"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "button primary" : "button"}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === "team" && (
        <div className="op-two">
          <FormAction title="Novo usuário da unidade" label="Adicionar usuário">
            <form
              className="op-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act("members", { username, password, role })
                  .then(() => {
                    setPassword("");
                    setUsername("");
                  })
                  .catch(catchAction);
              }}
            >
              <h3>Novo usuário da unidade</h3>
              <Field label="Usuário">
                <input
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field label="Senha inicial">
                <input
                  required
                  type="password"
                  minLength={12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Perfil">
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="operator">Operador</option>
                  <option value="viewer">Consulta</option>
                  <option value="admin">Administrador</option>
                </select>
              </Field>
              <button className="button primary" disabled={busy}>
                Cadastrar usuário
              </button>
            </form>
          </FormAction>
          <div>
            {members.map((m) => (
              <div className="op-list-row" key={m.id}>
                <strong>{m.username}</strong>
                <span>
                  {
                    {
                      admin: "Administrador",
                      operator: "Operador",
                      viewer: "Consulta",
                    }[m.role]
                  }
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "units" && <UnitDirectory unit={unit} />}
      {tab === "sources" && (
        <div className="op-stack">
          <div className="admin-actions-grid">
            <FormAction
              title="Origem Oracle da unidade"
              label="Adicionar origem"
            >
              <form
                className="op-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("sources", {
                    kind: sourceKind,
                    view_name: view,
                    verified,
                    evidence,
                  }).catch(catchAction);
                }}
              >
                <h3>Origem Oracle da unidade</h3>
                <Field label="Tipo">
                  <select
                    value={sourceKind}
                    onChange={(e) => setSourceKind(e.target.value)}
                  >
                    <option value="consultation">Consultas</option>
                    <option value="exam">Exames</option>
                    <option value="lab">Laboratório</option>
                    <option value="postoperative">Pós-cirúrgico</option>
                  </select>
                </Field>
                <Field label="View homologada">
                  <input
                    required
                    value={view}
                    onChange={(e) => setView(e.target.value)}
                    placeholder="SCHEMA.VIEW"
                  />
                </Field>
                <Field label="Evidência da validação">
                  <textarea
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    maxLength={4000}
                  />
                </Field>
                <label className="op-check">
                  <input
                    type="checkbox"
                    checked={verified}
                    onChange={(e) => setVerified(e.target.checked)}
                  />
                  Fonte conferida para esta unidade
                </label>
                <button className="button" disabled={busy}>
                  Cadastrar origem
                </button>
                <small className="op-muted">
                  Credenciais ficam no ambiente do servidor, separadas por
                  unidade.
                </small>
              </form>
            </FormAction>
            <FormAction
              title="Regra pós-cirúrgica"
              label="Adicionar regra pós-cirúrgica"
            >
              <form
                className="op-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("flow-rules", {
                    name: ruleName,
                    code: ruleCode,
                    source: Number(source),
                    template: Number(template),
                    purpose: "postoperative",
                    days_after: days,
                    send_time: sendTime,
                    weekdays,
                    evidence,
                    enabled: false,
                  }).catch(catchAction);
                }}
              >
                <h3>Regra pós-cirúrgica</h3>
                <Field label="Nome">
                  <input
                    required
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                  />
                </Field>
                <Field label="Identificador">
                  <input
                    required
                    value={ruleCode}
                    onChange={(e) => setRuleCode(e.target.value)}
                  />
                </Field>
                <Field label="Origem">
                  <select
                    required
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {sources
                      .filter((s) => s.kind === "postoperative")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.view_name}
                        </option>
                      ))}
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
                      .filter((t) => t.purpose === "postoperative")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Dias após o procedimento">
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  />
                </Field>
                <Field label="Horário">
                  <input
                    type="time"
                    value={sendTime}
                    onChange={(e) => setSendTime(e.target.value)}
                  />
                </Field>
                <div className="op-toolbar">
                  {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map(
                    (d, i) => (
                      <label className="op-check" key={d}>
                        <input
                          type="checkbox"
                          checked={weekdays.includes(i)}
                          onChange={(e) =>
                            setWeekdays((v) =>
                              e.target.checked
                                ? [...v, i]
                                : v.filter((day) => day !== i),
                            )
                          }
                        />
                        {d}
                      </label>
                    ),
                  )}
                </div>
                <button className="button" disabled={busy}>
                  Cadastrar desabilitada
                </button>
              </form>
            </FormAction>
            <AgendaRuleForm act={act} busy={busy} templates={templates} />
          </div>
          <h3 className="admin-collection-title">
            Origens cadastradas <span>{sources.length}</span>
          </h3>
          {!sources.length && (
            <p className="op-muted admin-empty">Nenhuma origem cadastrada.</p>
          )}
          {sources.map((s) => (
            <div className="op-list-row" key={s.id}>
              <div>
                <strong>{s.view_name}</strong>
                <small>
                  {s.verified ? "Fonte validada" : "Validação pendente"}
                </small>
              </div>
              <FormAction
                title="Configurar origem"
                label="Configurar"
                description={s.view_name}
              >
                <form
                  className="op-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const values = new FormData(event.currentTarget);
                    void act(`sources/${s.id}/configure`, {
                      version: s.version,
                      verified: values.get("verified") === "on",
                      evidence: String(values.get("evidence") || ""),
                    }).catch(catchAction);
                  }}
                >
                  <Field label="Evidência da validação">
                    <textarea
                      name="evidence"
                      required
                      maxLength={4000}
                      rows={4}
                    />
                  </Field>
                  <label className="op-check">
                    <input
                      type="checkbox"
                      name="verified"
                      defaultChecked={s.verified}
                    />
                    Fonte validada
                  </label>
                  <button
                    type="submit"
                    className="button primary"
                    disabled={busy}
                  >
                    Salvar configuração
                  </button>
                </form>
              </FormAction>
            </div>
          ))}
          <h3 className="admin-collection-title">
            Regras de fluxo <span>{rules.length}</span>
          </h3>
          {!rules.length && (
            <p className="op-muted admin-empty">
              Nenhuma regra de fluxo cadastrada.
            </p>
          )}
          {rules.map((r) => (
            <div className="op-list-row" key={r.id}>
              <strong>{r.name}</strong>
              <span>{r.enabled ? "Ativa para análise" : "Desabilitada"}</span>
              <FormAction
                title="Configurar regra"
                label="Configurar"
                description={r.name}
              >
                <form
                  className="op-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const values = new FormData(event.currentTarget);
                    void act(`flow-rules/${r.id}/configure`, {
                      version: r.version,
                      enabled: values.get("enabled") === "on",
                      evidence: String(values.get("evidence") || ""),
                    }).catch(catchAction);
                  }}
                >
                  <Field label="Evidência da regra">
                    <textarea
                      name="evidence"
                      required
                      maxLength={4000}
                      rows={4}
                    />
                  </Field>
                  <label className="op-check">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={r.enabled}
                    />
                    Ativa para análise
                  </label>
                  <button
                    type="submit"
                    className="button primary"
                    disabled={busy}
                  >
                    Salvar configuração
                  </button>
                </form>
              </FormAction>
            </div>
          ))}
          <h3 className="admin-collection-title">
            Regras de agendamento <span>{appointmentRules.length}</span>
          </h3>
          <div className="table-scroll">
            <table className="directory-table">
              <thead>
                <tr>
                  <th>Regra</th>
                  <th>Antecedência</th>
                  <th>Horário</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {appointmentRules.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      <strong>{rule.name}</strong>
                      <small className="directory-detail">
                        {rule.template_name} · v{rule.version}
                      </small>
                    </td>
                    <td>{rule.days_before} dias</td>
                    <td>{rule.send_time.slice(0, 5)}</td>
                    <td>
                      <span
                        className={`directory-status ${rule.enabled ? "active" : "paused"}`}
                      >
                        {rule.enabled ? "Ativa" : "Pausada"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!appointmentRules.length && (
              <p className="directory-empty">Nenhuma regra de agendamento.</p>
            )}
          </div>
        </div>
      )}
      {tab === "access" && (
        <div className="op-two">
          <FormAction
            title="Autorizar número para relatórios"
            label="Adicionar autorização"
          >
            <form
              className="op-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act("report-access", {
                  user: Number(user),
                  phone,
                  reports: allowed,
                }).catch(catchAction);
              }}
            >
              <h3>Autorizar número para relatórios</h3>
              <Field label="Usuário">
                <select
                  required
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.user}>
                      {m.username}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="WhatsApp">
                <input
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="55 + DDD + número"
                />
              </Field>
              <div className="op-checklist">
                {reports
                  .filter((r) => r.enabled)
                  .map((r) => (
                    <label key={r.id}>
                      <input
                        type="checkbox"
                        checked={allowed.includes(r.id)}
                        onChange={(e) =>
                          setAllowed((v) =>
                            e.target.checked
                              ? [...v, r.id]
                              : v.filter((id) => id !== r.id),
                          )
                        }
                      />
                      {r.name}
                    </label>
                  ))}
              </div>
              <button className="button" disabled={busy}>
                Cadastrar autorização pendente
              </button>
            </form>
          </FormAction>
          <div className="op-stack">
            <Field label="Como a titularidade foi verificada?">
              <textarea
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                maxLength={4000}
              />
            </Field>
            {accesses.map((a) => (
              <div className="op-list-row" key={a.id}>
                <div>
                  <strong>{a.phone}</strong>
                  <small>
                    {members.find((m) => m.user === a.user)?.username} ·{" "}
                    {!a.active
                      ? "Revogado"
                      : a.verified_at
                        ? "Verificado"
                        : "Titularidade pendente"}
                  </small>
                </div>
                {a.active && !a.verified_at && (
                  <button
                    className="button"
                    disabled={busy || evidence.trim().length < 5}
                    onClick={() =>
                      void act(`report-access/${a.id}/verify`, {
                        evidence,
                      }).catch(catchAction)
                    }
                  >
                    Confirmar titularidade
                  </button>
                )}
                {a.active && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void act(`report-access/${a.id}/revoke`, {}).catch(
                        catchAction,
                      )
                    }
                  >
                    Revogar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "schedules" && (
        <div className="op-stack">
          <FormAction
            title="Agendar geração de relatório"
            label="Adicionar agendamento"
          >
            <form
              className="op-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act("report-schedules", {
                  access: Number(scheduleAccess),
                  report: Number(scheduleReport),
                  send_time: sendTime,
                  weekdays: [0, 1, 2, 3, 4],
                  enabled: false,
                  parameters: {},
                }).catch(catchAction);
              }}
            >
              <h3>Agendar geração de relatório</h3>

              <Field label="Destinatário autorizado">
                <select
                  required
                  value={scheduleAccess}
                  onChange={(e) => setScheduleAccess(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {accesses
                    .filter((a) => a.active && a.verified_at)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.phone}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Relatório">
                <select
                  required
                  value={scheduleReport}
                  onChange={(e) => setScheduleReport(e.target.value)}
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
              <Field label="Horário (segunda a sexta)">
                <input
                  type="time"
                  value={sendTime}
                  onChange={(e) => setSendTime(e.target.value)}
                />
              </Field>
              <button className="button" disabled={busy}>
                Cadastrar agendamento
              </button>
            </form>
          </FormAction>
          <h3 className="admin-collection-title">Agendamentos cadastrados</h3>
          {schedules.map((job) => (
            <div className="op-list-row" key={job.id}>
              <strong>
                {reports.find((r) => r.id === job.report)?.name ||
                  `Relatório ${job.report}`}
              </strong>
              <span>{job.send_time.slice(0, 5)}</span>
              <span className="op-pill">
                {job.enabled ? "Ativo" : "Desativado"}
              </span>
            </div>
          ))}
          {!schedules.length && (
            <p className="op-muted admin-empty">
              Nenhum agendamento cadastrado.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function AgendaRuleForm({
  act,
  busy,
  templates,
}: {
  act: Common["act"];
  busy: boolean;
  templates: { id: number; name: string; purpose: string }[];
}) {
  const [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [kind, setKind] = useState("consultation"),
    [template, setTemplate] = useState(""),
    [days, setDays] = useState(7),
    [time, setTime] = useState("07:15"),
    [evidence, setEvidence] = useState("");
  return (
    <FormAction
      title="Nova regra de agendamento"
      label="Adicionar regra de agendamento"
    >
      <form
        className="op-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act("rules", {
            code,
            name,
            kind,
            template: Number(template),
            days_before: days,
            send_time: time,
            weekdays: [0, 1, 2, 3, 4, 5],
            evidence,
            enabled: false,
          }).catch(catchAction);
        }}
      >
        <h3>Nova regra de agendamento</h3>

        <div className="op-two">
          <Field label="Nome">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Identificador">
            <input
              required
              pattern="[a-z0-9-]{3,80}"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field label="Tipo">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="consultation">Consulta</option>
              <option value="exam">Exame</option>
              <option value="lab">Laboratório</option>
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
                .filter((t) => t.purpose === "appointment")
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Dias antes">
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </Field>
          <Field label="Horário (segunda a sábado)">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Referência da validação">
          <textarea
            required
            minLength={5}
            maxLength={4000}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </Field>
        <button className="button" disabled={busy}>
          Cadastrar regra desabilitada
        </button>
      </form>
    </FormAction>
  );
}
