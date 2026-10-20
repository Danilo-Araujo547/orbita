import { useMemo } from "react";
import type { Indicators, PageName } from "../types";
import {
  CalendarDays,
  ChevronRight,
  Clock,
  MessageSquare,
  RotateCcw,
  Users,
  XCircle,
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

function formatDate(iso: string) {
  if (!iso) return "";
  const parts = iso.slice(0, 10).split("-");
  if (parts.length < 3) return iso;
  return `${parts[2]}/${parts[1]}`;
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
  // 1. Mensagens Metrics
  const messagesTotal = data.messages_total ?? data.messages ?? 0;
  const messagesToSend =
    data.messages_to_send ??
    (data.states?.queued ?? 0) + (data.states?.preview ?? 0);
  const messagesSent =
    data.messages_sent ??
    (data.states?.sent ?? 0) +
      (data.states?.delivered ?? 0) +
      (data.states?.read ?? 0);
  const messagesAnswered =
    data.messages_answered ??
    (data.confirmed ?? 0) + (data.declined ?? 0);
  const messagesUnanswered =
    data.messages_unanswered ?? Math.max(0, messagesTotal - messagesAnswered);
  const messagesInvalid =
    data.messages_invalid ??
    (data.states?.failed ?? 0) + (data.states?.blocked ?? 0);

  const messagesSentPct =
    messagesTotal > 0 ? Math.round((messagesSent / messagesTotal) * 100) : 0;
  const messagesAnsweredPct =
    messagesTotal > 0
      ? Math.round((messagesAnswered / messagesTotal) * 100)
      : 0;
  const messagesUnansweredPct =
    messagesTotal > 0
      ? Math.round((messagesUnanswered / messagesTotal) * 100)
      : 0;
  const messagesInvalidPct =
    messagesTotal > 0
      ? Math.round((messagesInvalid / messagesTotal) * 100)
      : 0;

  // 2. Agendamentos / Pacientes Metrics
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

  const appSentPct =
    appointmentsTotal > 0
      ? Math.round((appointmentsSent / appointmentsTotal) * 100)
      : 0;
  const appAnsweredPct =
    appointmentsTotal > 0
      ? Math.round((appointmentsAnswered / appointmentsTotal) * 100)
      : 0;
  const appUnansweredPct =
    appointmentsTotal > 0
      ? Math.round((appointmentsUnanswered / appointmentsTotal) * 100)
      : 0;
  const appInvalidPct =
    appointmentsTotal > 0
      ? Math.round((appointmentsInvalid / appointmentsTotal) * 100)
      : 0;

  // Preset Handlers
  const handlePreset = (type: "today" | "7d" | "30d" | "month") => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const endStr = fmt(today);
    let startStr = endStr;

    if (type === "7d") {
      const past = new Date();
      past.setDate(past.getDate() - 6);
      startStr = fmt(past);
    } else if (type === "30d") {
      const past = new Date();
      past.setDate(past.getDate() - 29);
      startStr = fmt(past);
    } else if (type === "month") {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      startStr = fmt(first);
    }

    onFilterChange(kind, startStr, endStr);
  };

  const hasFilter = Boolean(kind || start || end);

  const handleClear = () => {
    onFilterChange("", "", "");
  };

  // Trend data mapping
  const chartData = useMemo(() => {
    return (data.trend || []).map((t) => ({
      ...t,
      label: formatDate(t.day),
    }));
  }, [data.trend]);

  // Response breakdown percentages for Donut Ring
  const confirmedPct =
    messagesTotal > 0
      ? Math.round(((data.confirmed ?? 0) / messagesTotal) * 100)
      : 0;
  const declinedPct =
    messagesTotal > 0
      ? Math.round(((data.declined ?? 0) / messagesTotal) * 100)
      : 0;
  const noResponsePct =
    messagesTotal > 0
      ? Math.round(((data.no_response ?? 0) / messagesTotal) * 100)
      : 0;

  return (
    <div className="overview-workspace-container">
      {/* BARRA DE FILTROS ELEGANTE (TIPO DE ENVIO E PERÍODO) */}
      <div className="overview-control-bar">
        <div className="overview-control-left">
          <div className="overview-filter-group">
            <span className="overview-filter-label">Tipo de envio:</span>
            <select
              className="overview-kind-select"
              aria-label="Tipo de envio"
              value={kind}
              onChange={(e) => onFilterChange(e.target.value, start, end)}
            >
              <option value="">Todos os tipos de envio</option>
              {Object.entries(kinds).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overview-control-right">
          <div className="overview-preset-buttons">
            <button
              type="button"
              className="overview-preset-btn"
              onClick={() => handlePreset("today")}
            >
              Hoje
            </button>
            <button
              type="button"
              className="overview-preset-btn"
              onClick={() => handlePreset("7d")}
            >
              7 dias
            </button>
            <button
              type="button"
              className="overview-preset-btn"
              onClick={() => handlePreset("30d")}
            >
              30 dias
            </button>
            <button
              type="button"
              className="overview-preset-btn"
              onClick={() => handlePreset("month")}
            >
              Mês atual
            </button>
          </div>

          <div className="overview-date-range">
            <CalendarDays size={14} className="overview-cal-icon" />
            <input
              type="date"
              aria-label="Data inicial"
              value={start}
              onChange={(e) => onFilterChange(kind, e.target.value, end)}
            />
            <span className="overview-range-sep">até</span>
            <input
              type="date"
              aria-label="Data final"
              value={end}
              onChange={(e) => onFilterChange(kind, start, e.target.value)}
            />
          </div>

          {hasFilter && (
            <button
              type="button"
              className="overview-clear-filters-btn"
              onClick={handleClear}
              title="Limpar todos os filtros aplicados"
            >
              <RotateCcw size={12} />
              <span>Limpar filtros</span>
            </button>
          )}
        </div>
      </div>

      {/* TOP DESTAQUES: MENSAGENS À ENVIAR & AGENDAMENTOS RECUSADOS */}
      <div className="overview-top-highlights">
        {/* Card: Mensagens à Enviar */}
        <div className="overview-highlight-card highlight-queued">
          <div className="highlight-content">
            <div className="highlight-header">
              <span className="highlight-badge">
                <Clock size={15} />
              </span>
              <span className="highlight-title">Mensagens à Enviar</span>
            </div>
            <div className="highlight-number">
              {messagesToSend.toLocaleString("pt-BR")}
            </div>
            <div className="highlight-hint">
              {messagesToSend === 0
                ? "Fila limpa — nenhum lembrete aguardando disparo"
                : "Lembretes na fila aguardando janela de envio"}
            </div>
          </div>
          <button
            type="button"
            className="highlight-details-btn"
            onClick={() => onNavigate("messages", "queued")}
            title="Ver detalhes das mensagens à enviar"
          >
            <span>Detalhes</span>
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Card: Agendamentos Recusados */}
        <div className="overview-highlight-card highlight-declined">
          <div className="highlight-content">
            <div className="highlight-header">
              <span className="highlight-badge declined-badge">
                <XCircle size={15} />
              </span>
              <span className="highlight-title">Agendamentos Recusados</span>
            </div>
            <div className="highlight-number declined-number">
              {appointmentsDeclined.toLocaleString("pt-BR")}
            </div>
            <div className="highlight-hint">
              {appointmentsDeclined === 0
                ? "Nenhum paciente informou que não comparecerá"
                : "Pacientes que responderam informando que não poderão comparecer"}
            </div>
          </div>
          <button
            type="button"
            className="highlight-details-btn"
            onClick={() => onNavigate("appointments", "declined")}
            title="Ver agendamentos com recusa registrada"
          >
            <span>Detalhes</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* SEÇÃO 1: INDICADORES SOBRE AS MENSAGENS */}
      <section className="overview-section">
        <div className="overview-section-header">
          <div className="section-title-wrap">
            <MessageSquare size={18} className="section-icon" />
            <h3 className="section-title">Indicadores sobre as Mensagens</h3>
          </div>
          <span className="section-subtitle">
            Acompanhe o volume geral, taxas de entrega e respostas de cada mensagem disparada
          </span>
        </div>

        <div className="overview-metrics-row">
          {/* Card: Total de Mensagens */}
          <div className="overview-metric-box metric-hero">
            <div className="metric-box-top">
              <span className="metric-box-label">Total de Mensagens</span>
              <button
                type="button"
                className="metric-box-detail-link"
                onClick={() => onNavigate("messages")}
              >
                Detalhes
                <ChevronRight size={12} />
              </button>
            </div>
            <div className="metric-box-number">
              {messagesTotal.toLocaleString("pt-BR")}
            </div>
            <div className="metric-box-sub">
              Disparos programados para o período
            </div>
          </div>

          {/* Card: Respondidas */}
          <div
            className="overview-metric-box clickable"
            onClick={() => onNavigate("messages", "confirmed", true)}
            title="Filtrar mensagens que obtiveram resposta"
          >
            <div className="metric-box-top">
              <span className="metric-box-label">Respondidas</span>
              <span className="metric-badge green-badge">
                {messagesAnsweredPct}%
              </span>
            </div>
            <div className="metric-box-number">
              {messagesAnswered.toLocaleString("pt-BR")}/
              <small className="metric-ratio">{messagesAnsweredPct}%</small>
            </div>
            <div className="metric-progress-track">
              <div
                className="metric-progress-fill green-fill"
                style={{ width: `${Math.min(100, messagesAnsweredPct)}%` }}
              />
            </div>
            <div className="metric-box-sub">
              Respostas de pacientes recebidas
            </div>
          </div>

          {/* Card: Não Respondidas */}
          <div
            className="overview-metric-box clickable"
            onClick={() => onNavigate("messages", "no_response", true)}
            title="Filtrar mensagens sem resposta"
          >
            <div className="metric-box-top">
              <span className="metric-box-label">Não Respondidas</span>
              <span className="metric-badge amber-badge">
                {messagesUnansweredPct}%
              </span>
            </div>
            <div className="metric-box-number">
              {messagesUnanswered.toLocaleString("pt-BR")}/
              <small className="metric-ratio">{messagesUnansweredPct}%</small>
            </div>
            <div className="metric-progress-track">
              <div
                className="metric-progress-fill amber-fill"
                style={{ width: `${Math.min(100, messagesUnansweredPct)}%` }}
              />
            </div>
            <div className="metric-box-sub">
              Sem retorno do paciente no prazo
            </div>
          </div>

          {/* Card: Enviadas */}
          <div className="overview-metric-box">
            <div className="metric-box-top">
              <span className="metric-box-label">Enviadas</span>
              <button
                type="button"
                className="metric-box-detail-link"
                onClick={() => onNavigate("messages", "delivered_or_read")}
              >
                Detalhes
                <ChevronRight size={12} />
              </button>
            </div>
            <div className="metric-box-number">
              {messagesSent.toLocaleString("pt-BR")}/
              <small className="metric-ratio">{messagesSentPct}%</small>
            </div>
            <div className="metric-progress-track">
              <div
                className="metric-progress-fill blue-fill"
                style={{ width: `${Math.min(100, messagesSentPct)}%` }}
              />
            </div>
            <div className="metric-box-sub">
              Mensagens entregues ou lidas
            </div>
          </div>

          {/* Card: Números Inválidos */}
          <div
            className="overview-metric-box clickable"
            onClick={() => onNavigate("messages", "failed")}
            title="Filtrar falhas e números com erro"
          >
            <div className="metric-box-top">
              <span className="metric-box-label">Números Inválidos</span>
              <span className="metric-badge red-badge">
                {messagesInvalidPct}%
              </span>
            </div>
            <div className="metric-box-number red-number">
              {messagesInvalid.toLocaleString("pt-BR")}
            </div>
            <div className="metric-progress-track">
              <div
                className="metric-progress-fill red-fill"
                style={{ width: `${Math.min(100, messagesInvalidPct)}%` }}
              />
            </div>
            <div className="metric-box-sub">
              Falhas de envio ou contato incorreto
            </div>
          </div>
        </div>
      </section>

      {/* SEÇÃO 2: INDICADORES SOBRE OS AGENDAMENTOS / PACIENTES */}
      <section className="overview-section">
        <div className="overview-section-header">
          <div className="section-title-wrap">
            <Users size={18} className="section-icon" />
            <h3 className="section-title">
              Indicadores sobre os Agendamentos/Pacientes
            </h3>
          </div>
          <span className="section-subtitle">
            Estatísticas calculadas a nível de paciente atendido na unidade
          </span>
        </div>

        <div className="overview-metrics-row">
          {/* Card: Total Agendamentos */}
          <div className="overview-metric-box metric-hero">
            <div className="metric-box-top">
              <span className="metric-box-label">Total Agendamentos</span>
              <button
                type="button"
                className="metric-box-detail-link"
                onClick={() => onNavigate("appointments")}
              >
                Detalhes
                <ChevronRight size={12} />
              </button>
            </div>
            <div className="metric-box-number">
              {appointmentsTotal.toLocaleString("pt-BR")}
            </div>
            <div className="metric-box-sub">
              Pacientes com horário marcado
            </div>
          </div>

          {/* Card: Respondidas */}
          <div
            className="overview-metric-box clickable"
            onClick={() => onNavigate("appointments")}
            title="Pacientes com confirmação ou recusa"
          >
            <div className="metric-box-top">
              <span className="metric-box-label">Respondidas</span>
              <span className="metric-badge green-badge">{appAnsweredPct}%</span>
            </div>
            <div className="metric-box-number">
              {appointmentsAnswered.toLocaleString("pt-BR")}/
              <small className="metric-ratio">{appAnsweredPct}%</small>
            </div>
            <div className="metric-progress-track">
              <div
                className="metric-progress-fill green-fill"
                style={{ width: `${Math.min(100, appAnsweredPct)}%` }}
              />
            </div>
            <div className="metric-box-sub">
              Pacientes que responderam ao lembrete
            </div>
          </div>

          {/* Card: Não Respondidas */}
          <div
            className="overview-metric-box clickable"
            onClick={() => onNavigate("appointments")}
            title="Pacientes que não responderam"
          >
            <div className="metric-box-top">
              <span className="metric-box-label">Não Respondidas</span>
              <span className="metric-badge amber-badge">
                {appUnansweredPct}%
              </span>
            </div>
            <div className="metric-box-number">
              {appointmentsUnanswered.toLocaleString("pt-BR")}/
              <small className="metric-ratio">{appUnansweredPct}%</small>
            </div>
            <div className="metric-progress-track">
              <div
                className="metric-progress-fill amber-fill"
                style={{ width: `${Math.min(100, appUnansweredPct)}%` }}
              />
            </div>
            <div className="metric-box-sub">
              Pacientes ainda sem retorno registrado
            </div>
          </div>

          {/* Card: Enviadas */}
          <div className="overview-metric-box">
            <div className="metric-box-top">
              <span className="metric-box-label">Enviadas</span>
              <span className="metric-badge blue-badge">{appSentPct}%</span>
            </div>
            <div className="metric-box-number">
              {appointmentsSent.toLocaleString("pt-BR")}/
              <small className="metric-ratio">{appSentPct}%</small>
            </div>
            <div className="metric-progress-track">
              <div
                className="metric-progress-fill blue-fill"
                style={{ width: `${Math.min(100, appSentPct)}%` }}
              />
            </div>
            <div className="metric-box-sub">
              Pacientes notificados com sucesso
            </div>
          </div>

          {/* Card: Números Inválidos */}
          <div
            className="overview-metric-box clickable"
            onClick={() => onNavigate("issues")}
            title="Ver pendências de pacientes com erro de contato"
          >
            <div className="metric-box-top">
              <span className="metric-box-label">Números Inválidos</span>
              <span className="metric-badge red-badge">{appInvalidPct}%</span>
            </div>
            <div className="metric-box-number red-number">
              {appointmentsInvalid.toLocaleString("pt-BR")}
            </div>
            <div className="metric-progress-track">
              <div
                className="metric-progress-fill red-fill"
                style={{ width: `${Math.min(100, appInvalidPct)}%` }}
              />
            </div>
            <div className="metric-box-sub">
              Cadastros com telefone inconsistente
            </div>
          </div>
        </div>
      </section>

      {/* SEÇÃO 3: GRÁFICOS VISUAIS E PAINÉIS DE RESPOSTA */}
      <div className="overview-charts-grid">
        {/* Painel 1: Gráfico Temporal */}
        <div className="overview-chart-panel">
          <div className="chart-panel-header">
            <div>
              <h4 className="chart-panel-title">Evolução dos Disparos</h4>
              <span className="chart-panel-sub">
                Volume de mensagens geradas e entregues ao longo do período
              </span>
            </div>
            <div className="chart-legend-row">
              <span className="legend-item">
                <i
                  className="legend-dot"
                  style={{ background: isDark ? "#ffffff" : "#0284c7" }}
                />
                Mensagens
              </span>
              <span className="legend-item">
                <i
                  className="legend-dot"
                  style={{ background: isDark ? "#38bdf8" : "#06b6d4" }}
                />
                Entregues
              </span>
              <span className="legend-item">
                <i
                  className="legend-dot"
                  style={{ background: isDark ? "#34d399" : "#10b981" }}
                />
                Respondidas
              </span>
            </div>
          </div>

          <div className="overview-chart-canvas">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart
                data={chartData}
                margin={{ left: -20, right: 16, top: 10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="chartBlueFade" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={isDark ? "#38bdf8" : "#0284c7"}
                      stopOpacity={isDark ? 0.3 : 0.22}
                    />
                    <stop
                      offset="100%"
                      stopColor={isDark ? "#38bdf8" : "#0284c7"}
                      stopOpacity={0}
                    />
                  </linearGradient>
                  <linearGradient id="chartGreenFade" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={isDark ? "#34d399" : "#10b981"}
                      stopOpacity={isDark ? 0.25 : 0.18}
                    />
                    <stop
                      offset="100%"
                      stopColor={isDark ? "#34d399" : "#10b981"}
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 5"
                  vertical={false}
                  stroke={isDark ? "#334155" : "#e2e8f0"}
                />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fontSize: 11,
                    fill: isDark ? "#94a3b8" : "#64748b",
                  }}
                  dy={10}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fontSize: 11,
                    fill: isDark ? "#94a3b8" : "#64748b",
                  }}
                />
                <Tooltip
                  formatter={(val: any) => [
                    Number(val || 0).toLocaleString("pt-BR"),
                    "",
                  ]}
                  labelFormatter={(lbl) => `Data: ${lbl}`}
                  contentStyle={{
                    borderRadius: 10,
                    border: isDark ? "1px solid #334155" : "1px solid #e2e8f0",
                    background: isDark ? "#0f172a" : "#ffffff",
                    color: isDark ? "#f8fafc" : "#0f172a",
                    boxShadow: isDark
                      ? "0 8px 24px rgba(0, 0, 0, 0.6)"
                      : "0 4px 14px rgba(0, 0, 0, 0.08)",
                    fontSize: 12,
                  }}
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="messages"
                  name="Mensagens"
                  stroke={isDark ? "#ffffff" : "#0284c7"}
                  strokeWidth={2.5}
                  fill="url(#chartBlueFade)"
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="delivered"
                  name="Entregues"
                  stroke={isDark ? "#38bdf8" : "#06b6d4"}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  fill="transparent"
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="answered"
                  name="Respondidas"
                  stroke={isDark ? "#34d399" : "#10b981"}
                  strokeWidth={2}
                  fill="url(#chartGreenFade)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Painel 2: Donut Ring & Detalhamento das Respostas */}
        <div className="overview-chart-panel response-panel">
          <div className="chart-panel-header">
            <div>
              <h4 className="chart-panel-title">Situação das Respostas</h4>
              <span className="chart-panel-sub">
                Distribuição percentual das confirmações e recusas
              </span>
            </div>
          </div>

          <div className="response-ring-hero">
            <div
              className="overview-response-ring"
              style={{
                background: `conic-gradient(
                  ${isDark ? "#34d399" : "#10b981"} 0 ${confirmedPct}%,
                  #f87171 ${confirmedPct}% ${confirmedPct + declinedPct}%,
                  ${isDark ? "#fbbf24" : "#f59e0b"} ${confirmedPct + declinedPct}% ${
                  confirmedPct + declinedPct + noResponsePct
                }%,
                  ${isDark ? "#334155" : "#e2e8f0"} 0
                )`,
              }}
            >
              <div className="response-ring-inner">
                <strong>
                  {confirmedPct}
                  <small>%</small>
                </strong>
                <span>confirmados</span>
              </div>
            </div>
          </div>

          <div className="overview-response-breakdown">
            {[
              {
                key: "confirmed",
                label: "Confirmados",
                color: isDark ? "#34d399" : "#10b981",
                count: data.responses?.confirmed ?? data.confirmed ?? 0,
              },
              {
                key: "declined",
                label: "Não comparecerão",
                color: "#f87171",
                count: data.responses?.declined ?? data.declined ?? 0,
              },
              {
                key: "no_response",
                label: "Sem resposta no prazo",
                color: isDark ? "#fbbf24" : "#f59e0b",
                count: data.responses?.no_response ?? data.no_response ?? 0,
              },
              {
                key: "pending",
                label: "Aguardando resposta",
                color: isDark ? "#94a3b8" : "#64748b",
                count: data.responses?.pending ?? 0,
              },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className="overview-breakdown-row"
                onClick={() => onNavigate("messages", item.key, true)}
                title={`Ver mensagens com status ${item.label}`}
              >
                <span className="breakdown-label">
                  <i
                    className="breakdown-bullet"
                    style={{ background: item.color }}
                  />
                  {item.label}
                </span>
                <strong className="breakdown-value">
                  {item.count.toLocaleString("pt-BR")}
                </strong>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
