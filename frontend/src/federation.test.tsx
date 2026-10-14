import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { apiUrl, query } from "./api";
import UnitSelector from "./components/UnitSelector";

describe("remote routing", () => {
  const id = "7d5298e2-9e35-4dfd-96bc-0be07d0d8f10";
  it("keeps local API calls unchanged", () => {
    expect(apiUrl("/api/v1/appointments/?unit=ame&page=2")).toBe(
      "/api/v1/appointments/?unit=ame&page=2",
    );
    expect(apiUrl("/api/v1/auth/session/")).toBe("/api/v1/auth/session/");
  });
  it("routes remote API calls and downloads through the local backend", () => {
    expect(
      query("appointments/export", { unit: `remote:${id}`, page: "2" }),
    ).toBe(`/api/v1/remote/${id}/appointments/export/?page=2`);
    expect(apiUrl(`/api/v1/messages/123/retry/?unit=remote:${id}`)).toBe(
      `/api/v1/remote/${id}/messages/123/retry/`,
    );
    expect(
      query("report-requests/456/download", { unit: `remote:${id}` }),
    ).toBe(`/api/v1/remote/${id}/report-requests/456/download/`);
  });
  it("does not route a proxy URL again or expose keys", () => {
    const path = `/api/v1/remote/${id}/appointments/?search=Ana`;
    expect(apiUrl(path)).toBe(path);
    expect(
      query("appointments", { unit: `remote:${id}`, search: "A & B" }),
    ).toContain("search=A+%26+B");
  });
  it("shows a cloud for the selected remote unit", () => {
    const html = renderToStaticMarkup(
      <UnitSelector
        label="Unidade"
        value={`remote:${id}`}
        units={[
          {
            id,
            slug: `remote:${id}`,
            name: "Unidade remota",
            paused: true,
            response_hours: 24,
            remote: true,
            instance_name: "Servidor remoto",
          },
        ]}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Instância remota"');
    expect(html).toContain("Unidade remota");
    expect(html).not.toContain("orbita_");
  });
});
