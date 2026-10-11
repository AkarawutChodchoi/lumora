// Browser-side API helper. Every response is JSON; errors carry a safe message.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
  /** Field errors from server-side validation, keyed by field path. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details ?? []) if (d.path && !out[d.path]) out[d.path] = d.message;
    return out;
  }
}

export async function api<T = unknown>(path: string, init: Omit<RequestInit, "body"> & { body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    const thai = typeof document !== "undefined" && document.documentElement.lang === "th";
    throw new ApiError(0, "network", thai ? "ดูเหมือนคุณออฟไลน์อยู่ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง" : "You appear to be offline. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? "unknown", e?.message ?? "Something went wrong", Array.isArray(e?.details) ? e.details : undefined);
  }
  return data as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
