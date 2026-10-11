import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError } from "./errors";
import { logger } from "./logger";
import { getLocale } from "@/i18n/server";
import { localizeMessage } from "@/i18n/errors";
import type { Locale } from "@/i18n/config";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/** Convert any thrown error into a safe JSON response, localized to the visitor's language. */
export function errorResponse(err: unknown, locale: Locale = "en") {
  const t = (m: string, validation = false) => localizeMessage(m, locale, { validation });
  if (err instanceof AppError) {
    return NextResponse.json({ error: { code: err.code, message: t(err.message), details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_failed",
          message: t("Some fields are invalid"),
          details: err.issues.map((i) => ({ path: i.path.join("."), message: t(i.message, true) })),
        },
      },
      { status: 422 },
    );
  }
  logger.error("unhandled_error", { error: err instanceof Error ? err.message : String(err) });
  return NextResponse.json({ error: { code: "internal", message: t("Something went wrong. Please try again.") } }, { status: 500 });
}

/** Wrap a route handler so thrown errors become consistent JSON responses. */
export function route<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err, await getLocale().catch(() => "en" as const));
    }
  };
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError("bad_request", "Request body must be valid JSON");
  }
  return schema.parse(body);
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
