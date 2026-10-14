import type { PageName, SectionPermissions, Session } from "./types";

export const sectionLabels: Record<string, string> = {
  overview: "Visão geral", appointments: "Agendamentos", groups: "Grupos", messages: "Mensagens",
  issues: "Pendências", campaigns: "Campanhas", reports: "Relatórios",
  operationsAdmin: "Administração", settings: "Configurações", users: "Usuários",
};
export function defaultPermissions(role: string): SectionPermissions {
  return Object.fromEntries(Object.keys(sectionLabels).map(section => [section,
    role === "admin" || (role === "operator" && !["settings", "operationsAdmin", "users"].includes(section)) ? "write" : section === "users" ? "none" : "read"]));
}
export function permissionsFor(session: Session, unit: string): SectionPermissions {
  return session.permissions?.[unit] || defaultPermissions(session.roles[unit] || "viewer");
}
export function pageSection(page: PageName): string {
  return page === "care" ? "appointments" : page === "responses" ? "groups" : page;
}
