import FormAction from "./components/FormAction";
import { Badge, Empty, Panel, Metric, SearchField } from "./components/ui";
import OperationalAppointments from "./components/OperationalAppointments";
import AppointmentGroups from "./components/AppointmentGroups";
import ExecutionLogs from "./components/ExecutionLogs";
import MetaConfiguration from "./components/MetaConfiguration";
import OracleConfiguration from "./components/OracleConfiguration";
import UnitDirectory from "./components/UnitDirectory";
import UserDirectory from "./components/UserDirectory";
import { canAccess, permissionsFor, reconcileSession } from "./permissions";
import InlineDialog from "./components/InlineDialog";
import RemoteInstances from "./components/RemoteInstances";
import UnitSelector from "./components/UnitSelector";
import { readRoute, routePath } from "./routes";
import ModalContent from "./components/ModalContent";
import OperationsWorkspace from "./components/OperationsWorkspace";
import { ThemeToggle } from "./components/ThemeToggle";
import { ThemeProvider, useTheme } from "./ThemeContext";
import Login from "./components/Login";
import type { Modal } from "./types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Cloud,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Pause,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  User,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { initCsrf, query, request } from "./api";
import { dateOnly, dateTime, kinds, labels, percentage } from "./format";
import type {
  Appointment,
  Audit,
  Control,
  ImportRun,
  Indicators,
  Issue,
  Message,
  PageName,
  Paginated,
  Reply,
  Rule,
  Session,
  Template,
} from "./types";

const navigation: { id: PageName; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "appointments", label: "Agendamentos", icon: CalendarDays },
  { id: "messages", label: "Mensagens", icon: MessageCircle },
  { id: "groups", label: "Grupos", icon: CalendarDays },
  { id: "issues", label: "Pendências", icon: ClipboardList },
  { id: "campaigns", label: "Importa CROSS", icon: Send },
  { id: "users", label: "Usuários", icon: User },
  { id: "reports", label: "Relatórios", icon: Activity },
  { id: "operationsAdmin", label: "Administração", icon: ShieldCheck },
  { id: "settings", label: "Configurações", icon: Settings2 },
];
type Data = {
  indicators: Indicators;
  appointments: Paginated<Appointment>;
  messages: Paginated<Message>;
  replies: Paginated<Reply>;
  issues: Paginated<Issue>;
  rules: Paginated<Rule>;
  templates: Paginated<Template>;
  imports: Paginated<ImportRun>;
  audit: Paginated<Audit>;
  control: Control;
};

export default function App() {
  return (
    <ThemeProvider>
      <AppRoot />
    </ThemeProvider>
  );
}

