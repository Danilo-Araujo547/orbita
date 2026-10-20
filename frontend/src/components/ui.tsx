import LegacyLabel from "./LegacyLabel";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  FlaskConical,
  MoreHorizontal,
  Search,
  Stethoscope,
  User,
} from "lucide-react";
import { dateTime, kinds, labels } from "../format";
import type { Appointment } from "../types";
import { whatsappStatus } from "../whatsappStatus";

export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge badge-${value}`}>
      <i />
      {labels[value] || value}
    </span>
  );
}
export function Empty({
  text = "Nenhum registro para os filtros selecionados.",
}: {
  text?: string;
}) {
  return (
    <div className="empty">
      <Search size={26} />
      <strong>{text}</strong>
    </div>
  );
}
export function Panel({
  title,
  legacy = false,
  subtitle,
  children,
  action: extra,
  className = "",
}: {
  title: string;
  legacy?: boolean;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2><LegacyLabel legacy={legacy}>{title}</LegacyLabel></h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function Metric({
  title,
  value,
  icon: Icon,
  tone,
  note,
  onClick,
}: {
  title: string;
  value: number;
  icon: typeof Activity;
  tone: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button className={`metric metric-${tone}`} onClick={onClick}>
      <div className="metric-top">
        <span>{title}</span>
        <span className="metric-icon">
          <Icon size={19} />
        </span>
      </div>
      <strong className="metric-value">{value.toLocaleString("pt-BR")}</strong>
      <div className="metric-note">
        <span>{note}</span>
        <ArrowRight size={14} />
      </div>
    </button>
  );
}
export function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="search-field">
      <Search size={16} />
      <input
        aria-label="Buscar paciente ou número"
        placeholder="Buscar paciente ou número"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
export function AppointmentTable({
  appointments,
  onSelect,
}: {
  appointments: Appointment[];
  onSelect: (appointment: Appointment) => void;
}) {
  if (!appointments.length) return <Empty />;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Paciente</th>
            <th>Agendamento</th>
            <th>Data / hora</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {appointments.map((appointment) => {
            const ws = whatsappStatus(appointment);
            return (
            <tr
              key={appointment.id}
              className="clickable"
              onClick={() => onSelect(appointment)}
            >
              <td data-label="Paciente">
                <div className="patient-cell">
                  <span
                    className={`patient-icon patient-icon-status-${ws.state}`}
                    title={`${appointment.patient} · ${ws.label}`}
                    aria-hidden="true"
                  >
                    <User size={15} />
                  </span>
                  <div>
                    <strong>{appointment.patient}</strong>
                    <small>{appointment.external_id}</small>
                  </div>
                </div>
              </td>
              <td data-label="Agendamento">
                <span className={`kind-label kind-${appointment.kind}`}>
                  {appointment.kind === "consultation" ? (
                    <Stethoscope size={12} />
                  ) : appointment.kind === "lab" ? (
                    <FlaskConical size={12} />
                  ) : (
                    <Activity size={12} />
                  )}{" "}
                  {kinds[appointment.kind]}
                </span>
                <small>{appointment.procedure}</small>
                {appointment.professional && (
                  <small className="appointment-professional">
                    <User
                      size={11}
                      style={{
                        display: "inline-block",
                        verticalAlign: "text-bottom",
                        marginRight: "4px",
                      }}
                      aria-hidden="true"
                    />
                    {appointment.professional}
                  </small>
                )}
              </td>
              <td className="nowrap" data-label="Data / hora">
                {dateTime(appointment.scheduled_at)}
                <small>Chegada: {appointment.arrival_time}</small>
              </td>
              <td className="row-action">
                <button
                  className="icon-button"
                  aria-label={`Ver agendamento de ${appointment.patient}`}
                >
                  <MoreHorizontal size={17} />
                </button>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
