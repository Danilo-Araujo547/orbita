import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Edit3,
  Plus,
  Search,
  ShieldCheck,
  Play,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
import InlineDialog from "./InlineDialog";
import ReportScheduleFilters, { type ScheduleFilters } from "./ReportScheduleFilters";
import { Empty } from "./ui";
import { query, request } from "../api";
import { dateTime } from "../format";
import "../reports.css";

type Row = Record<string, any>;
type Tab =
  | "review"
  | "reports"
  | "connections"
  | "recipients"
  | "grants"
  | "automations"
  | "executions";
const names: Record<Tab, string> = {
  reports: "Relatórios",
  review: "Revisar",
  connections: "Conexões",
  recipients: "Destinatários",
  grants: "Permissões",
  automations: "Programações",
  executions: "Execuções",
};
const resources: Record<Tab, string> = {
  reports: "reports",
  review: "reports",
  connections: "report-connections",
  recipients: "report-recipients",
  grants: "report-grants",
  automations: "report-automations",
  executions: "report-executions",
};
const engines: Record<string, string> = {
  oracle: "Oracle",
  sqlite: "SQLite",
  firebird: "Firebird",
  mysql: "MySQL",
  postgres: "PostgreSQL",
};
const sources: Record<string, string> = {
  sql: "Consulta SQL",
  composite: "Composição",
  local: "SCV Messenger",
  external_file: "Arquivo externo",
  legacy_pending: "Rotina legada",
  application_pending: "Integração pendente",
};
const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const states: Record<string, string> = {
  pending: "Na fila",
  running: "Gerando",
  ready: "Disponível",
  failed: "Falha",
  blocked: "Bloqueado",
  not_requested: "Sem entrega",
  blocked_group_transport: "Transporte de grupo pendente",
  blocked_meta_configuration: "Entrega Meta pendente",
};
function ReportParameterAudit({ report }: { report: Row }) {
  const audit = report.parameter_audit;
  if (!audit)
    return report.id ? (
      <section
        className="report-parameter-audit"
        aria-label="Parâmetros identificados"
      >
        <div className="report-parameter-heading">
          <h3>Parâmetros identificados</h3>
        </div>
        <p className="report-parameter-empty" role="status">
          Carregando parâmetros…
        </p>
      </section>
    ) : null;
  const items: Row[] = audit.items || [];
  return (
    <section
      className="report-parameter-audit"
      aria-label="Parâmetros identificados"
    >
      <div className="report-parameter-heading">
        <h3>Parâmetros identificados</h3>
        <span>{items.length}</span>
      </div>
      {items.length ? (
        <div className="report-table-scroll">
          <table className="report-table report-parameter-table">
            <thead>
              <tr>
                <th>Parâmetro</th>
                <th>Tipo / formato</th>
                <th>Conteúdo cadastrado</th>
                <th>Uso identificado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p, i) => (
                <tr key={`${p.report_code}-${p.name}-${i}`}>
                  <td>
                    <strong>{p.name}</strong>
                    <small>
                      {p.origin}
                      {p.order ? ` · posição ${p.order}` : ""}
                    </small>
                    <small>
                      {p.required === true
                        ? "Obrigatório no SCV"
                        : p.required === false
                          ? "Opcional no SCV"
                          : "Obrigatoriedade não confirmada"}
                    </small>
                  </td>
                  <td>
                    <span className="report-param-type">{p.type}</span>
                    <small>{p.mask || "—"}</small>
                  </td>
                  <td>
                    <code
                      className={
                        p.value === "" || p.value == null
                          ? "report-code-empty"
                          : undefined
                      }
                    >
                      {p.value === "" || p.value == null
                        ? "—"
                        : String(p.value)}
                    </code>
                  </td>
                  <td>
                    <span
                      className={`report-param-badge ${
                        p.status === "confirmed"
                          ? "report-ok"
                          : p.status === "legacy"
                            ? "report-warning report-legacy-badge"
                            : "report-warning"
                      }`}
                    >
                      {p.status === "confirmed" ? (
                        <Check size={13} />
                      ) : (
                        <AlertTriangle size={13} />
                      )}{" "}
                      {p.status === "confirmed"
                        ? "Confirmado no SQL atual"
                        : p.status === "legacy"
                          ? "Identificado no legado"
                          : "Revisar vínculo"}
                    </span>
                    <small>{p.usage}</small>
                    {p.origin.startsWith("Componente") && (
                      <small>{p.report_name}</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="report-parameter-empty">
          Nenhum parâmetro identificado no cadastro ou SQL disponível.
        </p>
      )}
      {audit.component_issues?.length > 0 && (
        <div className="report-parameter-issues">
          {audit.component_issues.map((issue: string, i: number) => (
            <p key={i} className="report-warning">
              <AlertTriangle size={14} />
              {issue}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="op-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
async function all(resource: string, unit: string): Promise<Row[]> {
  const result: Row[] = [];
  for (let page = 1; page <= 100; page++) {
    const data = await request<{ results: Row[]; next: string | null }>(
      query(resource, { unit, page: String(page) }),
    );
    result.push(...data.results);
    if (!data.next) return result;
  }
  throw new Error("Limite de registros excedido.");
}
function seed(tab: Tab, row?: Row): Row {
  if (row) return { ...row, password: "", admin_password: "" };
  if (tab === "reports")
    return {
      name: "",
      code: "",
      source: "sql",
      connection: "",
      query_sql: "",
      parameter_schema: {},
      components: [],
      keywords: [],
      output_format: "pdf",
      enabled: false,
      reviewed: false,
      manual_enabled: true,
    };
  if (tab === "connections")
    return {
      name: "",
      engine: "oracle",
      host: "",
      port: 1521,
      database: "",
      username: "",
      password: "",
      admin_password: "",
      timeout_seconds: 30,
      max_rows: 1000,
      options: { identifier_type: "service" },
      enabled: false,
    };
  if (tab === "recipients")
    return {
      name: "",
      address: "",
      kind: "phone",
      user: null,
      active: false,
      manual_enabled: true,
    };
  if (tab === "grants")
    return {
      report: "",
      recipient: "",
      active: false,
      manual: true,
      automatic: true,
      parameters: {},
    };
  return {
    report: "",
    recipient: "",
    send_time: "09:00",
    weekdays: [0, 1, 2, 3, 4],
    parameters: {},
    enabled: false,
  };
}
export default function ReportWorkspace({
  unit,
  admin,
  operate,
}: {
  unit: string;
  admin: boolean;
  operate: boolean;
}) {
  const initial = new URLSearchParams(location.search).get("reportTab") as Tab;
  const [tab, setTab] = useState<Tab>(initial in names ? initial : "reports"),
    [rows, setRows] = useState<Row[]>([]),
    [count, setCount] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const isReports = tab === "reports" || tab === "review";
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [connectionFilter, setConnectionFilter] = useState("");
  const [sqlFilter, setSqlFilter] = useState("");
  const [grantReportFilter, setGrantReportFilter] = useState("");
  const [grantRecipientFilter, setGrantRecipientFilter] = useState("");
  const [permissionFilter, setPermissionFilter] = useState("");
  const [recipientKindFilter, setRecipientKindFilter] = useState("");
  const [scheduleFilters, setScheduleFilters] = useState<ScheduleFilters>({search:"",report:"",recipient:"",status:"",weekday:"",timeFrom:"",timeTo:"",recipientKind:""});
  const [catalog, setCatalog] = useState<Row[]>([]),
    [connections, setConnections] = useState<Row[]>([]),
    [recipients, setRecipients] = useState<Row[]>([]),
    [users, setUsers] = useState<Row[]>([]);
  const [modal, setModal] = useState<{
      kind: "edit" | "run" | "verify" | "preview";
      row: Row;
      tab: Tab;
    } | null>(null),
    [form, setForm] = useState<Row>({}),
    [json, setJson] = useState("{}"),
    [components, setComponents] = useState("[]"),
    [keywords, setKeywords] = useState(""),
    [preview, setPreview] = useState<Row | null>(null),
    [inventory, setInventory] = useState<Row | null>(null);
  useEffect(() => {
    setModal(null);
    setPage(1);
    setSearch("");
    setSourceFilter("");
    setStatusFilter("");
    setConnectionFilter("");
    setSqlFilter("");
    setGrantReportFilter("");
    setGrantRecipientFilter("");
    setPermissionFilter("");
    setRecipientKindFilter("");
    setScheduleFilters({search:"",report:"",recipient:"",status:"",weekday:"",timeFrom:"",timeTo:"",recipientKind:""});
  }, [unit, tab]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    request<{ results: Row[]; count: number }>(
      query(resources[tab], {
        unit,
        page: String(page),
        ...(isReports ? { search, section: tab === "review" ? "review" : "reports", source: sourceFilter, status: statusFilter, connection: connectionFilter, sql: sqlFilter } : {}),
        ...(tab === "grants" ? {search, report:grantReportFilter, recipient:grantRecipientFilter, status:statusFilter, permission:permissionFilter, recipient_kind:recipientKindFilter} : {}),
        ...(tab === "automations" ? {search:scheduleFilters.search, report:scheduleFilters.report, recipient:scheduleFilters.recipient, status:scheduleFilters.status, weekday:scheduleFilters.weekday, time_from:scheduleFilters.timeFrom, time_to:scheduleFilters.timeTo, recipient_kind:scheduleFilters.recipientKind} : {}),
      }),
    )
      .then((d) => {
        if (alive) {
          setRows(d.results);
          setCount(d.count);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [unit, tab, page, revision, search, sourceFilter, statusFilter, connectionFilter, sqlFilter, grantReportFilter, grantRecipientFilter, permissionFilter, recipientKindFilter, scheduleFilters]);
  useEffect(() => {
    let alive = true;
    const tasks = [
      all("reports", unit),
      admin ? all("report-connections", unit) : Promise.resolve([]),
      all("report-recipients", unit),
      admin
        ? request<Row[]>(query("report-recipients/users", { unit }))
        : Promise.resolve([]),
    ];
    Promise.all(tasks)
      .then(([a, b, c, d]) => {
        if (alive) {
          setCatalog(a);
          setConnections(b || []);
          setRecipients(c || []);
          setUsers(d || []);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [unit, admin, revision]);
  useEffect(() => {
    if (!admin) {
      setInventory(null);
      return;
    }
    let alive = true;
    request<Row>(query("reports/inventory", { unit }))
      .then((d) => {
        if (alive) setInventory(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [unit, admin, revision]);
  useEffect(() => {
    if (modal?.kind !== "edit" || modal.tab !== "reports" || !modal.row.id) return;
    let alive = true;
    request<Row>(query(`reports/${modal.row.id}`, { unit }))
      .then(d => {if (alive) setModal(current => current ? {...current, row:{...current.row, parameter_audit:d.parameter_audit}} : current);})
      .catch(e => {if (alive) setError(e.message);});
    return () => {alive = false;};
  }, [modal?.kind, modal?.tab, modal?.row.id, unit]);
  const update = (key: string, value: any) =>
    setForm((f) => ({ ...f, [key]: value }));
  function open(kind: "edit" | "run" | "verify" | "preview", row?: Row) {
    const editTab = tab === "review" ? "reports" : tab;
    const value = seed(editTab, row);
    setForm(
      kind === "run" || kind === "preview"
        ? { report: row?.id || "", recipient: "", parameters: {} }
        : kind === "verify"
          ? { evidence: "" }
          : value,
    );
    setJson(
      JSON.stringify(
        isReports
          ? value.parameter_schema || {}
          : value.parameters || {},
        null,
        2,
      ),
    );
    setComponents(JSON.stringify(value.components || [], null, 2));
    setKeywords((value.keywords || []).join("\n"));
    setError("");
    setModal({ kind, row: row || {}, tab: editTab });
    setPreview(null);
  }
  async function post(path: string, data: Row) {
    setBusy(true);
    setError("");
    try {
      const value = await request<Row>(query(path, { unit }), "POST", data);
      setRevision((v) => v + 1);
      return value;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    try {
      if (modal.kind === "verify") {
        await post(`report-recipients/${modal.row.id}/verify`, {
          version: modal.row.version,
          evidence: form.evidence,
        });
        setModal(null);
        return;
      }
      if (modal.kind === "run" || modal.kind === "preview") {
        const report = catalog.find((r) => r.id === Number(form.report));
        if (!report) throw new Error("Selecione o relatório.");
        const data = {
          report: report.id,
          parameters: form.parameters,
          ...(form.recipient ? { recipient: Number(form.recipient) } : {}),
        };
        if (modal.kind === "preview") {
          setPreview(await post(`reports/${report.id}/preview`, data));
          return;
        }
        await post("report-executions", data);
        setModal(null);
        changeTab("executions");
        return;
      }
      const t = modal.tab;
      let data: Row = {};
      const fields: Record<string, string[]> = {
        reports: [
          "name",
          "code",
          "source",
          "connection",
          "query_sql",
          "output_format",
          "enabled",
          "reviewed",
          "manual_enabled",
        ],
        connections: [
          "name",
          "engine",
          "host",
          "port",
          "database",
          "username",
          "timeout_seconds",
          "max_rows",
          "options",
          "enabled",
          "admin_password",
        ],
        recipients: [
          "name",
          "address",
          "kind",
          "user",
          "active",
          "manual_enabled",
        ],
        grants: ["report", "recipient", "active", "manual", "automatic"],
        automations: [
          "report",
          "recipient",
          "send_time",
          "weekdays",
          "enabled",
        ],
      };
      for (const key of fields[t] || []) data[key] = form[key];
      if (t === "reports") {
        data.connection = form.connection ? Number(form.connection) : null;
        data.parameter_schema = JSON.parse(json);
        data.components = JSON.parse(components);
        data.keywords = keywords
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);
        data.keyword = data.keywords[0]?.slice(0, 80) || "";
      }
      if (t === "connections" && form.password) data.password = form.password;
      if (t === "grants" || t === "automations") {
        data.parameters = JSON.parse(json);
        data.report = Number(data.report);
        data.recipient = Number(data.recipient);
      }
      if (modal.row.id) data.version = modal.row.version;
      await post(
        resources[t] + (modal.row.id ? `/${modal.row.id}/configure` : ""),
        data,
      );
      setModal(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function changeTab(t: Tab) {
    setTab(t);
    setPage(1);
    const url = new URL(location.href);
    url.searchParams.set("reportTab", t);
    history.replaceState(history.state, "", url);
  }
  const selected = catalog.find((r) => r.id === Number(form.report));
  const filtered =
    !isReports && tab !== "grants" && search
      ? rows.filter((r) =>
          JSON.stringify([r.name, r.report_name, r.recipient_name, r.address])
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase()),
        )
      : rows;
  const reportSelect = (
    <Field label="Relatório">
      <select
        required
        value={form.report || ""}
        onChange={(e) => update("report", Number(e.target.value))}
      >
        <option value="">Selecione</option>
        {catalog.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} · {r.code}
          </option>
        ))}
      </select>
    </Field>
  );
  const recipientSelect = (
    <Field label="Destinatário">
      <select
        required
        value={form.recipient || ""}
        onChange={(e) => update("recipient", Number(e.target.value))}
      >
        <option value="">Selecione</option>
        {recipients.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} · {r.kind === "group" ? "Grupo" : r.address}
          </option>
        ))}
      </select>
    </Field>
  );
  const input = (
    name: string,
    label: string,
    type = "text",
    required = false,
  ) => (
    <Field label={label}>
      <input
        type={type}
        step={type === "time" ? 1 : undefined}
        required={required}
        value={form[name] ?? ""}
        onChange={(e) =>
          update(
            name,
            type === "number" ? Number(e.target.value) : e.target.value,
          )
        }
      />
    </Field>
  );
  const check = (name: string, label: string) => (
    <label className="report-check">
      <input
        type="checkbox"
        checked={!!form[name]}
        onChange={(e) => update(name, e.target.checked)}
      />
      {label}
    </label>
  );
  return (
    <div className="report-workspace">
      <div className="report-tabs" role="tablist" aria-label="Relatórios">
        {(Object.keys(names) as Tab[])
          .filter((t) => admin || t === "reports" || t === "executions")
          .map((t) => (
            <button
              role="tab"
              aria-selected={tab === t}
              key={t}
              className={`${tab === t ? "active" : ""} ${t === "review" ? "report-review-tab" : ""}`}
              onClick={() => changeTab(t)}
            >
              {t === "review" && <Trash2 size={15} />}
              {names[t]}
              {t === "review" && inventory && <span className="report-tab-count">{inventory.review_count || 0}</span>}
            </button>
          ))}
      </div>
      {error && !modal && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {admin && inventory?.legacy_import?.issues?.length > 0 && (
        <details className="report-inventory">
          <summary>
            <AlertTriangle size={15} /> {inventory?.legacy_import.issues.length}{" "}
            vínculos legados pendentes
          </summary>
          <ul>
            {inventory?.legacy_import.issues.map((issue: Row, i: number) => (
              <li key={i}>
                {issue.kind === "orphan_permission"
                  ? "Permissão sem destinatário ou relatório"
                  : issue.kind === "orphan_keyword"
                    ? "Palavra-chave sem relatório"
                    : issue.kind}{" "}
                · relatório {issue.record.ID_RELATORIO} · destinatário{" "}
                {issue.record.ID_ADM || "—"}
              </li>
            ))}
          </ul>
        </details>
      )}
      <section className="panel">
        <div className="report-list-heading">
          <div>
            <h2>{names[tab]}</h2>
            <span>{count} registros</span>
          </div>
          <div className="report-actions">
            <button
              className="button"
              aria-label="Atualizar"
              onClick={() => setRevision((v) => v + 1)}
            >
              <RefreshCw size={15} />
            </button>
            {isReports && operate && (
              <button className="button" onClick={() => open("run")}>
                <Play size={15} />
                Gerar
              </button>
            )}
            {admin && tab !== "executions" && tab !== "review" && (
              <button className="button primary" onClick={() => open("edit")}>
                <Plus size={16} />
                Adicionar
              </button>
            )}
          </div>
        </div>
        {isReports && (
          <div className="report-filters">
            <div className="report-search">
              <Search size={16} />
              <input aria-label="Buscar relatório" placeholder="Buscar relatório ou código" value={search} onChange={(e) => {setSearch(e.target.value); setPage(1);}} />
            </div>
            <label><span>Origem</span><select value={sourceFilter} onChange={(e) => {setSourceFilter(e.target.value); setPage(1);}}><option value="">Todas as origens</option>{Object.entries(sources).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label><span>Situação</span><select value={statusFilter} onChange={(e) => {setStatusFilter(e.target.value); setPage(1);}}><option value="">Todas as situações</option><option value="enabled">Ativos</option><option value="disabled">Desativados</option><option value="reviewed">Revisados</option><option value="unreviewed">Revisão pendente</option></select></label>
            {admin && <label><span>Conexão</span><select value={connectionFilter} onChange={(e) => {setConnectionFilter(e.target.value); setPage(1);}}><option value="">Todas as conexões</option>{connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
            <label><span>Consulta</span><select value={sqlFilter} onChange={(e) => {setSqlFilter(e.target.value); setPage(1);}}><option value="">Com ou sem SQL</option><option value="yes">Com SQL cadastrado</option><option value="no">Sem SQL cadastrado</option></select></label>
            {(search || sourceFilter || statusFilter || connectionFilter || sqlFilter) && <button className="button" onClick={() => {setSearch(""); setSourceFilter(""); setStatusFilter(""); setConnectionFilter(""); setSqlFilter(""); setPage(1);}}>Limpar filtros</button>}
          </div>
        )}
        {tab === "grants" && (
          <div className="report-filters">
            <div className="report-search"><Search size={16}/><input aria-label="Buscar permissões" placeholder="Relatório, destinatário ou telefone" value={search} onChange={e => {setSearch(e.target.value);setPage(1);}}/></div>
            <label><span>Relatório</span><select value={grantReportFilter} onChange={e => {setGrantReportFilter(e.target.value);setPage(1);}}><option value="">Todos os relatórios</option>{catalog.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label><span>Destinatário</span><select value={grantRecipientFilter} onChange={e => {setGrantRecipientFilter(e.target.value);setPage(1);}}><option value="">Todos os destinatários</option>{recipients.map(r => <option key={r.id} value={r.id}>{r.name} · {r.address}</option>)}</select></label>
            <label><span>Situação</span><select value={statusFilter} onChange={e => {setStatusFilter(e.target.value);setPage(1);}}><option value="">Todas as situações</option><option value="active">Ativas</option><option value="inactive">Desativadas</option></select></label>
            <label><span>Permissão</span><select value={permissionFilter} onChange={e => {setPermissionFilter(e.target.value);setPage(1);}}><option value="">Todas as permissões</option><option value="manual">Permite solicitação manual</option><option value="automatic">Permite envio automático</option><option value="both">Manual e automática</option><option value="neither">Nenhuma modalidade</option></select></label>
            <label><span>Tipo de destinatário</span><select value={recipientKindFilter} onChange={e => {setRecipientKindFilter(e.target.value);setPage(1);}}><option value="">Telefones e grupos</option><option value="phone">Telefone</option><option value="group">Grupo</option></select></label>
            {(search || grantReportFilter || grantRecipientFilter || statusFilter || permissionFilter || recipientKindFilter) && <button className="button" onClick={() => {setSearch("");setGrantReportFilter("");setGrantRecipientFilter("");setStatusFilter("");setPermissionFilter("");setRecipientKindFilter("");setPage(1);}}>Limpar filtros</button>}
          </div>
        )}
        {tab === "automations" && <ReportScheduleFilters value={scheduleFilters} reports={catalog as any} recipients={recipients as any} onChange={value => {setScheduleFilters(value); setPage(1);}}/>}
        {loading ? (
          <div className="empty">Carregando…</div>
        ) : !filtered.length ? (
          <Empty text="Nenhum registro." />
        ) : (
          <div className="report-table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>
                    {tab === "connections"
                      ? "Conexão"
                      : tab === "recipients"
                        ? "Destinatário"
                        : "Relatório"}
                  </th>
                  <th>
                    {isReports
                      ? "Origem"
                      : tab === "connections"
                        ? "Banco"
                        : tab === "recipients"
                          ? "Telefone / grupo"
                          : "Destinatário"}
                  </th>
                  <th>
                    {tab === "automations" ? "Dias e horário" : "Situação"}
                  </th>
                  <th>
                    {tab === "grants"
                      ? "Modalidades"
                      : tab === "executions"
                        ? "Criado em"
                        : "Pendências"}
                  </th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name || r.report_name}</strong>
                      <small>
                        {r.code ||
                          (r.engine &&
                            (r.legacy?.source_config
                              ? `Destino: ${engines[r.engine]}`
                              : engines[r.engine])) ||
                          (r.origin &&
                            ((
                              {
                                panel: "Painel",
                                automatic: "Automático",
                                whatsapp: "WhatsApp",
                              } as Record<string, string>
                            )[r.origin] ||
                              r.origin))}
                      </small>
                    </td>
                    <td>
                      {isReports ? (
                        <>
                          <span>{sources[r.source] || r.source}</span>
                          <small>{r.connection_name || "—"}</small>
                        </>
                      ) : tab === "connections" ? (
                        <>
                          {r.engine === "sqlite"
                            ? "Arquivo local"
                            : r.host || "Destino pendente"}
                          <small>{r.database || "Destino pendente"}</small>
                        </>
                      ) : tab === "recipients" ? (
                        <span className="report-address">{r.address}</span>
                      ) : (
                        r.recipient_name || "Painel"
                      )}
                    </td>
                    <td>
                      {tab === "automations" ? (
                        <>
                          <span>
                            {(r.weekdays || [])
                              .map((d: number) => days[d])
                              .join(" · ")}
                          </span>
                          <small>{r.send_time}</small>
                          <span
                            className={`report-state ${r.enabled ? "on" : ""}`}
                          >
                            {r.enabled ? "Ativa" : "Desativada"}
                          </span>
                        </>
                      ) : (
                        <span
                          className={`report-state ${r.enabled || r.active || r.state === "ready" ? "on" : ""}`}
                        >
                          {tab === "executions"
                            ? states[r.state] || r.state
                            : r.enabled || r.active
                              ? "Ativo"
                              : "Desativado"}
                        </span>
                      )}
                    </td>
                    <td>
                      {tab === "grants" ? (
                        <span>
                          {[r.manual && "Manual", r.automatic && "Automático"]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                      ) : tab === "executions" ? (
                        <>
                          <span>{dateTime(r.created_at)}</span>
                          <small>
                            {states[r.delivery_state] || r.delivery_state}
                          </small>
                          {r.error_code && <small>{r.error_code}</small>}
                        </>
                      ) : (
                        <>
                          {r.pending_items?.length ||
                          (tab === "connections" && !r.validated) ||
                          (tab === "recipients" && !r.verified_at) ? (
                            <span
                              className="report-warning"
                              title={(r.pending_items || []).join("\n")}
                            >
                              <AlertTriangle size={15} />
                              {r.pending_items?.length
                                ? `${r.pending_items.length} pendência${r.pending_items.length > 1 ? "s" : ""}`
                                : tab === "connections"
                                  ? "Validar conexão"
                                  : "Verificar destinatário"}
                            </span>
                          ) : (
                            <span className="report-ok">
                              <Check size={14} />
                              Revisado
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <div className="report-actions">
                        {isReports && admin && (
                          <button className="button" title={r.review_queue ? "Restaurar em Relatórios" : "Mover para Revisar"} aria-label={`${r.review_queue ? "Restaurar" : "Revisar"} ${r.name}`} disabled={busy} onClick={() => {void post(`reports/${r.id}/configure`, {version:r.version, review_queue:!r.review_queue, ...(r.review_queue ? {} : {enabled:false})}).catch(() => {});}}>
                            {r.review_queue ? <Undo2 size={15} /> : <Trash2 size={15} />}
                          </button>
                        )}
                        {tab === "executions" && r.state === "ready" ? (
                          <a
                            className="button"
                            href={query(`report-executions/${r.id}/download`, {
                              unit,
                            })}
                          >
                            <Download size={14} />
                            Baixar
                          </a>
                        ) : null}
                        {admin && tab !== "executions" && (
                          <button
                            className="button"
                            title="Editar"
                            aria-label={`Editar ${r.name || r.report_name}`}
                            onClick={() => open("edit", r)}
                          >
                            <Edit3 size={14} />
                          </button>
                        )}
                        {admin && tab === "connections" && (
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() =>
                              void post(`report-connections/${r.id}/test`, {
                                version: r.version,
                              }).catch(() => {})
                            }
                          >
                            Testar
                          </button>
                        )}
                        {admin && tab === "recipients" && !r.verified_at && (
                          <button
                            className="button"
                            onClick={() => open("verify", r)}
                          >
                            <ShieldCheck size={14} />
                            Verificar
                          </button>
                        )}
                        {operate && isReports && r.enabled && (
                          <button
                            className="button"
                            title="Gerar relatório"
                            onClick={() => open("run", r)}
                          >
                            <Play size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="op-pager">
          <span>
            Página {page} · {count} registros
          </span>
          <button
            className="button"
            disabled={page === 1 || loading}
            onClick={() => setPage((v) => v - 1)}
          >
            Anterior
          </button>
          <button
            className="button"
            disabled={page * 50 >= count || loading}
            onClick={() => setPage((v) => v + 1)}
          >
            Próxima
          </button>
        </div>
      </section>
      {modal && (
        <InlineDialog
          className={`report-dialog ${
            modal.kind === "verify" ||
            (modal.kind === "edit" &&
              (modal.tab === "recipients" ||
                modal.tab === "grants" ||
                modal.tab === "automations")) ||
            (modal.kind === "run" && !preview)
              ? "report-dialog-compact"
              : ""
          }`.trim()}
          title={
            modal.kind === "run"
              ? "Gerar relatório"
              : modal.kind === "preview"
                ? "Testar consulta"
                : modal.kind === "verify"
                  ? "Verificar destinatário"
                  : `${modal.row.id ? "Editar" : "Adicionar"} · ${names[modal.tab]}`
          }
          subtitle={modal.row.name || modal.row.report_name || ""}
          busy={busy}
          onClose={() => setModal(null)}
          footer={
            <footer className="report-dialog-footer">
              {admin &&
                modal.kind === "edit" &&
                modal.tab === "reports" &&
                modal.row.id &&
                modal.row.source === "sql" && (
                  <button
                    type="button"
                    className="button report-footer-secondary"
                    disabled={busy}
                    onClick={() => open("preview", modal.row)}
                  >
                    <Play size={14} />
                    Testar consulta salva
                  </button>
                )}
              <div className="report-dialog-footer-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  Cancelar
                </button>
                <button
                  className="button primary"
                  type="submit"
                  form="report-editor"
                  disabled={busy}
                >
                  {busy
                    ? "Processando…"
                    : modal.kind === "run"
                      ? "Gerar"
                      : modal.kind === "preview"
                        ? "Testar"
                        : modal.kind === "verify"
                          ? "Confirmar verificação"
                          : "Salvar"}
                </button>
              </div>
            </footer>
          }
        >
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <form id="report-editor" className="report-editor" onSubmit={save}>
            {modal.kind === "run" || modal.kind === "preview" ? (
              <>
                <div
                  className={
                    admin ? "report-form-grid" : "report-editor-single"
                  }
                >
                  {reportSelect}
                  {admin && (
                    <Field label="Destinatário (opcional)">
                      <select
                        value={form.recipient || ""}
                        onChange={(e) => update("recipient", e.target.value)}
                      >
                        <option value="">Somente gerar no painel</option>
                        {recipients
                          .filter((r) => r.active)
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                  )}
                </div>
                {selected?.pending_items?.length > 0 && (
                  <div className="report-warning-box">
                    <AlertTriangle size={16} />
                    <ul>
                      {selected?.pending_items.map((x: string, i: number) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Object.keys(selected?.parameter_schema || {}).length > 0 && (
                  <div className="report-form-grid">
                    {Object.entries(selected?.parameter_schema || {}).map(
                      ([key, spec]) => (
                        <Field label={key} key={key}>
                          <input
                            required={(spec as Row).required !== false}
                            type={
                              (spec as Row).type === "date"
                                ? "date"
                                : (spec as Row).type === "integer" ||
                                    (spec as Row).type === "number"
                                  ? "number"
                                  : "text"
                            }
                            value={form.parameters?.[key] ?? ""}
                            onChange={(e) =>
                              update("parameters", {
                                ...form.parameters,
                                [key]: e.target.value,
                              })
                            }
                          />
                        </Field>
                      ),
                    )}
                  </div>
                )}
                {preview && (
                  <div className="report-preview">
                    <strong>{preview.total} linhas · prévia de até 20</strong>
                    <pre>
                      {JSON.stringify(
                        { colunas: preview.columns, linhas: preview.rows },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                )}
              </>
            ) : modal.kind === "verify" ? (
              <>{input("evidence", "Evidência da verificação", "text", true)}</>
            ) : (
              <>
                {modal.tab === "reports" && (
                  <>
                    {modal.row.pending_items?.length > 0 && (
                      <div className="report-warning-box">
                        <AlertTriangle size={16} />
                        <ul>
                          {modal.row.pending_items.map(
                            (v: string, i: number) => (
                              <li key={i}>{v}</li>
                            ),
                          )}
                        </ul>
                      </div>
                    )}
                    <div className="report-form-grid report-form-grid-title">
                      {input("name", "Nome", "text", true)}
                      {input("code", "Código", "text", true)}
                    </div>
                    <div className="report-form-grid report-form-grid-3">
                      <Field label="Origem">
                        <select
                          value={form.source}
                          onChange={(e) => update("source", e.target.value)}
                        >
                          {Object.entries(sources).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Conexão">
                        <select
                          value={form.connection || ""}
                          onChange={(e) => update("connection", e.target.value)}
                        >
                          <option value="">Pendente</option>
                          {connections.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} · {engines[c.engine]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Formato">
                        <select
                          value={form.output_format}
                          onChange={(e) =>
                            update("output_format", e.target.value)
                          }
                        >
                          <option value="pdf">PDF</option>
                          <option value="csv">CSV</option>
                          <option value="text">Texto</option>
                        </select>
                      </Field>
                    </div>
                    <div className="report-status-bar">
                      <div className="report-checks">
                        {check("reviewed", "Definição revisada")}
                        {check("manual_enabled", "Permitir solicitação manual")}
                        {check("enabled", "Ativo")}
                      </div>
                    </div>
                    {form.source === "sql" && (
                      <Field label="Consulta SQL">
                        <textarea
                          className="report-code report-code-sql"
                          rows={8}
                          spellCheck={false}
                          value={form.query_sql}
                          onChange={(e) => update("query_sql", e.target.value)}
                          placeholder="SELECT coluna FROM schema.view WHERE data >= :data_inicial"
                        />
                      </Field>
                    )}
                    {form.source === "composite" && (
                      <Field label="Componentes (JSON: code e parameters)">
                        <textarea
                          className="report-code"
                          rows={5}
                          value={components}
                          onChange={(e) => setComponents(e.target.value)}
                        />
                      </Field>
                    )}
                    <ReportParameterAudit report={modal.row} />
                    <div className="report-form-grid">
                      <Field label="Parâmetros (JSON)">
                        <textarea
                          className="report-code"
                          rows={5}
                          value={json}
                          onChange={(e) => setJson(e.target.value)}
                          placeholder={
                            '{"data_inicial":{"type":"date","required":true}}'
                          }
                        />
                      </Field>
                      <Field label="Palavras-chave (uma por linha)">
                        <textarea
                          rows={5}
                          value={keywords}
                          onChange={(e) => setKeywords(e.target.value)}
                        />
                      </Field>
                    </div>
                    {(modal.row.source_path ||
                      modal.row.legacy?.source_path) && (
                      <details className="report-collapsible">
                        <summary>Caminho dos dados</summary>
                        <div className="report-collapsible-body">
                          <p className="report-source-description">
                            {modal.row.source_path ||
                              modal.row.legacy.source_path}
                          </p>
                        </div>
                      </details>
                    )}
                    {modal.row.legacy?.source && (
                      <details className="report-collapsible">
                        <summary>Definição original do legado</summary>
                        <div className="report-collapsible-body">
                          <pre className="report-legacy">
                            {JSON.stringify(modal.row.legacy, null, 2)}
                          </pre>
                        </div>
                      </details>
                    )}
                  </>
                )}
                {modal.tab === "connections" && (
                  <>
                    <div className="report-form-grid report-form-grid-title">
                      {input("name", "Nome", "text", true)}
                      <Field label="Banco">
                        <select
                          value={form.engine}
                          onChange={(e) => {
                            const engine = e.target.value;
                            update("engine", engine);
                            update(
                              "port",
                              (
                                {
                                  oracle: 1521,
                                  postgres: 5432,
                                  mysql: 3306,
                                  firebird: 3050,
                                  sqlite: 0,
                                } as Record<string, number>
                              )[engine] || 1521,
                            );
                          }}
                        >
                          {Object.entries(engines).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    {form.engine !== "sqlite" && (
                      <div className="report-form-grid report-form-grid-host">
                        {input("host", "Host", "text", true)}
                        {input("port", "Porta", "number", true)}
                      </div>
                    )}
                    <div
                      className={
                        form.engine === "oracle"
                          ? "report-form-grid"
                          : "report-editor-single"
                      }
                    >
                      {input(
                        "database",
                        form.engine === "sqlite"
                          ? "Arquivo SQLite (/app/report_sources/…)"
                          : form.engine === "oracle"
                            ? "Service name / SID"
                            : "Banco de dados",
                        "text",
                        true,
                      )}
                      {form.engine === "oracle" && (
                        <Field label="Identificador Oracle">
                          <select
                            value={form.options?.identifier_type || "service"}
                            onChange={(e) =>
                              update("options", {
                                ...form.options,
                                identifier_type: e.target.value,
                              })
                            }
                          >
                            <option value="service">Service name</option>
                            <option value="sid">SID</option>
                          </select>
                        </Field>
                      )}
                    </div>
                    {form.engine !== "sqlite" && (
                      <div className="report-form-grid">
                        {input("username", "Usuário", "text", true)}
                        {input(
                          "password",
                          form.has_password ? "Nova senha (opcional)" : "Senha",
                          "password",
                          !form.has_password,
                        )}
                      </div>
                    )}
                    <div className="report-form-grid report-form-grid-3">
                      {input(
                        "admin_password",
                        "Senha do administrador",
                        "password",
                        true,
                      )}
                      {input(
                        "timeout_seconds",
                        "Tempo limite (segundos)",
                        "number",
                        true,
                      )}
                      {input("max_rows", "Limite de linhas", "number", true)}
                    </div>
                    <div className="report-status-bar">
                      <div className="report-checks">
                        {check("enabled", "Ativa")}
                      </div>
                      {!form.validated && (
                        <span className="report-warning">
                          <AlertTriangle size={15} />
                          Salve e teste a conexão antes de ativar.
                        </span>
                      )}
                    </div>
                  </>
                )}
                {modal.tab === "recipients" && (
                  <>
                    <div className="report-form-grid">
                      {input("name", "Nome", "text", true)}
                      <Field label="Tipo">
                        <select
                          value={form.kind}
                          onChange={(e) => update("kind", e.target.value)}
                        >
                          <option value="phone">Telefone</option>
                          <option value="group">Grupo WhatsApp</option>
                        </select>
                      </Field>
                      {input(
                        "address",
                        form.kind === "group"
                          ? "Identificador do grupo (@g.us)"
                          : "Telefone",
                        "text",
                        true,
                      )}
                      <Field label="Usuário do SCV Messenger">
                        <select
                          value={form.user || ""}
                          onChange={(e) =>
                            update(
                              "user",
                              e.target.value ? Number(e.target.value) : null,
                            )
                          }
                        >
                          <option value="">Sem vínculo com usuário</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.username}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="report-status-bar">
                      <div className="report-checks">
                        {check("active", "Ativo")}
                        {check(
                          "manual_enabled",
                          "Permitir solicitações manuais",
                        )}
                      </div>
                      {form.kind === "group" && (
                        <span className="report-warning">
                          <AlertTriangle size={15} />
                          Transporte de grupos pendente.
                        </span>
                      )}
                    </div>
                  </>
                )}
                {(modal.tab === "grants" || modal.tab === "automations") && (
                  <>
                    <div className="report-form-grid">
                      {reportSelect}
                      {recipientSelect}
                    </div>
                    {modal.tab === "grants" ? (
                      <div className="report-status-bar">
                        <div className="report-checks">
                          {check("active", "Permissão ativa")}
                          {check("manual", "Solicitação manual")}
                          {check("automatic", "Envio automático")}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="report-form-grid report-form-grid-schedule">
                          {input("send_time", "Horário", "time", true)}
                          <div className="op-field">
                            <span className="report-field-label">
                              Dias da semana
                            </span>
                            <div className="report-weekdays">
                              {days.map((d, i) => (
                                <label key={d}>
                                  <input
                                    type="checkbox"
                                    checked={form.weekdays?.includes(i)}
                                    onChange={(e) =>
                                      update(
                                        "weekdays",
                                        e.target.checked
                                          ? [...form.weekdays, i].sort()
                                          : form.weekdays.filter(
                                              (v: number) => v !== i,
                                            ),
                                      )
                                    }
                                  />
                                  <span>{d}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="report-status-bar">
                          <div className="report-checks">
                            {check("enabled", "Programação ativa")}
                          </div>
                        </div>
                      </>
                    )}
                    <Field label="Parâmetros da execução (JSON)">
                      <textarea
                        className="report-code"
                        rows={5}
                        value={json}
                        onChange={(e) => setJson(e.target.value)}
                      />
                    </Field>
                    {modal.row.legacy?.record && (
                      <details className="report-collapsible">
                        <summary>Configuração original</summary>
                        <div className="report-collapsible-body">
                          <pre className="report-legacy">
                            {JSON.stringify(modal.row.legacy, null, 2)}
                          </pre>
                        </div>
                      </details>
                    )}
                  </>
                )}
              </>
            )}
          </form>
          {modal.kind === "edit" &&
            modal.tab === "connections" &&
            modal.row.legacy?.source_description && (
              <details className="report-collapsible report-source-details">
                <summary>Origem legada e caminho dos dados</summary>
                <div className="report-collapsible-body">
                  <p className="report-source-description">
                    {modal.row.legacy.source_description}
                  </p>
                  <dl className="report-source-fields">
                    <dt>Método</dt>
                    <dd>{modal.row.legacy.data_access_method}</dd>
                    <dt>DBLINK</dt>
                    <dd>{modal.row.legacy.dblink_status}</dd>
                    <dt>Procedures/rotinas</dt>
                    <dd>
                      {modal.row.legacy.procedures?.join(", ") ||
                        "Nenhuma identificada no catálogo"}
                    </dd>
                    <dt>Relatórios vinculados</dt>
                    <dd>{modal.row.legacy.report_count}</dd>
                  </dl>
                </div>
              </details>
            )}
        </InlineDialog>
      )}
    </div>
  );
}
