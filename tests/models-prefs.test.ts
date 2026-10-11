import { describe, expect, it } from "vitest";
import { CHAT_MODELS, DEV_MODEL, availableModels, priceOf, resolveModel } from "@/server/ai/models";
import { routeModel } from "@/server/ai/registry";
import { assemblePrompt } from "@/server/ai/prompt";
import { fallbackRefund } from "@/server/services/chat";
import { toPublicUser, updateProfile } from "@/server/services/users";
import { makeUser } from "./helpers";

const character = { name: "Aria", description: "A bard", personality: "warm", backstory: "", scenario: "", exampleDialogues: "" };
const budget = { contextTokens: 8000, memoryTokens: 500 };

describe("chat model catalog", () => {
  it("offers only the placeholder model when no AI provider is configured", () => {
    expect(availableModels()).toEqual([DEV_MODEL]);
    expect(routeModel(null)).toEqual({ model: DEV_MODEL.id, cost: DEV_MODEL.cost });
  });

  it("falls back to the default when the saved choice is not offered", () => {
    expect(resolveModel("gemini-3.8-flash").id).toBe(DEV_MODEL.id);
    expect(resolveModel("made-up-model").id).toBe(DEV_MODEL.id);
  });

  it("prices better models higher and charges Gemini Flash-Lite 5 coins", () => {
    expect(priceOf("gemini-3.5-flash-lite")).toBe(5);
    const gemini = CHAT_MODELS.filter((m) => m.provider === "gemini");
    for (let i = 1; i < gemini.length; i++) expect(gemini[i].cost).toBeGreaterThan(gemini[i - 1].cost);
    expect(new Set(CHAT_MODELS.map((m) => m.id)).size).toBe(CHAT_MODELS.length);
  });

  it("refunds the difference only when a cheaper model answered", () => {
    expect(fallbackRefund("gemini-3.8-flash", 12, "gemini-3.5-flash-lite")).toBe(7);
    expect(fallbackRefund("gemini-3.5-flash-lite", 5, "gemini-3.8-flash")).toBe(0);
    expect(fallbackRefund("gemini-3.8-flash", 12, "gemini-3.8-flash")).toBe(0);
    expect(fallbackRefund("gemini-3.8-flash", 12, "unknown-model")).toBe(0);
  });
});

describe("chat preferences", () => {
  it("adds reply-style guidance to the prompt without touching the cached policy block", () => {
    const base = assemblePrompt({ character, userName: "Mint", memories: [], history: [{ role: "user", content: "hi" }], budget });
    const concise = assemblePrompt({ character, userName: "Mint", style: "concise", memories: [], history: [{ role: "user", content: "hi" }], budget });
    const detailed = assemblePrompt({ character, userName: "Mint", style: "detailed", memories: [], history: [{ role: "user", content: "hi" }], budget });
    expect(base.systemBlocks).toHaveLength(1);
    expect(concise.systemBlocks[0].text).toBe(base.systemBlocks[0].text);
    expect(concise.systemBlocks[1]).toMatchObject({ cacheable: false });
    expect(concise.systemBlocks[1].text).toContain("short");
    expect(detailed.systemBlocks[1].text).toContain("immersive");
  });

  it("saves the reply style and rejects models the deployment does not offer", async () => {
    const u = await makeUser();
    const updated = await updateProfile(u, { responseStyle: "detailed" });
    expect(toPublicUser(updated).responseStyle).toBe("detailed");
    await expect(updateProfile(u, { chatModel: "gemini-3.8-flash" })).rejects.toMatchObject({ code: "validation_failed" });
    const ok = await updateProfile(u, { chatModel: DEV_MODEL.id });
    expect(ok.chatModel).toBe(DEV_MODEL.id);
  });
});

describe("rough language", () => {
  it("lets characters swear and insult back at every content level, with slurs still excluded", () => {
    for (const rating of ["general", "teen", "mature"] as const) {
      const p = assemblePrompt({ character, rating, userName: "Mint", memories: [], history: [{ role: "user", content: "hi" }], budget });
      const system = p.systemBlocks[0].text;
      expect(system).toContain("Swearing and insults are allowed at every content level");
      expect(system).toContain("no slurs");
      expect(system).not.toContain("language mild");
    }
  });
});
