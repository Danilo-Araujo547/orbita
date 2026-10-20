import { useMemo } from "react";
import FilterSelect from "./FilterSelect";
import { Panel } from "./ui";
import { dateOnly, percentage } from "../format";
import type { Indicators, PageName } from "../types";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  RotateCcw,
  Send,
  TriangleAlert,
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

interface OverviewWorkspaceProps {
  data: Indicators;
  unit: string;
  start: string;
  end: string;
  kind: string;
  kinds: Record<string, string>;
  isDark?: boolean;
  onFilterChange: (newKind: string, newStart: string, newEnd: string) => void;
  onNavigate: (page: PageName, filter?: string, isResponse?: boolean) => void;
}

function getPresetRange(type: "today" | "7d" | "30d" | "month"): [string, string] {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const endStr = fmt(today);
  if (type === "today") return [endStr, endStr];
  if (type === "7d") {
    const past = new Date(today);
    past.setDate(past.getDate() - 6);
    return [fmt(past), endStr];
  }
  if (type === "30d") {
    const past = new Date(today);
    past.setDate(past.getDate() - 29);
    return [fmt(past), endStr];
  }
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return [fmt(first), endStr];
}

export default function OverviewWorkspace({
  data,
  start,
  end,
  kind,
  kinds,
  isDark = false,
  onFilterChange,
  onNavigate,
}: OverviewWorkspaceProps) {
  // 1. Indicadores sobre as Mensagens
  const messagesTotal = data.messages_total ?? data.messages ?? 0;
  const messagesToSend =
    data.messages_to_send ??
    (data.states?.queued ?? 0) +
      (data.states?.preview ?? 0) +
      (data.states?.sending ?? 0);
  const messagesSent =
    data.messages_sent ??
    (data.states?.accepted ?? 0) +
      (data.states?.sent ?? 0) +
      (data.states?.delivered ?? 0) +
      (data.states?.read ?? 0);
  const messagesAnswered =
    data.messages_answered ?? (data.confirmed ?? 0) + (data.declined ?? 0);
  const messagesUnanswered =
    data.messages_unanswered ?? Math.max(0, messagesTotal - messagesAnswered);
  const messagesInvalid =
    data.messages_invalid ??
    (data.states?.failed ?? 0) +
      (data.states?.blocked ?? 0) +
      (data.states?.uncertain ?? 0);

  const messagesSentPct = percentage(messagesSent, messagesTotal);
  const messagesAnsweredPct = percentage(messagesAnswered, messagesTotal);
  const messagesUnansweredPct = percentage(messagesUnanswered, messagesTotal);
  const messagesInvalidPct = percentage(messagesInvalid, messagesTotal);

  // 2. Indicadores sobre os Agendamentos / Pacientes
  const appointmentsTotal = data.appointments_total ?? data.appointments ?? 0;
  const appointmentsDeclined =
    data.appointments_declined ?? data.declined ?? 0;
  const appointmentsAnswered =
    data.appointments_answered ??
    (data.confirmed ?? 0) + (data.declined ?? 0);
  const appointmentsUnanswered =
    data.appointments_unanswered ??
    Math.max(0, appointmentsTotal - appointmentsAnswered);
  const appointmentsSent =
    data.appointments_sent ?? Math.min(appointmentsTotal, messagesSent);
  const appointmentsInvalid =
    data.appointments_invalid ?? Math.min(appointmentsTotal, messagesInvalid);

  const appSentPct = percentage(appointmentsSent, appointmentsTotal);
  const appAnsweredPct = percentage(appointmentsAnswered, appointmentsTotal);
  const appUnansweredPct = percentage(
    appointmentsUnanswered,
    appointmentsTotal,
  );
  const appInvalidPct = percentage(appointmentsInvalid, appointmentsTotal);

  // Detect active preset
  const activePreset = useMemo(() => {
    if (!start || !end) return "";
    const presets: ("today" | "7d" | "30d" | "month")[] = [
      "today",
      "7d",
      "30d",
      "month",
    ];
    for (const p of presets) {
      const [s, e] = getPresetRange(p);
      if (start === s && end === e) return p;
    }
    return "";
  }, [start, end]);

  const handlePreset = (type: "today" | "7d" | "30d" | "month") => {
    if (activePreset === type) {
      onFilterChange(kind, "", "");
      return;
    }
    const [s, e] = getPresetRange(type);
    onFilterChange(kind, s, e);
  };

  const hasFilter = Boolean(kind || start || end);

  const periodLabel = useMemo(() => {
    if (activePreset === "today") return "Hoje";
    if (activePreset === "7d") return "Últimos 7 dias";
    if (activePreset === "30d") return "Últimos 30 dias";
    if (activePreset === "month") return "Mês atual";
    if (start && end) {
      return `${dateOnly(`${start}T12:00:00-03:00`)} — ${dateOnly(`${end}T12:00:00-03:00`)}`;
    }
    return "Últimos 7 dias";
  }, [activePreset, start, end]);

  const confirmedPct = percentage(data.confirmed, messagesTotal);
  const declinedAndConfirmedPct = percentage(
    data.confirmed + data.declined,
    messagesTotal,
  );
  const allResponsesPct = percentage(
    data.confirmed + data.declined + data.no_response,
    messagesTotal,
  );

  return (
    <div className="overview-shell">
      {/* Barra de filtros nativa */}
      <div className="filters overview-filters">
        <div className="filter-left">
          <div className="overview-type-select">
            <FilterSelect
              label="Tipo de envio"
              value={kind}
              onChange={(e) => onFilterChange(e.target.value, start, end)}
            >
              <option value="">Todos os tipos de envio</option>
              {Object.entries(kinds).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </FilterSelect>
          </div>

          <div
            className="overview-period-tabs"
            role="group"
            aria-label="Atalhos de período"
          >
            {(
              [
                ["today", "Hoje"],
                ["7d", "7 dias"],
                ["30d", "30 dias"],
                ["month", "Mês atual"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={activePreset === key ? "is-active" : ""}
                onClick={() => handlePreset(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {hasFilter && (
            <button
              type="button"
              className="clear-filters-btn"
              onClick={() => onFilterChange("", "", "")}
              title="Limpar todos os filtros ativos"
            >
              <RotateCcw size={12} />
              <span>Limpar filtros</span>
            </button>
          )}
        </div>

        <div className="date-range">
          <CalendarDays size={15} />
          <input
            type="date"
            aria-label="Data inicial do agendamento"
            value={start}
            onChange={(e) => onFilterChange(kind, e.target.value, end)}
          />
          <span>até</span>
          <input
            type="date"
            aria-label="Data final do agendamento"
            value={end}
            onChange={(e) => onFilterChange(kind, start, e.target.value)}
          />
        </div>
      </div>

      {/* Destaques Operacionais no padrão nativo .metrics-grid */}
      <div className="metrics-grid">
        <button
          type="button"
          className="metric metric-neutral"
          onClick={() => onNavigate("messages", "queued")}
        >
          <div className="metric-top">
            <span>Mensagens à Enviar</span>
            <span className="metric-icon">
              <Clock3 size={18} />
            </span>
          </div>
          <strong className="metric-value">
            {messagesToSend.toLocaleString("pt-BR")}
          </strong>
          <div className="metric-note">
            <span>
              {messagesToSend === 0
                ? "Nenhuma mensagem aguardando fila"
                : "Lembretes aguardando janela de disparo"}
            </span>
            <span className="overview-detail-inline">
              Detalhes <ArrowRight size={13} />
            </span>
          </div>
        </button>

        <button
          type="button"
          className="metric metric-amber"
          onClick={() => onNavigate("appointments", "declined")}
        >
          <div className="metric-top">
            <span>Agendamentos Recusados</span>
            <span className="metric-icon">
              <TriangleAlert size={18} />
            </span>
          </div>
          <strong className="metric-value">
            {appointmentsDeclined.toLocaleString("pt-BR")}
          </strong>
          <div className="metric-note">
            <span>Pacientes que informaram não comparecer</span>
            <span className="overview-detail-inline">
              Detalhes <ArrowRight size={13} />
            </span>
          </div>
        </button>

        <button
          type="button"
          className="metric metric-green"
          onClick={() => onNavigate("messages")}
        >
          <div className="metric-top">
            <span>Total de Mensagens</span>
            <span className="metric-icon">
              <Send size={18} />
            </span>
          </div>
          <strong className="metric-value">
            {messagesTotal.toLocaleString("pt-BR")}
          </strong>
          <div className="metric-note">
            <span>
              {messagesSent.toLocaleString("pt-BR")} enviadas ({messagesSentPct}
              %)
            </span>
            <span className="overview-detail-inline">
              Detalhes <ArrowRight size={13} />
            </span>
          </div>
        </button>

        <button
          type="button"
          className="metric metric-lime"
          onClick={() => onNavigate("appointments")}
        >
          <div className="metric-top">
            <span>Total Agendamentos</span>
            <span className="metric-icon">
              <CalendarDays size={18} />
            </span>
          </div>
          <strong className="metric-value">
            {appointmentsTotal.toLocaleString("pt-BR")}
          </strong>
          <div className="metric-note">
            <span>
              {appointmentsAnswered.toLocaleString("pt-BR")} respondidos (
              {appAnsweredPct}%)
            </span>
            <span className="overview-detail-inline">
              Detalhes <ArrowRight size={13} />
            </span>
          </div>
        </button>
      </div>

      {/* Painéis Comparativos Lado a Lado: Mensagens vs Agendamentos/Pacientes */}
      <div className="overview-indicators-grid">
        {/* Painel 1: Indicadores sobre as Mensagens */}
        <Panel
          title="Indicadores sobre as Mensagens"
          subtitle={`${messagesTotal.toLocaleString("pt-BR")} Total de Mensagens`}
          action={
            <button
              type="button"
              className="overview-panel-link"
              onClick={() => onNavigate("messages")}
            >
              <span>Detalhes</span>
              <ArrowRight size={13} />
            </button>
          }
          className="overview-indicator-panel"
        >
          <div className="overview-meter-wrap">
            <div className="overview-meter-bar">
              <span
                className="meter-segment seg-answered"
                style={{ width: `${messagesAnsweredPct}%` }}
                title={`Respondidas: ${messagesAnsweredPct}%`}
              />
              <span
                className="meter-segment seg-unanswered"
                style={{ width: `${messagesUnansweredPct}%` }}
                title={`Não Respondidas: ${messagesUnansweredPct}%`}
              />
            </div>
            <div className="overview-meter-captions">
              <span>
                <i className="seg-dot seg-answered" /> Respondidas (
                {messagesAnsweredPct}%)
              </span>
              <span>
                <i className="seg-dot seg-unanswered" /> Não Respondidas (
                {messagesUnansweredPct}%)
              </span>
              <span>
                <i className="seg-dot seg-sent" /> Enviadas ({messagesSentPct}%)
              </span>
            </div>
          </div>

          <div className="overview-stat-matrix">
            <button
              type="button"
              className="overview-stat-cell"
              onClick={() => onNavigate("messages", "confirmed", true)}
            >
              <div className="stat-cell-head">
                <span>
                  <i className="seg-dot seg-answered" />
                  Respondidas
                </span>
              </div>
              <strong className="stat-cell-val">
                {messagesAnswered.toLocaleString("pt-BR")}
                <small>/{messagesAnsweredPct}%</small>
              </strong>
            </button>

            <button
              type="button"
              className="overview-stat-cell"
              onClick={() => onNavigate("messages", "no_response", true)}
            >
              <div className="stat-cell-head">
                <span>
                  <i className="seg-dot seg-unanswered" />
                  Não Respondidas
                </span>
              </div>
              <strong className="stat-cell-val">
                {messagesUnanswered.toLocaleString("pt-BR")}
                <small>/{messagesUnansweredPct}%</small>
              </strong>
            </button>

            <button
              type="button"
              className="overview-stat-cell"
              onClick={() => onNavigate("messages", "delivered_or_read")}
            >
              <div className="stat-cell-head">
                <span>
                  <i className="seg-dot seg-sent" />
                  Enviadas
                </span>
                <em className="stat-cell-cta">
                  Detalhes <ArrowRight size={11} />
                </em>
              </div>
              <strong className="stat-cell-val">
                {messagesSent.toLocaleString("pt-BR")}
                <small>/{messagesSentPct}%</small>
              </strong>
            </button>

            <button
              type="button"
              className="overview-stat-cell"
              onClick={() => onNavigate("messages", "failed")}
            >
              <div className="stat-cell-head">
                <span>
                  <i className="seg-dot seg-invalid" />
                  Números Inválidos
                </span>
              </div>
              <strong className="stat-cell-val">
                {messagesInvalid.toLocaleString("pt-BR")}
                {messagesInvalidPct > 0 && <small>/{messagesInvalidPct}%</small>}
              </strong>
            </button>
          </div>
        </Panel>

        {/* Painel 2: Indicadores sobre os Agendamentos/Pacientes */}
        <Panel
          title="Indicadores sobre os Agendamentos/Pacientes"
          subtitle={`${appointmentsTotal.toLocaleString("pt-BR")} Total Agendamentos`}
          action={
            <button
              type="button"
              className="overview-panel-link"
              onClick={() => onNavigate("appointments")}
            >
              <span>Detalhes</span>
              <ArrowRight size={13} />
            </button>
          }
          className="overview-indicator-panel"
        >
          <div className="overview-meter-wrap">
            <div className="overview-meter-bar">
              <span
                className="meter-segment seg-answered"
                style={{ width: `${appAnsweredPct}%` }}
                title={`Respondidas: ${appAnsweredPct}%`}
              />
              <span
                className="meter-segment seg-unanswered"
                style={{ width: `${appUnansweredPct}%` }}
                title={`Não Respondidas: ${appUnansweredPct}%`}
              />
            </div>
            <div className="overview-meter-captions">
              <span>
                <i className="seg-dot seg-answered" /> Respondidas (
                {appAnsweredPct}%)
              </span>
              <span>
                <i className="seg-dot seg-unanswered" /> Não Respondidas (
                {appUnansweredPct}%)
              </span>
              <span>
                <i className="seg-dot seg-sent" /> Enviadas ({appSentPct}%)
              </span>
            </div>
          </div>

          <div className="overview-stat-matrix">
            <button
              type="button"
              className="overview-stat-cell"
              onClick={() => onNavigate("appointments")}
            >
              <div className="stat-cell-head">
                <span>
                  <i className="seg-dot seg-answered" />
                  Respondidas
                </span>
              </div>
              <strong className="stat-cell-val">
                {appointmentsAnswered.toLocaleString("pt-BR")}
                <small>/{appAnsweredPct}%</small>
              </strong>
            </button>

            <button
              type="button"
              className="overview-stat-cell"
              onClick={() => onNavigate("appointments")}
            >
              <div className="stat-cell-head">
                <span>
                  <i className="seg-dot seg-unanswered" />
                  Não Respondidas
                </span>
              </div>
              <strong className="stat-cell-val">
                {appointmentsUnanswered.toLocaleString("pt-BR")}
                <small>/{appUnansweredPct}%</small>
              </strong>
            </button>

            <button
              type="button"
              className="overview-stat-cell"
              onClick={() => onNavigate("appointments")}
            >
              <div className="stat-cell-head">
                <span>
                  <i className="seg-dot seg-sent" />
                  Enviadas
                </span>
              </div>
              <strong className="stat-cell-val">
                {appointmentsSent.toLocaleString("pt-BR")}
                <small>/{appSentPct}%</small>
              </strong>
            </button>

            <button
              type="button"
              className="overview-stat-cell"
              onClick={() => onNavigate("issues")}
            >
              <div className="stat-cell-head">
                <span>
                  <i className="seg-dot seg-invalid" />
                  Números Inválidos
                </span>
              </div>
              <strong className="stat-cell-val">
                {appointmentsInvalid.toLocaleString("pt-BR")}
                {appInvalidPct > 0 && <small>/{appInvalidPct}%</small>}
              </strong>
            </button>
          </div>
        </Panel>
      </div>

      {/* Gráficos nativos no padrão .charts-grid */}
      <div className="charts-grid">
        <Panel
          title="Mensagens por dia"
          action={
            <span className="chart-period">
              <CalendarDays size={14} />
              {periodLabel}
            </span>
          }
        >
          <div className="chart-legend">
            <span>
              <i style={{ background: isDark ? "#ffffff" : "#075B94" }} />
              Mensagens
            </span>
            <span>
              <i style={{ background: isDark ? "#a1a1aa" : "#14B4CB" }} />
              Entregues
            </span>
            <span>
              <i style={{ background: isDark ? "#34d399" : "#10b981" }} />
              Respondidas
            </span>
          </div>
          <div className="area-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.trend}
                margin={{
                  left: -20,
                  right: 16,
                  top: 10,
                  bottom: 0,
                }}
              >
                <defs>
                  <linearGradient id="greenFade" x1="0" y1="0" x2="0" y2="1">
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
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="answered"
                  name="Respondidas"
                  stroke={isDark ? "#34d399" : "#10b981"}
                  strokeWidth={2}
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
            <strong>
              {messagesTotal.toLocaleString("pt-BR")} mensagens ·{" "}
              {appointmentsTotal.toLocaleString("pt-BR")} agendamentos
            </strong>
          </div>
        </Panel>

        <Panel title="Situação das respostas" className="response-panel">
          <div className="response-hero">
            <div
              className="response-ring"
              style={{
                background: `conic-gradient(${isDark ? "#34d399" : "#10b981"} 0 ${confirmedPct}%,#f87171 ${confirmedPct}% ${declinedAndConfirmedPct}%,${isDark ? "#fbbf24" : "#f59e0b"} ${declinedAndConfirmedPct}% ${allResponsesPct}%,${isDark ? "#262626" : "#e2e8f0"} 0)`,
              }}
            >
              <div>
                <strong>
                  {confirmedPct}
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
                data.responses?.confirmed ?? data.confirmed ?? 0,
              ],
              [
                "declined",
                "Não comparecerão",
                "#f87171",
                data.responses?.declined ?? data.declined ?? 0,
              ],
              [
                "no_response",
                "Sem resposta no prazo",
                isDark ? "#fbbf24" : "#f59e0b",
                data.responses?.no_response ?? data.no_response ?? 0,
              ],
              [
                "pending",
                "Aguardando resposta",
                isDark ? "#71717a" : "#94a3b8",
                data.responses?.pending ?? 0,
              ],
              [
                "not_requested",
                "Sem envio confirmado",
                isDark ? "#27272a" : "#cbd5e1",
                data.responses?.not_requested ?? 0,
              ],
            ].map(([key, label, color, val]) => (
              <button
                key={String(key)}
                type="button"
                onClick={() => onNavigate("messages", String(key), true)}
              >
                <span>
                  <i style={{ background: String(color) }} />
                  {label}
                </span>
                <strong>{Number(val).toLocaleString("pt-BR")}</strong>
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
