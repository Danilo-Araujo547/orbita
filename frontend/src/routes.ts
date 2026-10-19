import type { PageName } from "./types";

const pages: Record<string, PageName> = {
  "/": "overview",
  "/agendamentos": "appointments",
  "/grupos": "groups",
  "/responses": "groups",
  "/mensagens": "messages",
  "/pendencias": "issues",
  "/importa-cross": "campaigns",
  "/campanhas": "campaigns",
  "/relatorios": "reports",
  "/administracao": "operationsAdmin",
  "/configuracoes": "settings",
  "/usuarios": "users",
};

export function readRoute(path = window.location.pathname) {
  const normalized = path.replace(/\/$/, "") || "/";
  const match = normalized.match(/^\/grupos\/([0-9a-f-]{36})$/i);
  return {
    page: match ? ("groups" as PageName) : pages[normalized] || "overview",
    groupId: match?.[1] || null,
  };
}

export function routePath(page: PageName, groupId?: string | null) {
  if (page === "groups" && groupId) return `/grupos/${groupId}`;
  return (
    Object.entries(pages).find(
      ([path, value]) => value === page && path !== "/responses",
    )?.[0] || "/"
  );
}
