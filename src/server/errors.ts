export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "insufficient_credits"
  | "content_blocked"
  | "account_restricted"
  | "ai_unavailable"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  insufficient_credits: 402,
  content_blocked: 422,
  account_restricted: 403,
  ai_unavailable: 503,
  internal: 500,
};

/** An error that is safe to show to the client. Never put secrets or internals in `message`. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = "Resource") => new AppError("not_found", `${what} not found`);
export const forbidden = (msg = "You do not have permission to do that") => new AppError("forbidden", msg);
