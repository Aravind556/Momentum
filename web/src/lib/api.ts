export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      "x-requested-with": "cadence",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const notes = res.headers.get("x-cadence-notes");
  if (notes) {
    try {
      window.dispatchEvent(new CustomEvent("cadence:notes", { detail: JSON.parse(notes) }));
    } catch {
      /* malformed header: ignore */
    }
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.message ?? `Request failed (${res.status})`, e.code, e.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body: unknown = {}) => request<T>("POST", url, body),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  del: <T = void>(url: string, body?: unknown) => request<T>("DELETE", url, body),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
