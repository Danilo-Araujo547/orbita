export type PageName =
  | "groups"
  | "care"
  | "campaigns"
  | "reports"
  | "operationsAdmin"
  | "overview"
  | "appointments"
  | "messages"
  | "responses"
  | "issues"
  | "settings"
  | "users";
export type SectionLevel = "none" | "read" | "write";
export type SectionPermissions = Record<string, SectionLevel>;
export interface Unit {
  version?: number;
  authorized_recipients?: string[] | null;
  effective_recipients?: string[];
  id: number | string;
  slug: string;
  name: string;
  paused: boolean;
  response_hours: number;
  remote?: boolean;
  instance_id?: string;
  instance_name?: string;
  origin_unit?: string;
  connection_state?: string;
  logo?: string;
}
export interface Session {
  username: string;
  units: Unit[];
  roles: Record<string, "admin" | "operator" | "viewer">;
  mode: string;
  permissions?: Record<string, SectionPermissions>;
}
export interface Appointment {
  record_type?: "appointment" | "cross";
  purpose?: string;
  kind_label?: string;
  patient_external_id?: string;
  professional?: string;
  city?: string;
  tracking?: {
    id: string | null;
    version: number;
    outcome: string;
    response: string;
    awaiting_since?: string | null;
    corrections: number;
    observations: number;
    messages: number;
    contacts: {
      phone: string;
      delivery: string;
      response: string;
      status?: string;
      opted_out?: boolean;
      channel?: string;
    }[];
  };
  id: number | string;
  external_id: string;
  kind: string;
  patient: string;
  phone: string;
  procedure: string;
  scheduled_at: string;
  arrival_time: string;
  synthetic: boolean;
  source: string;
  revision: number;
}
export interface Attempt {
  id: number;
  number: number;
  outcome: string;
  error_code: string;
  started_at: string;
  completed_at: string | null;
}
export interface Message {
  sender_phone?: string;
  sent_at?: string | null;
  responses?: {
    id: number;
    text: string;
    classification: string;
    occurred_at: string;
    sender: string;
    responded_by: string;
    channel: string;
  }[];
  id: string;
  appointment: number;
  patient: string;
  kind: string;
  procedure: string;
  appointment_at: string;
  synthetic: boolean;
  rule_name: string;
  recipient: string;
  template_name: string;
  parameters: string[];
  body: string;
  state: string;
  response_state: string;
  scheduled_for: string;
  expires_at: string;
  delivered_at: string | null;
  attempt_count: number;
  error_code: string;
  provider_id: string | null;
  channel_id: string;
  created_at: string;
  attempts: Attempt[];
}
export interface Reply {
  id: number;
  message: string | null;
  sender: string;
  text: string;
  classification: string;
  patient: string;
  occurred_at: string;
}
export interface Issue {
  appointment?: number | null;
  case?: string | null;
  contact_phone?: string;
  sender: string;
  id: string;
  message: string | null;
  reply: number | null;
  patient: string;
  reply_text: string;
  category: string;
  description: string;
  resolution: string;
  resolved_at: string | null;
  created_at: string;
}
export interface Rule {
  id: number;
  code: string;
  name: string;
  kind: string;
  days_before: number;
  refresh_interval_minutes: number;
  evidence?: string;
  send_time: string;
  weekdays: number[];
  enabled: boolean;
  version: number;
  template: number;
  template_name: string;
  legacy_report_id: number;
  legacy_scheduler_id: number;
}
export interface Template {
  id: number;
  name: string;
  language: string;
  body: string;
  fields: string[];
  approved_for_test: boolean;
  version: number;
  purpose: string;
}
export interface ImportRun {
  id: number;
  rule_name: string;
  run_date: string;
  status: string;
  imported: number;
  error: string;
  legacy_exclusion: boolean;
  started_at: string;
}
export interface Audit {
  id: number;
  actor_name: string;
  action: string;
  object_id: string;
  created_at: string;
}
export interface Control {
  unit: Unit;
  mode: string;
  test_recipients: string[];
  oracle_configured: boolean;
  appointment_source?: string;
  meta_configured: boolean;
  production_enabled: boolean;
  legacy_exclusion: boolean;
}
export interface Indicators {
  appointments: number;
  messages: number;
  accepted: number;
  delivered: number;
  confirmed: number;
  declined: number;
  no_response: number;
  issues: number;
  synthetic_appointments: number;
  states: Record<string, number>;
  responses: Record<string, number>;
  by_kind: { kind: string; total: number }[];
  trend: { day: string; messages: number; delivered: number }[];
  paused: boolean;
}
export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type Modal =
  | { type: "message"; value: Message }
  | { type: "issue"; value: Issue }
  | { type: "rule"; value: Rule }
  | { type: "template"; value: Template }
  | { type: "test" }
  | null;
