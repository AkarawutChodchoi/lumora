// End-to-end smoke test against a running server (real HTTP, real cookies, real SSE).
// Usage: node scripts/smoke.mjs [baseUrl]   (default http://localhost:3000)
// Creates throwaway accounts; safe for development databases only.
const BASE = process.argv[2] ?? "http://localhost:3000";
let failures = 0;

function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

class Client {
  cookie = "";
  async req(path, { method = "GET", body, headers = {} } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", origin: BASE, cookie: this.cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const m = set.match(/lumora_session=([^;]*)/);
      if (m) this.cookie = m[1] ? `lumora_session=${m[1]}` : "";
    }
    return res;
  }
  async json(path, opts) {
    const res = await this.req(path, opts);
    return { status: res.status, data: await res.json().catch(() => null) };
  }
}

async function register(c) {
  const email = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.dev`;
  const r = await c.json("/api/auth/register", { method: "POST", body: { email, password: "smokepass1", displayName: "Smoke", ageConfirmed: true } });
  return { ...r, email };
}

async function streamChat(c, convId, body) {
  const res = await c.req(`/api/conversations/${convId}/messages`, { method: "POST", body });
  if (!res.ok) return { status: res.status, error: await res.json().catch(() => null), events: [] };
  const text = await res.text();
  const events = text.split("\n\n").filter(Boolean).map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));
  return { status: res.status, events };
}

const alice = new Client();
const bob = new Client();
const guest = new Client();

// Health + auth
check("health endpoint", (await guest.json("/api/health")).data?.status === "ok");
const reg = await register(alice);
check("register returns 201 and sets a session", reg.status === 201 && alice.cookie.length > 20);
check("password hash never returned", !JSON.stringify(reg.data).includes("passwordHash"));
const dup = await alice.json("/api/auth/register", { method: "POST", body: { email: reg.email, password: "smokepass1", displayName: "Again", ageConfirmed: true } });
check("duplicate email rejected", dup.status === 409);
const weak = await guest.json("/api/auth/register", { method: "POST", body: { email: "bad", password: "short", displayName: "x", ageConfirmed: true } });
check("invalid registration rejected with field errors", weak.status === 422 && Array.isArray(weak.data?.error?.details));
check("wrong password rejected", (await guest.json("/api/auth/login", { method: "POST", body: { email: reg.email, password: "nope12345" } })).status === 401);
check("guest cannot read /users/me", (await guest.json("/api/users/me")).status === 401);
check("signed-in user can read /users/me", (await alice.json("/api/users/me")).data?.user?.email === reg.email);
const csrf = await alice.json("/api/users/me", { method: "PATCH", body: { bio: "x" }, headers: { origin: "https://evil.example" } });
check("cross-site write blocked", csrf.status === 403);
await register(bob);

// Discovery
const disc = await guest.json("/api/discover");
check("discover lists seeded public characters", disc.data?.trending?.length > 0, `${disc.data?.trending?.length ?? 0} trending`);
const publicChar = disc.data.trending[0];

// Character creation and privacy
const created = await alice.json("/api/characters", {
  method: "POST",
  body: { name: "Smoke Knight", greeting: "Halt! Who goes there?", personality: "Stern but fair", tags: ["test"], category: "fantasy" },
});
check("create character", created.status === 201);
const charId = created.data.id;
check("private character hidden from other users", (await bob.json(`/api/characters/${charId}`)).status === 404);
check("other users cannot edit it", (await bob.json(`/api/characters/${charId}`, { method: "PUT", body: { name: "Hacked", greeting: "hi" } })).status === 403);
const pub = await alice.json(`/api/characters/${charId}/publish`, { method: "POST", body: { visibility: "public" } });
check("publish character", pub.data?.publicationStatus === "published");
const detailForBob = await bob.json(`/api/characters/${charId}`);
check("published character visible, prompt internals hidden from non-owner", detailForBob.status === 200 && detailForBob.data.character.personality === undefined);
check("owner sees prompt internals", (await alice.json(`/api/characters/${charId}`)).data?.character?.personality === "Stern but fair");
const search = await guest.json(`/api/characters?q=Smoke%20Knight&sort=newest`);
check("search finds published character", search.data?.items?.some((c) => c.id === charId));
check("favorite", (await bob.json(`/api/characters/${charId}/favorite`, { method: "PUT" })).status === 200);

// Chat with streaming
const conv = await alice.json("/api/conversations", { method: "POST", body: { characterId: publicChar.id } });
check("start conversation", conv.status === 201);
const convId = conv.data.id;
const before = (await alice.json("/api/credits")).data.balance;
const chat = await streamChat(alice, convId, { mode: "send", content: "Hello! My name is Somchai and I love astronomy.", clientRequestId: crypto.randomUUID() });
const types = chat.events.map((e) => e.type);
check("message streams start → delta → done", types[0] === "start" && types.includes("delta") && types.at(-1) === "done", types.join(","));
check("dev mode is labelled, not passed off as AI", chat.events[0]?.devMode === true && chat.events.at(-1)?.message?.content?.startsWith("[Dev mode"));
const after = (await alice.json("/api/credits")).data.balance;
check("one coin charged per reply", before - after === 1, `${before} → ${after}`);
const msgs = await alice.json(`/api/conversations/${convId}/messages`);
check("history persisted in order", msgs.data?.items?.map((m) => m.role).join(",") === "assistant,user,assistant");
check("other user cannot read the conversation", (await bob.json(`/api/conversations/${convId}/messages`)).status === 404);
check("other user cannot post to the conversation", (await streamChat(bob, convId, { mode: "send", content: "hi", clientRequestId: crypto.randomUUID() })).status === 404);
const reqId = crypto.randomUUID();
await streamChat(alice, convId, { mode: "send", content: "second", clientRequestId: reqId });
check("duplicate request id rejected", (await streamChat(alice, convId, { mode: "send", content: "second", clientRequestId: reqId })).status === 409);
const regen = await streamChat(alice, convId, { mode: "regenerate", clientRequestId: crypto.randomUUID() });
check("regenerate works", regen.events.at(-1)?.type === "done");
const failing = await streamChat(alice, convId, { mode: "send", content: "trigger __dev_fail__", clientRequestId: crypto.randomUUID() });
check("provider failure surfaces an error event and refunds", failing.events.at(-1)?.type === "error" && failing.events.at(-1)?.balance === (await alice.json("/api/credits")).data.balance);

// Memory
const mems = await alice.json(`/api/memories?characterId=${publicChar.id}`);
check("memory extracted from explicit statement", mems.data?.items?.some((m) => m.content.includes("Somchai")));
check("memories isolated per user", (await bob.json(`/api/memories?characterId=${publicChar.id}`)).data?.items?.length === 0);
const memId = mems.data.items[0].id;
check("other user cannot delete my memory", (await bob.json(`/api/memories/${memId}`, { method: "DELETE" })).status === 404);

// Coins
const daily1 = await alice.json("/api/credits/daily", { method: "POST" });
const daily2 = await alice.json("/api/credits/daily", { method: "POST" });
check("daily bonus once per day", daily1.status === 200 && daily2.status === 409);
check("checkout refuses without payment provider (no fake success)", (await alice.json("/api/billing/checkout", { method: "POST", body: { productId: "coins_300" } })).status >= 400);
check("webhook rejects when not configured / unsigned", (await guest.json("/api/billing/webhook", { method: "POST", body: { id: "x" } })).status >= 400);
check("client cannot set its own balance or role", (await alice.json("/api/users/me", { method: "PATCH", body: { role: "admin", balance: 99999 } })).data?.user?.role === "user");

// Reports & admin protection
const rep = await bob.json("/api/reports", { method: "POST", body: { targetType: "character", targetId: charId, category: "spam", details: "smoke test" } });
check("report a character", rep.status === 201);
check("duplicate report rejected", (await bob.json("/api/reports", { method: "POST", body: { targetType: "character", targetId: charId, category: "spam" } })).status === 409);
check("regular user blocked from admin API", (await alice.json("/api/admin/overview")).status === 403);
check("guest blocked from admin API", (await guest.json("/api/admin/users")).status === 401);
const adminPage = await alice.req("/admin");
check("regular user redirected away from admin UI", adminPage.status >= 300 && adminPage.status < 400);

// Pages render
for (const p of ["/", "/discover", "/search?q=mira", `/characters/${publicChar.id}`, "/login", "/register"]) {
  const r = await guest.req(p);
  check(`page ${p} renders for guests`, r.status === 200 || (p === "/" && r.status === 200));
}
for (const p of ["/discover", "/chats", `/chats/${convId}`, "/library", "/coins", "/profile", "/safety", `/memories/${publicChar.id}`, "/characters/new", `/characters/${charId}/edit`]) {
  const r = await alice.req(p);
  check(`page ${p} renders for signed-in user`, r.status === 200, String(r.status));
}
check("guest redirected from /chats to login", (await guest.req("/chats")).status === 307);
check("other user gets 404 on someone else's chat page", (await bob.req(`/chats/${convId}`)).status === 404);

// Admin flows (optional: set SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD to an admin account)
if (process.env.SMOKE_ADMIN_EMAIL) {
  const admin = new Client();
  const login = await admin.json("/api/auth/login", { method: "POST", body: { email: process.env.SMOKE_ADMIN_EMAIL, password: process.env.SMOKE_ADMIN_PASSWORD } });
  check("admin login", login.status === 200);
  check("admin overview", typeof (await admin.json("/api/admin/overview?days=7")).data?.users?.total === "number");
  const settings = await admin.json("/api/admin/settings");
  check("admin settings expose no secrets", settings.status === 200 && !JSON.stringify(settings.data).toLowerCase().includes("api_key"));
  const meId = (await alice.json("/api/users/me")).data.user.id;
  const adj = await admin.json("/api/admin/billing/adjust", { method: "POST", body: { userId: meId, delta: 25, reason: "smoke test credit", requestId: crypto.randomUUID() } });
  check("admin credit adjustment goes through the ledger", adj.data?.entry?.type === "admin_adjustment");
  const mod = await admin.json(`/api/admin/characters/${charId}`, { method: "POST", body: { action: "suspend", reason: "smoke test" } });
  check("admin can suspend a character", mod.status === 200);
  check("suspended character cannot start new chats", (await bob.json("/api/conversations", { method: "POST", body: { characterId: charId } })).status === 404);
  const reports = await admin.json("/api/admin/reports");
  check("report appears in admin queue", reports.data?.items?.some((r) => r.targetId === charId));
  for (const p of ["/admin", "/admin/users", "/admin/characters", `/admin/characters/${charId}`, "/admin/reports", "/admin/appeals", "/admin/billing", "/admin/ai", "/admin/audit", `/admin/users/${meId}`]) {
    const r = await admin.req(p);
    check(`admin page ${p} renders`, r.status === 200, String(r.status));
  }
}

// Languages: Thai is the default; English via cookie. API errors follow the chosen language.
{
  const thHtml = await (await guest.req("/discover")).text();
  check("default language is Thai", thHtml.includes('lang="th"') && thHtml.includes("ค้นพบ"));
  const en = new Client();
  en.cookie = "lumora_locale=en";
  const enHtml = await (await en.req("/discover")).text();
  check("English when chosen", enHtml.includes('lang="en"') && enHtml.includes("Discover characters"));
  const thErr = await guest.json("/api/auth/login", { method: "POST", body: { email: reg.email, password: "wrongpass99" } });
  check("API errors localized to Thai", thErr.data?.error?.message === "อีเมลหรือรหัสผ่านไม่ถูกต้อง", thErr.data?.error?.message);
  const enErr = await en.json("/api/auth/login", { method: "POST", body: { email: reg.email, password: "wrongpass99" } });
  check("API errors in English when chosen", enErr.data?.error?.message === "Incorrect email or password");
}

// Logout revokes the session
await alice.json("/api/auth/logout", { method: "POST" });
check("logout ends the session", (await alice.json("/api/users/me")).status === 401);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
