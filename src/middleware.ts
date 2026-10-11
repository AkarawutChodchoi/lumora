import { NextResponse, type NextRequest } from "next/server";
import { localizeMessage } from "@/i18n/errors";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "@/i18n/config";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
// Pages that always need an account. The page itself still verifies the session;
// this only gives guests an immediate server-side redirect.
const PROTECTED = /^\/(chats|library|coins|profile|safety|memories|admin|characters\/new|characters\/[^/]+\/edit)(\/|$)/;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/api/")) {
    if (PROTECTED.test(pathname) && !req.cookies.get("lumora_session")) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url, 307);
    }
    return NextResponse.next();
  }

  // CSRF defence in depth (session cookies are also SameSite=Lax): state-changing
  // API requests must come from this site. Webhook and cron are authenticated by
  // signature / bearer token instead.
  if (SAFE.has(req.method) || pathname === "/api/billing/webhook" || pathname === "/api/cron/maintenance") return NextResponse.next();
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return forbidden(req);
    }
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (originHost !== host) return forbidden(req);
  } else if (req.headers.get("sec-fetch-site") === "cross-site") {
    return forbidden(req);
  }
  return NextResponse.next();
}

function forbidden(req: NextRequest) {
  const v = req.cookies.get(LOCALE_COOKIE)?.value;
  const message = localizeMessage("Cross-site request blocked", isLocale(v) ? v : DEFAULT_LOCALE);
  return NextResponse.json({ error: { code: "forbidden", message } }, { status: 403 });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
