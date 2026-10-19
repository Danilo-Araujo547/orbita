import { describe, expect, it } from "vitest";
import { settingsEntries } from "./settingsDirectory";
import { canAccess } from "./permissions";
import { readRoute, routePath } from "./routes";
import type { Session } from "./types";
const ids = (policy: Parameters<typeof settingsEntries>[0], role = "admin", remote = false) => settingsEntries(policy, role, remote).map(item => item.id);
describe("Configurações unificadas", () => {
  it("preserva acesso exclusivo a usuários sem liberar integrações ou cadastros", () => {
    expect(ids({users: "read"})).toEqual(["units", "users"]);
    const session = {units:[{slug:"ame"}],permissions:{ame:{users:"read"}},roles:{ame:"admin"}} as unknown as Session;
    expect(canAccess(session,"ame","settings")).toBe(true);
    expect(canAccess(session,"ame","settings",true)).toBe(false);
  });
  it("mostra cadastros apenas com a permissão administrativa", () => {
    const found = ids({operationsAdmin:"read"});
    expect(found).toContain("sources"); expect(found).toContain("layouts");
    expect(found).not.toContain("users"); expect(found).not.toContain("meta");
  });
  it("não oferece cadastros administrativos a quem acessa somente configurações", () => {
    const found = ids({settings:"write"});
    expect(found).toContain("meta"); expect(found).toContain("rules");
    expect(found).not.toContain("users"); expect(found).not.toContain("sources");
  });
  it("respeita papéis de consulta e unidades remotas", () => {
    expect(ids({settings:"read"},"viewer")).toEqual(["rules","activity","logs"]);
    expect(ids({settings:"write",users:"write",operationsAdmin:"write"},"admin",true)).toEqual(["meta","rules","activity","logs"]);
    expect(ids({settings:"none",users:"none",operationsAdmin:"none"})).toEqual([]);
  });
  it("mantém leitura em unidades sem ampliar concessões", () => {
    expect(settingsEntries({settings:"read",users:"read"},"admin",false).find(item=>item.id==="units")?.section).toBe("settings");
    expect(settingsEntries({settings:"read",users:"write"},"admin",false).find(item=>item.id==="units")?.section).toBe("users");
  });
  it("preserva URLs antigas e usa uma rota canônica", () => {
    expect(readRoute("/usuarios").page).toBe("settings");
    expect(readRoute("/administracao").page).toBe("settings");
    expect(routePath("settings")).toBe("/configuracoes");
    expect(routePath("users")).toBe("/configuracoes");
  });
});
