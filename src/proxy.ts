import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { localizeMessage } from "@/i18n/errors";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "@/i18n/config";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
// Pages that always need an account. The page itself still verifies the session;
// this only gives guests an immediate server-side redirect.
const PROTECTED = /^\/(chats|library|coins|profile|safety|memories|notifications|admin|characters\/new|characters\/[^/]+\/edit)(\/|$)/;
// Server-to-server callers, authenticated by signature / bearer token instead of cookies.
// better-auth (/api/auth) runs its own origin check.
const NO_ORIGIN_CHECK = /^\/api\/(webhooks\/|cron\/|auth\/)/;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/api/")) {
    if (PROTECTED.test(pathname) && !getSessionCookie(req, { cookiePrefix: "lumora" })) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url, 307);
    }
    return NextResponse.next();
  }

  // CSRF defence in depth (session cookies are also SameSite=Lax): state-changing
  // API requests must come from this site.
  if (SAFE.has(req.method) || NO_ORIGIN_CHECK.test(pathname)) return NextResponse.next();
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
