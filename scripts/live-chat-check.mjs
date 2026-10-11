// Real AI round-trip against a deployed site: register a throwaway user, chat once in
// Thai and once in English, print the replies and timings. Usage:
//   node scripts/live-chat-check.mjs https://your-site
// The throwaway account (email starts with "smoke-") should be deleted afterwards.
const BASE = process.argv[2] ?? "http://localhost:3000";
let cookie = "lumora_locale=th";
async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", origin: BASE, cookie },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  const m = set?.match(/lumora_session=([^;]+)/);
  if (m) cookie = `lumora_locale=th; lumora_session=${m[1]}`;
  return res;
}
const email = `smoke-live-${Date.now()}@test.dev`;
await req("/api/auth/register", { method: "POST", body: { email, password: "smokepass1", displayName: "Tester", ageConfirmed: true } });
const trending = (await (await req("/api/discover")).json()).trending;
const mira = trending.find((c) => c.name === "Mira Vale") ?? trending[0];
const conv = await (await req("/api/conversations", { method: "POST", body: { characterId: mira.id } })).json();

for (const text of [
  "สวัสดีค่ะ ฉันชื่อไธม์ วันนี้เหนื่อยมากเลย ขอนั่งพักหน่อยได้ไหม",
  "ฉันเพิ่งสอบวิชา NLP เสร็จ และฉันชอบดูดาวมากเลย",
  "Do you remember my name? Tell me a short sea legend.",
]) {
  const t0 = Date.now();
  const res = await req(`/api/conversations/${conv.id}/messages`, { method: "POST", body: { mode: "send", content: text, clientRequestId: crypto.randomUUID() } });
  if (!res.ok) {
    console.log("HTTP", res.status, await res.text());
    continue;
  }
  const raw = await res.text();
  const events = raw.split("\n\n").filter(Boolean).map((c) => JSON.parse(c.replace(/^data: /, "")));
  const last = events.at(-1);
  console.log(`\n> ${text}\n[${last.type}] ${Date.now() - t0}ms, devMode=${events[0]?.devMode}, deltas=${events.filter((e) => e.type === "delta").length}`);
  console.log(last.type === "done" ? last.message.content : `${last.code}: ${last.message}`);
}
// Automatic memory + note run in the background after the 3rd reply.
await new Promise((r) => setTimeout(r, 20000));
const mems = await (await req(`/api/memories?characterId=${mira.id}`)).json();
const convs = await (await req("/api/conversations")).json();
console.log("\nnote:", convs.items.find((c) => c.id === conv.id)?.note ?? "(none)");
console.log("memories:", mems.items.map((m) => `[${m.source}] ${m.content}`));
console.log("throwaway account:", email);
