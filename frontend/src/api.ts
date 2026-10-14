let csrfToken = "";
export function apiUrl(url: string): string {
  const [path, search = ""] = url.split("?");
  if (!path.startsWith("/api/v1/") || path.startsWith("/api/v1/remote/"))
    return url;
  const params = new URLSearchParams(search);
  const unit = params.get("unit") || "";
  const match = unit.match(/^remote:([a-f0-9-]{36})$/i);
  if (!match) return url;
  params.delete("unit");
  const query = params.toString();
  return `/api/v1/remote/${match[1]}/${path.slice(8)}${query ? `?${query}` : ""}`;
}
export async function request<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(apiUrl(url), {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" ? { "X-CSRFToken": csrfToken } : {}),
      ...(method === "POST" ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : Object.values(data).flat().join(" ") ||
            "Não foi possível concluir a operação.",
    );
  return data as T;
}
export async function initCsrf() {
  csrfToken = (await request<{ csrfToken: string }>("/api/v1/auth/csrf/"))
    .csrfToken;
}
export async function signIn(username: string, password: string) {
  await initCsrf();
  const result = await request<{ csrfToken: string }>(
    "/api/v1/auth/login/",
    "POST",
    { username, password },
  );
  csrfToken = result.csrfToken;
}
export function query(path: string, filters: Record<string, string>) {
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  );
  return apiUrl(`/api/v1/${path}/?${params}`);
}