function AppRoot() {
  const [session, setSession] = useState<Session | null>(null),
    [checking, setChecking] = useState(true);
  useEffect(() => {
    initCsrf()
      .then(() => request<Session>("/api/v1/auth/session/"))
      .then(setSession)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!session) return;
    const refresh = () => { if (document.visibilityState === "visible") request<Session>("/api/v1/auth/session/").then(incoming => setSession(current => current ? reconcileSession(current, incoming) : null)).catch(() => setSession(null)); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [session?.username]);
  if (checking)
    return (
      <div className="boot">
        <div className="logo-symbol" />
        <span>Carregando painel…</span>
      </div>
    );
  if (!session) return <Login onLogin={setSession} />;
  if (!session.units.length) return <div className="boot"><p>Seu usuário não tem acesso a unidades.</p><button className="button" onClick={() => {void request("/api/v1/auth/session/", "POST").finally(()=>setSession(null));}}>Sair</button></div>;
  return (
    <Workspace
      session={session}
      onLogout={() => setSession(null)}
      onSessionRefresh={async () =>
        setSession(await request<Session>("/api/v1/auth/session/"))
      }
    />
  );
}

function Workspace({
  session,
  onLogout,
  onSessionRefresh,
}: {
  session: Session;
  onLogout: () => void;
  onSessionRefresh: () => Promise<void>;
}) {
  const { resolvedTheme } = useTheme(),
    isDark = resolvedTheme === "dark";
  const [page, setPage] = useState<PageName>(() => readRoute().page),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState<Modal>(null),
    [mobile, setMobile] = useState(false);
  const [settingsTab, setSettingsTab] = useState("units");
  const [groupId, setGroupId] = useState<string | null>(
    () => readRoute().groupId,
  );
  useEffect(() => {
    const sync = () => {
      const next = readRoute();
      setPage(next.page);
      setGroupId(next.groupId);
      const slug = new URLSearchParams(window.location.search).get("unit");
      if (slug && session.units.some((item) => item.slug === slug)) {
        setData(null);
        setUnit(slug);
      }
      setModal(null);
      setMobile(false);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [session.units]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("orbita.sidebar.collapsed") === "true";
    } catch {
      return false;
    }
  });
  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      try {
        localStorage.setItem("orbita.sidebar.collapsed", String(!current));
      } catch {
        // Navigation remains usable when browser storage is unavailable.
      }
      return !current;
    });
  }
  const [unit, setUnit] = useState(() => {
      const slug = new URLSearchParams(window.location.search).get("unit");
      return (
        session.units.find((item) => item.slug === slug)?.slug ||
        (slug?.startsWith("remote:") ? slug : "") ||
        session.units[0]?.slug ||
        "ame"
      );
    }),
    [kind, setKind] = useState(""),
    [selectedAppointment, selectAppointment] = useState<number | null>(null),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [search, setSearch] = useState(""),
    [state, setState] = useState(""),
    [responseState, setResponseState] = useState(""),
    [listPage, setListPage] = useState(1);
  const policy = permissionsFor(session, unit);
  const actualRole = session.roles[unit];
  const visibleNavigation = navigation.filter(item => canAccess(session, unit, item.id) && !(unit.startsWith("remote:") && item.id === "users"));
  const role = policy[page] === "write" ? actualRole : "viewer";
  const canOperate = policy[page] === "write" && (actualRole === "admin" || actualRole === "operator");
  useEffect(() => {
    if (!session.units.some(u=>u.slug===unit)) { const next = session.units[0]?.slug; if(next) changeUnit(next); return; }
    if (!visibleNavigation.some(item=>item.id===page) && visibleNavigation[0]) navigate(visibleNavigation[0].id);
  }, [session, unit, page]);
  const selectedUnit = session.units.find((item) => item.slug === unit);
  const isRemote = unit.startsWith("remote:");
  useEffect(() => {
    setSettingsTab(role === "admin" && !isRemote ? "units" : "rules");
  }, [unit, role, isRemote]);
  function changeUnit(slug: string) {
    setData(null);
    setUnit(slug);
    setGroupId(null);
    selectAppointment(null);
    setModal(null);
    setListPage(1);
    setSearch("");
    setState("");
    setResponseState("");
    window.history.pushState(
      {},
      "",
      `${routePath(page)}?unit=${encodeURIComponent(slug)}`,
    );
  }
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setBusy(true);
    setError("");
    try {
      const filters = { unit, kind, start, end };
      const empty = {count:0,next:null,previous:null,results:[]};
      const read = <T,>(section: string, url:string, fallback:unknown): Promise<T> =>
        session.permissions?.[unit]?.[section] && session.permissions[unit][section] !== "none" ? request<T>(url) : Promise.resolve(fallback as T);
      const [
        indicators,
        appointments,
        messages,
        replies,
        issues,
        rules,
        templates,
        imports,
        audit,
        control,
      ] = await Promise.all([
        read<Indicators>("overview", query("indicators", filters), {appointments:0,messages:0,accepted:0,delivered:0,confirmed:0,declined:0,no_response:0,issues:0,synthetic_appointments:0,states:{},responses:{},by_kind:[],trend:[],paused:true}),
        read<Paginated<Appointment>>("appointments",
          query("appointments", {
            ...filters,
            page: String(page === "appointments" ? listPage : 1),
            search: page === "appointments" ? search : "",
          }),
          empty,
        ),
        read<Paginated<Message>>("messages",
          query("messages", {
            ...filters,
            page: String(page === "messages" ? listPage : 1),
            search: page === "messages" ? search : "",
            state: page === "messages" ? state : "",
            response_state: page === "messages" ? responseState : "",
          }),
          empty,
        ),
        read<Paginated<Reply>>("messages",
          query("replies", {
            ...filters,
            page: String(page === "responses" ? listPage : 1),
          }),
          empty,
        ),
        read<Paginated<Issue>>("issues",
          query("issues", {
            ...filters,
            page: String(page === "issues" ? listPage : 1),
          }),
          empty,
        ),
        read<Paginated<Rule>>("settings", query("rules", { unit }), empty),
        read<Paginated<Template>>("settings", query("templates", { unit }), empty),
        read<Paginated<ImportRun>>("settings", query("imports", { unit }), empty),
        read<Paginated<Audit>>("settings", query("audit", { unit }), empty),
        request<Control>(query(session.permissions?.[unit]?.settings && session.permissions[unit].settings !== "none" ? "control" : "workspace", { unit })),
      ]);
      if (sequence !== loadSequence.current) return;
      setData({
        indicators,
        appointments,
        messages,
        replies,
        issues,
        rules,
        templates,
        imports,
        audit,
        control,
      });
    } catch (e) {
      if (sequence === loadSequence.current) {
        setError((e as Error).message);
        if (unit.startsWith("remote:")) setData(null);
      }
    } finally {
      if (sequence === loadSequence.current) setBusy(false);
    }
  }, [unit, kind, start, end, listPage, search, state, responseState, page, session.permissions]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!modal) return;
    const prior = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.querySelector<HTMLElement>("button,input,select,textarea")?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
      if (event.key !== "Tab") return;
      const items = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary",
        ) || [],
      ).filter((item) => item.offsetParent !== null);
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      prior?.focus();
    };
  }, [modal]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function mutate(path: string, body: unknown, message: string) {
    setBusy(true);
    setError("");
    try {
      await request(`/api/v1/${path}/?unit=${unit}`, "POST", body);
      setToast(message);
      setModal(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(
    next: PageName,
    filter = "",
    appointmentId: number | null = null,
  ) {
    selectAppointment(appointmentId);
    setPage(next);
    setGroupId(null);
    window.history.pushState(
      {},
      "",
      `${routePath(next)}?unit=${encodeURIComponent(unit)}`,
    );
    setListPage(1);
    setSearch("");
    setState(filter);
    setResponseState("");
    setMobile(false);
  }
  function cardNavigate(next: PageName, filter: string, response = false) {
    navigate(next, response ? "" : filter);
    if (response) setResponseState(filter);
  }
  const currentTitle = navigation.find((item) => item.id === page)?.label;
  const d = data?.indicators;
  const periodFilter = (
    <div className="date-range">
      <CalendarDays size={15} />
      <input
        type="date"
        aria-label={
          page === "appointments"
            ? "Data inicial do período"
            : "Data inicial do agendamento"
        }
        value={start}
        onChange={(e) => {
          setStart(e.target.value);
          setListPage(1);
        }}
      />
      <span>até</span>
      <input
        type="date"
        aria-label={
          page === "appointments"
            ? "Data final do período"
            : "Data final do agendamento"
        }
        value={end}
        onChange={(e) => {
          setEnd(e.target.value);
          setListPage(1);
        }}
      />
      {(start || end) && (
        <button
          aria-label="Limpar datas"
          className="icon-button"
          onClick={() => {
            setStart("");
            setEnd("");
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
  const activeList =
    page === "appointments"
      ? data?.appointments
      : page === "responses"
        ? data?.replies
        : page === "messages"
          ? data?.messages
          : null;
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {mobile && (
        <button
          className="navigation-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        id="workspace-navigation"
        className={`sidebar ${mobile ? "open" : ""}`}
      >
        <div className="sidebar-heading">
          <div className="brand" aria-label="Órbita">
            <div className="logo-symbol" />
            <span>
              órbita<span className="brand-dot">.</span>
            </span>
          </div>
          <button
            className="sidebar-toggle icon-button"
            aria-label={
              sidebarCollapsed
                ? "Expandir barra lateral"
                : "Recolher barra lateral"
            }
            title={
              sidebarCollapsed
                ? "Expandir barra lateral"
                : "Recolher barra lateral"
            }
            aria-expanded={!sidebarCollapsed}
            aria-controls="workspace-navigation"
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>
        <div className="sidebar-scroll">
          <div className="workspace-label">UNIDADE</div>
          <UnitSelector
            units={session.units}
            value={unit}
            onChange={changeUnit}
            label="Selecionar unidade"
            sidebar
          />
          <span className="nav-label">PRINCIPAL</span>
          <nav>
            {visibleNavigation.map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                className={page === item.id ? "active" : ""}
                aria-label={item.label}
                aria-current={page === item.id ? "page" : undefined}
                title={item.label}
              >
                <item.icon size={19} />
                <span>{item.label}</span>
                {item.id === "issues" && !!d?.issues && <b>{d.issues}</b>}
                {page === item.id && <i />}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <a
            className="support-link"
            href={`/guia.html?tela=${page === "groups" && groupId ? "groupDetail" : page}&unit=${encodeURIComponent(unit)}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Ajuda e documentação"
            title={`Ajuda · ${navigation.find((item) => item.id === page)?.label || "Página atual"}`}
          >
            <CircleHelp size={18} />
            <span>Ajuda e documentação</span>
            <ArrowRight size={15} />
          </a>
          <div className="sidebar-user">
            <div className="avatar">
              {session.username.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <strong>{session.username}</strong>
              <small>
                {role === "admin"
                  ? "Administrador"
                  : role === "operator"
                    ? "Operador"
                    : "Consulta"}
              </small>
            </div>
            <button
              title="Sair"
              aria-label="Sair"
              onClick={async () => {
                await request("/api/v1/auth/session/", "POST");
                onLogout();
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu icon-button"
              aria-label="Abrir menu"
              aria-expanded={mobile}
              aria-controls="workspace-navigation"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              <span className="breadcrumb-root">Workspace</span>
              <ChevronRight className="breadcrumb-root" size={14} />{" "}
              <strong>{currentTitle}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <ThemeToggle />
            <span className="test-pill">
              <i />
              <span>Ambiente de teste</span>
            </span>
            <button
              className="notification icon-button"
              aria-label="Ver pendências"
              onClick={() => navigate("issues")}
            >
              <Bell size={19} />
              {!!d?.issues && <i />}
            </button>
            <span className="topbar-divider" />
            <div className="avatar small">
              {session.username.slice(0, 2).toUpperCase()}
            </div>
          </div>
        </header>
        <main
          className={`content ${page === "appointments" || page === "issues" ? "appointments-page" : ""}`}
        >
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {session.units.find((u) => u.slug === unit)?.name || unit}
              </div>
              <h1>{currentTitle}</h1>
            </div>
            <div className="heading-actions">
              <button
                className="button"
                onClick={() => void load()}
                disabled={busy}
              >
                <RefreshCw size={16} className={busy ? "spin" : ""} />
                Atualizar
              </button>
              {canOperate && ["overview", "appointments"].includes(page) && (
                <button
                  className="button primary"
                  disabled={isRemote}
                  title={
                    isRemote ? "Crie testes na instância de origem" : undefined
                  }
                  onClick={() => setModal({ type: "test" })}
                >
                  <Plus size={17} />
                  Novo teste
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="inline-error" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button className="icon-button" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {page === "users" && !isRemote && <UserDirectory unit={unit} editable={canOperate} onChanged={onSessionRefresh} />}
          {["care", "campaigns", "reports", "operationsAdmin"].includes(page) &&
            !(isRemote && page === "operationsAdmin") && (
              <OperationsWorkspace
                key={`${unit}:${page}`}
                page={page}
                unit={unit}
                role={role}
                username={session.username}
                userAccess={policy.users === "write" || policy.users === "read"}
              />
            )}
          {isRemote && page === "operationsAdmin" && (
            <div className="remote-source-banner">
              <Cloud size={18} />
              <span>
                A administração de usuários e unidades deve ser realizada na
                instância de origem.
              </span>
            </div>
          )}
          {(page === "overview" || page === "messages") && (
            <div className="filters">
              <div className="filter-left">
                <select
                  aria-label="Tipo de agendamento"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setListPage(1);
                  }}
                >
                  <option value="">Todos os agendamentos</option>
                  {Object.entries(kinds).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {periodFilter}
            </div>
          )}
          {!data ? (
            <div className="loading-panels">
              <div />
              <div />
              <div />
            </div>
          ) : (
            <>
              {page === "overview" && (
                <>
                  <div className="metrics-grid">
                    <Metric
                      title="Agendamentos"
                      value={d!.appointments}
                      icon={CalendarDays}
                      tone="neutral"
                      note="Consultas, exames e laboratório"
                      onClick={() => navigate("appointments")}
                    />
                    <Metric
                      title="Mensagens entregues"
                      value={d!.delivered}
                      icon={Send}
                      tone="green"
                      note={`${percentage(d!.delivered, d!.messages)}% das mensagens do período`}
                      onClick={() =>
                        cardNavigate("messages", "delivered_or_read")
                      }
                    />
                    <Metric
                      title="Confirmações recebidas"
                      value={d!.confirmed}
                      icon={CheckCheck}
                      tone="lime"
                      note="Lembretes com confirmação registrada"
                      onClick={() =>
                        cardNavigate("messages", "confirmed", true)
                      }
                    />
                    <Metric
                      title="Pendências abertas"
                      value={d!.issues}
                      icon={TriangleAlert}
                      tone="amber"
                      note="Agendamentos que exigem intervenção"
                      onClick={() => navigate("issues")}
                    />
                  </div>
                  <div className="charts-grid">
                    <Panel
                      title="Mensagens por dia"
                      action={
                        <span className="chart-period">
                          <CalendarDays size={14} />
                          Últimos 7 dias
                        </span>
                      }
                    >
                      <div className="chart-legend">
                        <span>
                          <i
                            style={{
                              background: isDark ? "#ffffff" : "#075B94",
                            }}
                          />
                          Mensagens
                        </span>
                        <span>
                          <i
                            style={{
                              background: isDark ? "#a1a1aa" : "#14B4CB",
                            }}
                          />
                          Entregues
                        </span>
                      </div>
                      <div className="area-chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={d!.trend}
                            margin={{
                              left: -20,
                              right: 16,
                              top: 10,
                              bottom: 0,
                            }}
                          >
                            <defs>
                              <linearGradient
                                id="greenFade"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="0%"
                                  stopColor={isDark ? "#ffffff" : "#075B94"}
                                  stopOpacity={isDark ? 0.2 : 0.16}
                                />
                                <stop
                                  offset="100%"
                                  stopColor={isDark ? "#ffffff" : "#075B94"}
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              strokeDasharray="3 5"
                              vertical={false}
                              stroke={isDark ? "#262626" : "#e2e8f0"}
                            />
                            <XAxis
                              dataKey="day"
                              tickFormatter={(value) =>
                                dateOnly(`${value}T12:00:00-03:00`)
                              }
                              axisLine={false}
                              tickLine={false}
                              tick={{
                                fontSize: 11,
                                fill: isDark ? "#71717a" : "#647d96",
                              }}
                              dy={10}
                            />
                            <YAxis
                              allowDecimals={false}
                              axisLine={false}
                              tickLine={false}
                              tick={{
                                fontSize: 11,
                                fill: isDark ? "#71717a" : "#647d96",
                              }}
                            />
                            <Tooltip
                              labelFormatter={(value) =>
                                dateOnly(`${value}T12:00:00-03:00`)
                              }
                              contentStyle={{
                                borderRadius: 10,
                                border: isDark
                                  ? "1px solid #282828"
                                  : "1px solid #e2e8f0",
                                background: isDark ? "#181818" : "#ffffff",
                                color: isDark ? "#f4f4f5" : "#0f2438",
                                boxShadow: isDark
                                  ? "0 8px 24px rgba(0, 0, 0, 0.6)"
                                  : "0 4px 12px rgba(7, 91, 148, 0.08)",
                                fontSize: 12,
                              }}
                              itemStyle={{
                                color: isDark ? "#f4f4f5" : "#0f2438",
                              }}
                            />
                            <Area
                              isAnimationActive={false}
                              type="monotone"
                              dataKey="messages"
                              name="Mensagens"
                              stroke={isDark ? "#ffffff" : "#075B94"}
                              strokeWidth={2}
                              fill="url(#greenFade)"
                            />
                            <Area
                              isAnimationActive={false}
                              type="monotone"
                              dataKey="delivered"
                              name="Entregues"
                              stroke={isDark ? "#a1a1aa" : "#14B4CB"}
                              strokeWidth={2}
                              strokeDasharray="5 4"
                              fill="transparent"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="chart-footer">
                        <span>
                          <i />
                          Atualizado com o histórico da fila
                        </span>
                        <strong>{d!.messages} mensagens no total</strong>
                      </div>
                    </Panel>
                    <Panel
                      title="Situação das respostas"
                      className="response-panel"
                    >
                      <div className="response-hero">
                        <div
                          className="response-ring"
                          style={{
                            background: `conic-gradient(${isDark ? "#34d399" : "#10b981"} 0 ${percentage(d!.confirmed, d!.messages)}%,#f87171 ${percentage(d!.confirmed, d!.messages)}% ${percentage(d!.confirmed + d!.declined, d!.messages)}%,${isDark ? "#fbbf24" : "#f59e0b"} ${percentage(d!.confirmed + d!.declined, d!.messages)}% ${percentage(d!.confirmed + d!.declined + d!.no_response, d!.messages)}%,${isDark ? "#262626" : "#e2e8f0"} 0)`,
                          }}
                        >
                          <div>
                            <strong>
                              {percentage(d!.confirmed, d!.messages)}
                              <small>%</small>
                            </strong>
                            <span>confirmados</span>
                          </div>
                        </div>
                      </div>
                      <div className="response-breakdown">
                        {[
                          [
                            "confirmed",
                            "Confirmados",
                            isDark ? "#34d399" : "#10b981",
                          ],
                          ["declined", "Não comparecerão", "#f87171"],
                          [
                            "no_response",
                            "Sem resposta no prazo",
                            isDark ? "#fbbf24" : "#f59e0b",
                          ],
                          [
                            "pending",
                            "Aguardando resposta",
                            isDark ? "#71717a" : "#94a3b8",
                          ],
                          [
                            "not_requested",
                            "Sem envio confirmado",
                            isDark ? "#27272a" : "#cbd5e1",
                          ],
                        ].map(([key, label, color]) => (
                          <button
                            key={key}
                            onClick={() => cardNavigate("messages", key, true)}
                          >
                            <span>
                              <i style={{ background: color }} />
                              {label}
                            </span>
                            <strong>{d!.responses[key] || 0}</strong>
                          </button>
                        ))}
                      </div>
                    </Panel>
                  </div>
                </>
              )}
              {page === "appointments" && (
                <OperationalAppointments
                  key={unit}
                  unit={unit}
                  periodFilter={periodFilter}
                  role={role}
                  username={session.username}
                  initialId={selectedAppointment}
                  refreshKey={loadSequence.current}
                  start={start}
                  end={end}
                />
              )}
              {page === "messages" && (
                <Panel
                  title="Histórico de mensagens"
                  subtitle={`${data.messages.count} mensagens · ${state ? labels[state] : "Todas as situações"}`}
                  action={
                    <SearchField
                      value={search}
                      onChange={(v) => {
                        setSearch(v);
                        setListPage(1);
                      }}
                    />
                  }
                >
                  <div className="table-filters">
                    <select
                      aria-label="Situação da mensagem"
                      value={state}
                      onChange={(e) => {
                        setState(e.target.value);
                        setListPage(1);
                      }}
                    >
                      <option value="">Todas as situações</option>
                      {[
                        "preview",
                        "queued",
                        "accepted",
                        "sent",
                        "delivered",
                        "read",
                        "failed",
                        "blocked",
                        "uncertain",
                        "expired",
                        "cancelled",
                      ].map((s) => (
                        <option key={s} value={s}>
                          {labels[s]}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Situação da resposta"
                      value={responseState}
                      onChange={(e) => {
                        setResponseState(e.target.value);
                        setListPage(1);
                      }}
                    >
                      <option value="">Todas as respostas</option>
                      {[
                        "not_requested",
                        "pending",
                        "confirmed",
                        "declined",
                        "no_response",
                        "review",
                      ].map((s) => (
                        <option key={s} value={s}>
                          {labels[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {!data.messages.results.length ? (
                    <Empty />
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Paciente / agendamento</th>
                            <th>Destinatário</th>
                            <th>Envio</th>
                            <th>Resposta</th>
                            <th>Previsto para</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {data.messages.results.map((message) => (
                            <tr
                              key={message.id}
                              onClick={() =>
                                setModal({ type: "message", value: message })
                              }
                              className="clickable"
                            >
                              <td data-label="Paciente / agendamento">
                                <div className="patient-cell">
                                  <span
                                    className="patient-icon"
                                    aria-hidden="true"
                                  >
                                    <User size={15} />
                                  </span>
                                  <div>
                                    <strong>{message.patient}</strong>
                                    <small>{message.procedure}</small>
                                  </div>
                                </div>
                              </td>
                              <td className="mono" data-label="Destinatário">
                                +{message.recipient}
                              </td>
                              <td data-label="Envio">
                                <Badge value={message.state} />
                              </td>
                              <td data-label="Resposta">
                                <Badge value={message.response_state} />
                              </td>
                              <td data-label="Previsto para">
                                {dateTime(message.scheduled_for)}
                              </td>
                              <td className="row-action">
                                <button
                                  className="icon-button"
                                  aria-label={`Ver mensagem de ${message.patient}`}
                                >
                                  <ChevronRight size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              )}
              {page === "groups" && (
                <AppointmentGroups
                  unit={unit}
                  role={role}
                  username={session.username}
                  groupId={groupId}
                  refreshKey={loadSequence.current}
                  onOpen={(id) => {
                    setGroupId(id);
                    window.history.pushState(
                      {},
                      "",
                      `${routePath("groups", id)}?unit=${encodeURIComponent(unit)}`,
                    );
                  }}
                  onBack={() => navigate("groups")}
                />
              )}
              {page === "issues" && (
                <OperationalAppointments
                  key={`${unit}-issues`}
                  unit={unit}
                  role={role}
                  username={session.username}
                  initialId={selectedAppointment}
                  refreshKey={loadSequence.current}
                  start={start}
                  end={end}
                  issuesOnly
                />
              )}
              {page === "settings" && (
                <div className="settings-workspace">
                  <nav className="settings-tabs" aria-label="Configurações">
                    {(
                      [
                        ...(role === "admin" && !isRemote
                          ? [
                              ["units", "Unidades", Building2],
                              ["oracle", "Oracle", Database],
                              ["instances", "Instâncias", Cloud],
                            ]
                          : []),
                        ...(role === "admin"
                          ? [["meta", "WhatsApp", MessageCircle]]
                          : []),
                        ["rules", "Lembretes", Bell],
                        ["activity", "Atividades", Activity],
                        ["logs", "Logs", ClipboardList],
                      ] as [string, string, typeof Activity][]
                    ).map(([id, label, Icon]) => (
                      <button
                        type="button"
                        key={id}
                        className={settingsTab === id ? "active" : ""}
                        aria-current={settingsTab === id ? "page" : undefined}
                        onClick={() => setSettingsTab(id)}
                      >
                        <Icon size={15} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </nav>
                  {settingsTab === "logs" && <ExecutionLogs key={unit} unit={unit} />}
                  {settingsTab === "units" && role === "admin" && !isRemote && (
                    <UnitDirectory unit={unit} onChanged={onSessionRefresh} />
                  )}

                  {settingsTab === "instances" &&
                    role === "admin" &&
                    !isRemote && (
                      <RemoteInstances
                        key={unit}
                        unit={unit}
                        onChanged={onSessionRefresh}
                      />
                    )}
                  {isRemote && (
                    <div className="remote-source-banner">
                      <Cloud size={18} />
                      <span>
                        Instância remota: {selectedUnit?.instance_name}. Os
                        registros e as alterações ficam no servidor de origem.
                      </span>
                    </div>
                  )}
                  {settingsTab === "meta" && role === "admin" && (
                    <MetaConfiguration key={unit} unit={unit} />
                  )}
                  {settingsTab === "oracle" &&
                    role === "admin" &&
                    !isRemote && (
                      <OracleConfiguration key={`oracle-${unit}`} unit={unit} />
                    )}
                  {settingsTab === "rules" && (
                    <div className="rules-settings-layout">
                      <div className="settings-grid">
                        <Panel title="Controle de envios">
                          <div className="setting-row">
                            <span>Modo de operação</span>
                            <Badge
                              value={
                                data.control.mode === "simulated"
                                  ? "Simulado"
                                  : "Meta · teste"
                              }
                            />
                          </div>
                          <div className="setting-row">
                            <span>Envios</span>
                            <strong>
                              {data.control.unit.paused
                                ? "Pausados"
                                : "Habilitados para testes"}
                            </strong>
                          </div>
                          <div className="setting-row">
                            <span>Prazo de resposta</span>
                            <strong>
                              {data.control.unit.response_hours} horas após a
                              entrega
                            </strong>
                          </div>
                          <div className="setting-row">
                            <span>Destinatários autorizados</span>
                            <strong>
                              {data.control.test_recipients.length}
                            </strong>
                          </div>
                          <div className="test-recipients-list">
                            {data.control.test_recipients.length > 0 ? (
                              data.control.test_recipients.map((phone) => (
                                <span className="recipient-pill" key={phone}>
                                  <Phone size={12} />
                                  +{phone}
                                </span>
                              ))
                            ) : (
                              <p className="muted-note">
                                Nenhum número autorizado no ambiente.
                              </p>
                            )}
                          </div>
                          {role === "admin" && (
                            <div className="settings-buttons">
                              <button
                                className="button primary"
                                disabled={busy}
                                onClick={() =>
                                  void mutate(
                                    "control",
                                    { paused: !data.control.unit.paused },
                                    data.control.unit.paused
                                      ? "Testes habilitados."
                                      : "Envios pausados.",
                                  )
                                }
                              >
                                {data.control.unit.paused ? (
                                  <Play size={15} />
                                ) : (
                                  <Pause size={15} />
                                )}{" "}
                                {data.control.unit.paused
                                  ? "Habilitar testes"
                                  : "Pausar envios"}
                              </button>
                              <FormAction
                                title="Prazo de resposta"
                                label="Configurar prazo"
                                version={data.control.unit.response_hours}
                                busy={busy}
                                error={error}
                              >
                                <form
                                  className="op-form"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    const hours = Number(
                                      new FormData(event.currentTarget).get(
                                        "response_hours",
                                      ),
                                    );
                                    void mutate(
                                      "control",
                                      { response_hours: hours },
                                      "Prazo atualizado.",
                                    );
                                  }}
                                >
                                  <label className="op-field">
                                    Prazo em horas
                                    <input
                                      name="response_hours"
                                      type="number"
                                      min="1"
                                      max="168"
                                      required
                                      defaultValue={
                                        data.control.unit.response_hours
                                      }
                                    />
                                  </label>
                                  <button
                                    type="submit"
                                    className="button primary"
                                    disabled={busy}
                                  >
                                    Salvar prazo
                                  </button>
                                </form>
                              </FormAction>
                            </div>
                          )}
                        </Panel>
                        <Panel title="Integrações">
                          <div className="integration">
                            <span className="integration-icon">
                              <Activity size={20} />
                            </span>
                            <div>
                              <strong>
                                {data.control.appointment_source ===
                                "sqlite_simulated"
                                  ? "SQLite · Simulação"
                                  : "Oracle"}
                              </strong>
                              <small>Consultas, exames e laboratório</small>
                            </div>
                            <Badge
                              value={
                                data.control.oracle_configured ||
                                data.control.appointment_source ===
                                  "sqlite_simulated"
                                  ? "Configurado"
                                  : "Pendente"
                              }
                            />
                          </div>
                          <div className="integration">
                            <span className="integration-icon">
                              <MessageCircle size={20} />
                            </span>
                            <div>
                              <strong>WhatsApp oficial</strong>
                              <small>
                                Envio real desativado · validações por unidade
                              </small>
                            </div>
                            <Badge
                              value={
                                data.control.meta_configured
                                  ? "Configurado"
                                  : "Simulado"
                              }
                            />
                          </div>
                        </Panel>
                      </div>
                      <Panel title="Regras de lembretes">
                        <div className="table-scroll">
                          <table className="directory-table">
                            <thead>
                              <tr>
                                <th>Regra</th>
                                <th>Antecedência</th>
                                <th>Horário</th>
                                <th>Dias de envio</th>
                                <th>Situação</th>
                                <th style={{ textAlign: "right" }}>Ação</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.rules.results.map((rule) => (
                                <tr key={rule.id}>
                                  <td data-label="Regra">
                                    <strong>{rule.name}</strong>
                                    <small className="directory-detail">
                                      Versão {rule.version} · legado #
                                      {rule.legacy_scheduler_id}
                                    </small>
                                  </td>
                                  <td data-label="Antecedência">
                                    <span className="badge-days">
                                      {rule.days_before} dias
                                    </span>
                                  </td>
                                  <td data-label="Horário">
                                    <span className="badge-time">
                                      <Clock3 size={13} />{" "}
                                      {rule.send_time.slice(0, 5)}
                                    </span>
                                  </td>
                                  <td data-label="Dias">
                                    <div
                                      className="weekday-chips"
                                      aria-label="Dias de envio"
                                    >
                                      {[
                                        "Seg",
                                        "Ter",
                                        "Qua",
                                        "Qui",
                                        "Sex",
                                        "Sáb",
                                        "Dom",
                                      ].map((dayName, idx) => {
                                        const isSelected =
                                          rule.weekdays.includes(idx);
                                        return (
                                          <span
                                            key={dayName}
                                            className={`weekday-chip ${isSelected ? "active" : ""}`}
                                          >
                                            {dayName}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </td>
                                  <td data-label="Situação">
                                    <Badge
                                      value={rule.enabled ? "Ativa" : "Pausada"}
                                    />
                                  </td>
                                  <td
                                    className="row-action"
                                    style={{ textAlign: "right" }}
                                  >
                                    {role === "admin" && (
                                      <button
                                        className="icon-button"
                                        aria-label={`Editar ${rule.name}`}
                                        onClick={() =>
                                          setModal({
                                            type: "rule",
                                            value: rule,
                                          })
                                        }
                                      >
                                        <Settings2 size={16} />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Panel>
                      <Panel title="Templates de mensagens">
                        <div className="templates-grid">
                          {data.templates.results.map((template) => (
                            <article
                              key={template.id}
                              className="template-card"
                            >
                              <header className="template-card-header">
                                <div>
                                  <strong>{template.name}</strong>
                                  <div className="template-card-badges">
                                    <span className="template-badge-lang">
                                      {template.language}
                                    </span>
                                    <span className="template-badge-vars">
                                      {template.fields.length} variáveis
                                    </span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="button"
                                  onClick={() =>
                                    setModal({
                                      type: "template",
                                      value: template,
                                    })
                                  }
                                >
                                  {role === "admin" ? "Configurar" : "Ver mapa"}
                                </button>
                              </header>
                              <div className="template-body-preview">
                                <p>{template.body}</p>
                              </div>
                            </article>
                          ))}
                        </div>
                      </Panel>
                    </div>
                  )}
                  {settingsTab === "activity" && (
                    <div className="activity-settings-layout">
                      <Panel
                        title="Importações recentes"
                        action={
                          role === "admin" ? (
                            <FormAction
                              title="Importar agendamentos"
                              label="Nova importação"
                              busy={busy}
                              error={error}
                              version={data.audit.results[0]?.id || 0}
                            >
                              <form
                                className="op-form"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void mutate(
                                    data.control.appointment_source ===
                                      "sqlite_simulated"
                                      ? "imports/simulated"
                                      : "imports/run",
                                    {
                                      rule_id: Number(
                                        new FormData(event.currentTarget).get(
                                          "rule_id",
                                        ),
                                      ),
                                    },
                                    "Solicitação de importação concluída.",
                                  );
                                }}
                              >
                                {data.control.appointment_source !==
                                  "sqlite_simulated" && (
                                  <label className="op-field">
                                    Regra
                                    <select
                                      name="rule_id"
                                      required
                                      defaultValue={data.rules.results[0]?.id}
                                    >
                                      {data.rules.results.map((rule) => (
                                        <option key={rule.id} value={rule.id}>
                                          {rule.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )}
                                <button
                                  type="submit"
                                  className="button primary"
                                  disabled={
                                    busy ||
                                    (!data.control.oracle_configured &&
                                      data.control.appointment_source !==
                                        "sqlite_simulated")
                                  }
                                >
                                  {data.control.appointment_source ===
                                  "sqlite_simulated"
                                    ? "Importar SQLite simulado"
                                    : "Importar regra"}
                                </button>
                              </form>
                            </FormAction>
                          ) : null
                        }
                      >
                        {!data.imports.results.length ? (
                          <Empty text="Nenhuma importação executada." />
                        ) : (
                          <div className="table-scroll">
                            <table className="directory-table">
                              <thead>
                                <tr>
                                  <th>Regra</th>
                                  <th>Data</th>
                                  <th>Registros</th>
                                  <th>Situação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {data.imports.results.slice(0, 8).map((run) => (
                                  <tr key={run.id}>
                                    <td>
                                      <strong>{run.rule_name}</strong>
                                      {run.error && (
                                        <small className="directory-detail error-text">
                                          {run.error}
                                        </small>
                                      )}
                                    </td>
                                    <td>{run.run_date}</td>
                                    <td>
                                      <span className="directory-code">
                                        {run.imported} registros
                                      </span>
                                    </td>
                                    <td>
                                      <Badge value={run.status} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </Panel>

                      <Panel title="Registro de auditoria">
                        <div className="audit-timeline">
                          {data.audit.results.slice(0, 10).map((item) => (
                            <div key={item.id} className="audit-timeline-item">
                              <span className="audit-dot" />
                              <div className="audit-timeline-content">
                                <strong>{item.action}</strong>
                                <small>
                                  {item.actor_name} · {dateTime(item.created_at)}
                                </small>
                              </div>
                            </div>
                          ))}
                          {!data.audit.results.length && (
                            <Empty text="Nenhuma atividade registrada." />
                          )}
                        </div>
                      </Panel>
                    </div>
                  )}
                </div>
              )}
              {["messages", "responses"].includes(page) && !!activeList && (
                <div className="pagination">
                  <span>
                    {activeList.count} registros · página {listPage}
                  </span>
                  <div>
                    <button
                      className="button"
                      disabled={listPage === 1 || busy}
                      onClick={() => setListPage(listPage - 1)}
                    >
                      <ChevronLeft size={15} />
                      Anterior
                    </button>
                    <button
                      className="button"
                      disabled={!activeList.next || busy}
                      onClick={() => setListPage(listPage + 1)}
                    >
                      Próxima
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <span className="footer-orbit" />
              Órbita
            </span>
            <span>
              Horário de Brasília ·{" "}
              {new Intl.DateTimeFormat("pt-BR", {
                dateStyle: "medium",
                timeZone: "America/Sao_Paulo",
              }).format(new Date())}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button className="icon-button" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal && data && (
        <InlineDialog
          title={
            {
              test: "Novo teste",
              rule: "Regra de lembrete",
              template: "Template",
              message: "Mensagem",
              issue: "Correção",
            }[modal.type]
          }
          subtitle=""
          busy={busy}
          onClose={() => setModal(null)}
          footer={
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              Fechar
            </button>
          }
        >
          <div className="legacy-modal-content">
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <ModalContent
              modal={modal}
              control={data.control}
              messages={data.messages.results}
              role={role}
              busy={busy}
              mutate={mutate}
            />
          </div>
        </InlineDialog>
      )}
    </div>
  );
}
