export type PageName =
  | "groups"
  | "care"
  | "campaigns"
  | "reports"
  | "operationsAdmin"
  | "costs"
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
  trend: {
    day: string;
    messages: number;
    delivered: number;
    answered?: number;
  }[];
  paused: boolean;
  messages_to_send?: number;
  messages_total?: number;
  messages_answered?: number;
  messages_unanswered?: number;
  messages_sent?: number;
  messages_invalid?: number;
  appointments_total?: number;
  appointments_declined?: number;
  appointments_answered?: number;
  appointments_unanswered?: number;
  appointments_sent?: number;
  appointments_invalid?: number;
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

export interface ReportConnection {
  id: number;
  unit: number;
  name: string;
  engine: "oracle" | "sqlite" | "firebird" | "mysql" | "postgres";
  host: string;
  port: number;
  database: string;
  username: string;
  options: { identifier_type?: "service" | "sid"; charset?: string };
  enabled: boolean;
  validated: boolean;
  has_password: boolean;
  checked_at: string | null;
  validation_error: string;
  timeout_seconds: number;
  max_rows: number;
  version: number;
}
export interface ReportParameter {
  type: "date" | "integer" | "number" | "string";
  required?: boolean;
  default?: string | number | null;
}
export interface ReportParameterEvidence {
  name: string;
  type: string;
  mask: string;
  order: string | null;
  value: unknown;
  required: boolean | null;
  origin: string;
  usage: string;
  status: "confirmed" | "legacy" | "pending";
  configured: boolean;
  report_code: string;
  report_name: string;
}
export interface CatalogReport {
  id: number;
  unit: number;
  code: string;
  name: string;
  source:
    | "local"
    | "sql"
    | "composite"
    | "legacy_pending"
    | "external_file"
    | "application_pending";
  connection: number | null;
  connection_name: string;
  review_queue?: boolean;
  parameter_audit?: { items: ReportParameterEvidence[]; component_issues: string[] } | null;
  query_sql?: string;
  parameter_schema: Record<string, ReportParameter>;
  components?: { code: string; parameters?: Record<string, unknown> }[];
  keywords: string[];
  output_format: "pdf" | "csv" | "text";
  enabled: boolean;
  reviewed: boolean;
  manual_enabled: boolean;
  pending_items: string[];
  dependencies?: string[];
  version: number;
}
export interface ReportRecipient {
  id: number;
  name: string;
  unit: number;
  address: string;
  kind: "phone" | "group";
  user: number | null;
  active: boolean;
  manual_enabled: boolean;
  verified_at: string | null;
  version: number;
  pending_items: string[];
}
export interface ReportGrant {
  id: number;
  unit: number;
  report: number;
  recipient: number;
  report_name: string;
  recipient_name: string;
  active: boolean;
  manual: boolean;
  automatic: boolean;
  parameters: Record<string, unknown>;
  version: number;
}
export interface ReportAutomation {
  id: number;
  unit: number;
  report: number;
  recipient: number;
  report_name: string;
  recipient_name: string;
  enabled: boolean;
  send_time: string;
  weekdays: number[];
  parameters: Record<string, unknown>;
  pending_items: string[];
  version: number;
}
export interface ReportExecution {
  id: string;
  report: number;
  recipient: number | null;
  report_name: string;
  recipient_name: string;
  origin: "panel" | "automatic" | "whatsapp";
  state: "pending" | "running" | "ready" | "failed" | "blocked";
  format: "pdf" | "csv" | "text";
  row_count: number;
  delivery_state: string;
  error_code: string;
  created_at: string;
  completed_at: string | null;
}

export interface ReportTechnicalDescription {
  summary: string;
  origin: string;
  assembly: string;
  components: {code: string; name: string}[];
  components_note?: string;
  routines: string[];
  snapshots: string;
  pending: string[];
}

export interface ReportDescriptionInput { description?: string; }

export interface ReportApplicationConnection {
 id:number;name:string;mode:"local"|"remote";local_unit:number|null;remote_instance:string|null;
 source_name:string;enabled:boolean;version:number;state:string;
}
