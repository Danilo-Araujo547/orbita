import type { SectionPermissions } from "./types";

export type SettingsEntry = { id: string; label: string; group: string; section: string };
export function settingsEntries(policy: SectionPermissions, role: string, remote: boolean): SettingsEntry[] {
  const can = (key: string) => !!policy[key] && policy[key] !== "none";
  const entries: SettingsEntry[] = [];
  const add = (id: string, label: string, group: string, section: string) => entries.push({id, label, group, section});
  if (!remote && role === "admin" && ["settings", "operationsAdmin", "users"].some(can)) {
    const section = ["settings", "operationsAdmin", "users"].find(key => policy[key] === "write") || ["settings", "operationsAdmin", "users"].find(can)!;
    add("units", "Unidades", "Instância", section);
  }
  if (!remote && can("users")) add("users", "Usuários e acessos", "Instância", "users");
  if (can("settings")) {
    if (role === "admin" && policy.settings === "write") {
      if (!remote) { add("instances", "Instâncias remotas", "Integrações", "settings"); add("oracle", "Oracle", "Integrações", "settings"); }
      add("meta", "WhatsApp / Meta", "Integrações", "settings");
    }
    add("rules", "Lembretes e envios", "Operação", "settings");
    add("activity", "Importações e auditoria", "Monitoramento", "settings");
    add("logs", "Logs de execução", "Monitoramento", "settings");
  }
  if (!remote && can("operationsAdmin")) {
    for (const [id,label] of [["sources","Origens e regras"],["preparations","Preparos"],["layouts","Layouts Importa CROSS"],["policies","Prazos de resposta"],["reportDefinitions","Catálogo de relatórios"],["access","Acesso a relatórios"],["schedules","Relatórios agendados"]]) add(id,label,"Cadastros", "operationsAdmin");
  }
  return entries;
}
