import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { th } from "@/i18n/th";
import { localizeMessage } from "@/i18n/errors";
import { CATEGORIES, REPORT_CATEGORIES, MEMORY_TYPES, USER_STATUSES } from "@/server/domain/enums";

/** Flatten a dictionary into path -> value, calling functions with sample arguments. */
function flatten(obj: unknown, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof obj === "function") {
    out[prefix] = (obj as (...a: unknown[]) => unknown)("x", 2, "y");
  } else if (Array.isArray(obj) || (obj && typeof obj === "object")) {
    for (const [k, v] of Object.entries(obj as object)) Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  } else {
    out[prefix] = obj;
  }
  return out;
}

describe("dictionaries", () => {
  const flatEn = flatten(en);
  const flatTh = flatten(th);

  it("Thai has exactly the same keys as English", () => {
    expect(Object.keys(flatTh).sort()).toEqual(Object.keys(flatEn).sort());
  });

  it("has no empty strings", () => {
    for (const [k, v] of [...Object.entries(flatEn), ...Object.entries(flatTh)]) {
      if (typeof v === "string") expect(v.trim(), k).not.toBe("");
    }
  });

  it("actually translates (Thai text contains Thai script for most entries)", () => {
    const strings = Object.entries(flatTh).filter(([, v]) => typeof v === "string") as [string, string][];
    const thai = strings.filter(([, v]) => /[฀-๿]/.test(v));
    expect(thai.length / strings.length).toBeGreaterThan(0.9);
  });

  it("labels every enum value in both languages", () => {
    for (const d of [en, th]) {
      for (const c of CATEGORIES) expect(d.enums.category[c], c).toBeTruthy();
      for (const c of REPORT_CATEGORIES) expect(d.enums.reportCategory[c], c).toBeTruthy();
      for (const c of MEMORY_TYPES) expect(d.enums.memoryType[c], c).toBeTruthy();
      for (const c of USER_STATUSES) expect(d.enums.userStatus[c], c).toBeTruthy();
    }
  });
});

describe("server error localization", () => {
  it("passes English through unchanged", () => {
    expect(localizeMessage("Not enough coins for this action", "en")).toBe("Not enough coins for this action");
  });

  it("translates known messages and patterns to Thai", () => {
    expect(localizeMessage("Not enough coins for this action", "th")).toBe("เหรียญไม่พอสำหรับรายการนี้");
    expect(localizeMessage("Character not found", "th")).toBe("ไม่พบตัวละคร");
    expect(localizeMessage("Too many requests. Try again in 42s.", "th")).toContain("42");
    expect(localizeMessage("some unknown zod message", "th", { validation: true })).toBe("ข้อมูลในช่องนี้ไม่ถูกต้อง");
  });

  it("has a Thai translation for every user-facing AppError message in the server code", () => {
    const root = path.resolve(__dirname, "../src/server");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(root);
    const messages = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/new AppError\("[a-z_]+",\s*"([^"]+)"/g)) messages.add(m[1]);
      for (const m of src.matchAll(/new ProviderError\("[a-z_]+",\s*"([^"]+)"/g)) messages.add(m[1]);
    }
    // Messages that are never shown to end users (payment webhooks are server-to-server).
    const internal = new Set([
      "Unknown user",
      "Unknown purchase",
      "Unknown subscription",
      "Missing plan or period",
      "Payment amount does not match the product price",
      "Payment amount does not match the plan price",
      "Subscription belongs to another user",
      "Simulated provider failure (dev mode)",
      "Generation was cancelled",
      "Unexpected error from the AI service",
      "cancelled",
    ]);
    const missing = [...messages].filter((m) => !internal.has(m) && localizeMessage(m, "th") === m);
    expect(missing).toEqual([]);
  });
});
