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
function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return ("" + 1e7 + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c: any) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
    );
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
      ...(method === "POST" ? { "Idempotency-Key": generateUUID() } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return undefined as T;
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `O servidor retornou uma resposta inválida (HTTP ${response.status}). Tente novamente.`,
    );
  }
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
