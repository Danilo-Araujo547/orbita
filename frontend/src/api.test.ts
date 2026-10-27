import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./api";

afterEach(() => vi.unstubAllGlobals());
describe("API response handling", () => {
  it("reports an HTML server error without exposing its body or JSON parser error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><html>Internal error</html>", {status:500, headers:{"Content-Type":"text/html"}})));
    await expect(request("/api/v1/reports/17/")).rejects.toThrow("resposta inválida (HTTP 500)");
  });
  it("preserves API validation errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:"Código já cadastrado."}), {status:400})));
    await expect(request("/api/v1/reports/", "POST", {})).rejects.toThrow("Código já cadastrado.");
  });
  it("accepts an empty successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {status:204})));
    await expect(request("/api/v1/reports/")).resolves.toBeUndefined();
  });
});
