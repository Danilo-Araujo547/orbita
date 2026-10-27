import Select from "./Select";
import LegacyLabel from "./LegacyLabel";
import FormAction, { FormActionContext } from "./FormAction";
import UnitDirectory from "./UnitDirectory";
import UserDirectory from "./UserDirectory";
import ConfigurationEditor from "./ConfigurationEditor";
import { useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { query, request } from "../api";
import type { Paginated, Rule as AppointmentRule } from "../types";
import { Panel, Empty } from "./ui";

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
  reports: number[];
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
  busy: actionBusy,
  onError,
  activeTab,
  editable = true,
  userAccess = false,
}: Common & { activeTab?: string; editable?: boolean; userAccess?: boolean }) {
  const busy = actionBusy || !editable;
  const parentContext = useContext(FormActionContext);
  const [internalTab, setTab] = useState("sources"),
    [schedules, setSchedules] = useState<
      { id: number; report: number; access: number; send_time: string; enabled: boolean; weekdays: number[]; version: number }[]
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
  return (
    <FormActionContext.Provider value={{busy: busy || !editable, error:parentContext.error, revision}}>
    <div className={`admin-records ${editable ? "" : "config-read-only"}`}>
      {!activeTab && (
        <div className="op-toolbar">
          {[
            ["units", "Unidades"],
            ["sources", "Origens e regras"],
            ["team", "Equipe"],
            ["access", "Acesso a relatórios"],
            ["schedules", "Relatórios agendados"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "button primary" : "button"}
              onClick={() => setTab(id)}
            >
              <LegacyLabel legacy={id === "sources"}>{label}</LegacyLabel>
            </button>
          ))}
        </div>
      )}

      {tab === "team" && (userAccess ? <UserDirectory unit={unit} editable={editable} /> : <Panel title="Equipe da unidade"><div className="table-scroll"><table className="directory-table"><thead><tr><th>Usuário</th><th>Perfil</th></tr></thead><tbody>{members.map(m=><tr key={m.id}><td>{m.username}</td><td>{m.role}</td></tr>)}</tbody></table></div></Panel>)}

      {tab === "units" && <UnitDirectory unit={unit} editable={editable} />}

      {tab === "sources" && (
        <>
          <Panel
            title="Origens de dados Oracle"
            action={
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
                    <Select
                      value={sourceKind}
                      onChange={(e) => setSourceKind(e.target.value)}
                    >
                      <option value="consultation">Consultas</option>
                      <option value="exam">Exames</option>
                      <option value="lab">Laboratório</option>
                      <option value="postoperative">Pós-cirúrgico</option>
                    </Select>
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
                  <button type="submit" className="button primary" disabled={busy}>
                    Cadastrar origem
                  </button>
                  <small className="op-muted">
                    Credenciais ficam no ambiente do servidor, separadas por
                    unidade.
                  </small>
                </form>
              </FormAction>
            }
          >
            {sources.length ? (
              <div className="table-scroll">
                <table className="directory-table">
                  <thead>
                    <tr>
                      <th>View homologada</th>
                      <th>Tipo</th>
                      <th>Validação</th>
                      <th style={{ textAlign: "right" }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.view_name}</strong>
                        </td>
                        <td>
                          <span className="directory-kind">
                            {{
                              consultation: "Consultas",
                              exam: "Exames",
                              lab: "Laboratório",
                              postoperative: "Pós-cirúrgico",
                            }[s.kind] || s.kind}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`directory-status ${s.verified ? "active" : "paused"}`}
                          >
                            {s.verified ? "Fonte validada" : "Validação pendente"}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
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
                                  view_name: String(values.get("view_name") || ""),
                                  verified: values.get("verified") === "on",
                                  evidence: String(values.get("evidence") || ""),
                                }).catch(catchAction);
                              }}
                            >
                              <Field label="View"><input name="view_name" required defaultValue={s.view_name}/></Field>
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="Nenhuma origem cadastrada nesta unidade." />
            )}
          </Panel>

          <Panel
            title="Regras de fluxo pós-cirúrgico"
            action={
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
                    <Select
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
                    </Select>
                  </Field>
                  <Field label="Template">
                    <Select
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
                    </Select>
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
                  <button type="submit" className="button primary" disabled={busy}>
                    Cadastrar desabilitada
                  </button>
                </form>
              </FormAction>
            }
          >
            {rules.length ? (
              <div className="table-scroll">
                <table className="directory-table">
                  <thead>
                    <tr>
                      <th>Regra</th>
                      <th>Situação</th>
                      <th style={{ textAlign: "right" }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.name}</strong>
                        </td>
                        <td>
                          <span
                            className={`directory-status ${r.enabled ? "active" : "paused"}`}
                          >
                            {r.enabled ? "Ativa para análise" : "Desabilitada"}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <ConfigurationEditor record={{...r}} path={`flow-rules/${r.id}/configure`} act={act} busy={busy} fields={[
                            {key:"name",label:"Nome",required:true},
                            {key:"source",label:"Origem",type:"select",options:sources.map(s=>({value:s.id,label:s.view_name}))},
                            {key:"template",label:"Template",type:"select",options:templates.map(t=>({value:t.id,label:t.name}))},
                            {key:"days_after",label:"Dias apos o evento",type:"number"},
                            {key:"send_time",label:"Horario",type:"time"},
                            {key:"weekdays",label:"Dias",type:"weekdays"},
                            {key:"evidence",label:"Referencia da validacao",type:"textarea"},
                            {key:"enabled",label:"Ativa",type:"checkbox"},
                          ]}/>

                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="Nenhuma regra de fluxo cadastrada." />
            )}
          </Panel>

          <Panel
            title="Regras de agendamento"
            legacy
            action={<AgendaRuleForm act={act} busy={busy} templates={templates} />}
          >
            {appointmentRules.length ? (
              <div className="table-scroll">
                <table className="directory-table">
                  <thead>
                    <tr>
                      <th>Regra</th>
                      <th>Template</th>
                      <th>Antecedência</th>
                      <th>Atualização</th>
                      <th>Horário</th>
                      <th>Situação</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointmentRules.map((rule) => (
                      <tr key={rule.id}>
                        <td>
                          <strong>{rule.name}</strong>
                          <small className="directory-detail">
                            ID #{rule.id} · v{rule.version}
                          </small>
                        </td>
                        <td>{rule.template_name}</td>
                        <td>{rule.days_before} dias</td>
                        <td>{rule.refresh_interval_minutes} min</td>
                        <td>{rule.send_time.slice(0, 5)}</td>
                        <td>
                          <span
                            className={`directory-status ${rule.enabled ? "active" : "paused"}`}
                          >
                            {rule.enabled ? "Ativa" : "Pausada"}
                          </span>
                        </td>
                        <td><AgendaRuleForm key={`${rule.id}:${rule.version}`} rule={rule} act={act} busy={busy} templates={templates} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="Nenhuma regra de agendamento cadastrada." />
            )}
          </Panel>
        </>
      )}

      {tab === "access" && (
        <Panel
          title="Acesso autorizado a relatórios"
          action={
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
                  <Select
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
                  </Select>
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
                <button type="submit" className="button primary" disabled={busy}>
                  Cadastrar autorização pendente
                </button>
              </form>
            </FormAction>
          }
        >
          {accesses.length ? (
            <div className="table-scroll">
              <table className="directory-table">
                <thead>
                  <tr>
                    <th>WhatsApp</th>
                    <th>Usuário</th>
                    <th>Situação</th>
                    <th style={{ textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {accesses.map((a) => {
                    const memberName =
                      members.find((m) => m.user === a.user)?.username ||
                      `Usuário #${a.user}`;
                    return (
                      <tr key={a.id}>
                        <td>
                          <strong>{a.phone}</strong>
                        </td>
                        <td>{memberName}</td>
                        <td>
                          <span
                            className={`directory-status ${
                              !a.active
                                ? "paused"
                                : a.verified_at
                                  ? "active"
                                  : "paused"
                            }`}
                          >
                            {!a.active
                              ? "Revogado"
                              : a.verified_at
                                ? "Verificado"
                                : "Titularidade pendente"}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "8px" }}>
                            <ConfigurationEditor record={{...a}} path={`report-access/${a.id}/configure`} act={act} busy={busy} fields={[
                              {key:"user",label:"Usuário",type:"select",options:members.map(m=>({value:m.user,label:m.username}))},
                              {key:"phone",label:"WhatsApp",required:true},
                              {key:"reports",label:"Relatórios autorizados",type:"multiple",options:reports.map(r=>({value:r.id,label:r.name}))},
                              {key:"active",label:"Autorização ativa",type:"checkbox"},
                            ]} />
                            {a.active && !a.verified_at && (
                              <FormAction
                                title="Confirmar titularidade"
                                label="Confirmar titularidade"
                                busy={busy}
                              >
                                <form
                                  className="op-form"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    const formEv = new FormData(
                                      e.currentTarget,
                                    ).get("evidence");
                                    void act(`report-access/${a.id}/verify`, {
                                      evidence: String(formEv || ""),
                                    }).catch(catchAction);
                                  }}
                                >
                                  <Field label="Como a titularidade foi verificada?">
                                    <textarea
                                      name="evidence"
                                      required
                                      minLength={5}
                                      maxLength={4000}
                                      rows={4}
                                      placeholder="Descreva a evidência ou comprovação de titularidade..."
                                    />
                                  </Field>
                                  <button
                                    type="submit"
                                    className="button primary"
                                    disabled={busy}
                                  >
                                    Confirmar titularidade
                                  </button>
                                </form>
                              </FormAction>
                            )}
                            {a.active && (
                              <button
                                type="button"
                                className="button"
                                disabled={busy}
                                onClick={() =>
                                  void act(
                                    `report-access/${a.id}/revoke`,
                                    {},
                                  ).catch(catchAction)
                                }
                              >
                                Revogar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="Nenhuma autorização cadastrada para relatórios." />
          )}
        </Panel>
      )}

      {tab === "schedules" && (
        <Panel
          title="Relatórios agendados"
          action={
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
                  <Select
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
                  </Select>
                </Field>
                <Field label="Relatório">
                  <Select
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
                  </Select>
                </Field>
                <Field label="Horário (segunda a sexta)">
                  <input
                    type="time"
                    value={sendTime}
                    onChange={(e) => setSendTime(e.target.value)}
                  />
                </Field>
                <button type="submit" className="button primary" disabled={busy}>
                  Cadastrar agendamento
                </button>
              </form>
            </FormAction>
          }
        >
          {schedules.length ? (
            <div className="table-scroll">
              <table className="directory-table">
                <thead>
                  <tr>
                    <th>Relatório</th>
                    <th>Horário de envio</th>
                    <th>Dias</th>
                    <th>Situação</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <strong>
                          {reports.find((r) => r.id === job.report)?.name ||
                            `Relatório #${job.report}`}
                        </strong>
                      </td>
                      <td>{job.send_time.slice(0, 5)}</td>
                      <td>{job.weekdays.map(d=>["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"][d]).join(", ")}</td>
                      <td>
                        <span
                          className={`directory-status ${job.enabled ? "active" : "paused"}`}
                        >
                          {job.enabled ? "Ativo" : "Desativado"}
                        </span>
                      </td><td><ConfigurationEditor record={{...job}} path={`report-schedules/${job.id}/configure`} act={act} busy={busy} fields={[
                        {key:"access",label:"Destinatário",type:"select",options:accesses.filter(a=>a.active&&a.verified_at).map(a=>({value:a.id,label:a.phone}))},
                        {key:"report",label:"Relatório",type:"select",options:reports.map(r=>({value:r.id,label:r.name}))},
                        {key:"send_time",label:"Horário",type:"time"},{key:"weekdays",label:"Dias",type:"weekdays"},
                        {key:"enabled",label:"Ativo",type:"checkbox"},
                      ]}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="Nenhum agendamento cadastrado." />
          )}
        </Panel>
      )}
    </div>
    </FormActionContext.Provider>
  );
}

function AgendaRuleForm({
  act,
  busy,
  templates,
  rule,
}: {
  rule?: AppointmentRule;
  act: Common["act"];
  busy: boolean;
  templates: { id: number; name: string; purpose: string }[];
}) {
  const [name, setName] = useState(rule?.name || ""),
    [code, setCode] = useState(rule?.code || ""),
    [kind, setKind] = useState(rule?.kind || "consultation"),
    [template, setTemplate] = useState(rule ? String(rule.template) : ""),
    [days, setDays] = useState(rule?.days_before ?? 5),
    [refresh, setRefresh] = useState(rule?.refresh_interval_minutes ?? 5),
    [weekdays, setWeekdays] = useState(rule?.weekdays || [0,1,2,3,4,5,6]),
    [enabled, setEnabled] = useState(rule?.enabled ?? false),
    [time, setTime] = useState(rule?.send_time.slice(0,5) || "07:15"),
    [evidence, setEvidence] = useState(rule?.evidence || "");
  return (
    <FormAction
      title={rule ? "Editar regra de agendamento" : "Nova regra de agendamento"}
      label={rule ? "Editar" : "Adicionar regra de agendamento"}
    >
      <form
        className="op-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(rule ? `rules/${rule.id}/configure` : "rules", {
            ...(rule ? {version: rule.version} : {code}),
            name,
            kind,
            template: Number(template),
            days_before: days,
            refresh_interval_minutes: refresh,
            send_time: time,
            weekdays,
            evidence,
            enabled,
          }).catch(catchAction);
        }}
      >
        <h3>{rule ? "Editar regra de agendamento" : "Nova regra de agendamento"}</h3>

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
              disabled={!!rule}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="consultation">Consulta</option>
              <option value="exam">Exame</option>
              <option value="lab">Laboratório</option>
            </Select>
          </Field>
          <Field label="Template">
            <Select
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
            </Select>
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
          <Field label="Atualizar a view a cada (minutos)">
            <input type="number" min={1} max={1440} required value={refresh}
              onChange={(e) => setRefresh(Number(e.target.value))} />
          </Field>
          <Field label="Horário">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>
        <div className="op-field">
          <span>Dias da semana</span>
          <div className="op-checklist">
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day, index) => (
              <label key={day}><input type="checkbox" checked={weekdays.includes(index)}
                onChange={(e) => setWeekdays((v) => e.target.checked ? [...v, index] : v.filter((d) => d !== index))} />{day}</label>
            ))}
          </div>
        </div>
        {rule && <label className="checkbox-label"><input type="checkbox" checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)} />Regra ativa</label>}
        <Field label="Referência da validação">
          <textarea
            required
            minLength={5}
            maxLength={4000}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </Field>
        <button type="submit" className="button primary" disabled={busy || !weekdays.length}>
          {rule ? "Salvar" : "Cadastrar regra desabilitada"}
        </button>
      </form>
    </FormAction>
  );
}
