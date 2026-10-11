import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { sniffImage, storeImage } from "@/server/services/images";
import { characterInputSchema, createCharacter, searchCharacters, toCard } from "@/server/services/characters";
import { profileSchema } from "@/server/services/users";
import { characterInput, makeCharacter, makeUser } from "./helpers";

// 1×1 transparent PNG and a minimal 2×3 JPEG header.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x02, 0x03, 0x01, 0x22, 0x00]);

describe("image uploads", () => {
  it("identifies images by their bytes, not by what the client claims", () => {
    expect(sniffImage(PNG)).toEqual({ mime: "image/png", width: 1, height: 1 });
    expect(sniffImage(JPEG)).toEqual({ mime: "image/jpeg", width: 2, height: 3 });
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(Buffer.from("GIF89a......"))).toBeNull();
  });

  it("stores a valid image and rejects other files", async () => {
    const u = await makeUser();
    const img = await storeImage(u, PNG);
    expect(img.url).toMatch(/^\/api\/images\/[a-z0-9]+$/);
    const row = await db.image.findUniqueOrThrow({ where: { id: img.id } });
    expect(row).toMatchObject({ ownerId: u.id, mime: "image/png", width: 1, height: 1 });
    await expect(storeImage(u, Buffer.from("not an image at all"))).rejects.toMatchObject({ code: "bad_request" });
    await expect(storeImage(u, Buffer.alloc(0))).rejects.toMatchObject({ code: "bad_request" });
  });

  it("accepts uploaded image paths and https links as avatars, and nothing else", async () => {
    const u = await makeUser();
    const img = await storeImage(u, PNG);
    const c = await createCharacter(u, characterInput({ avatarUrl: img.url }));
    expect(c.avatarUrl).toBe(img.url);
    expect(profileSchema.safeParse({ avatarUrl: img.url }).success).toBe(true);
    expect(profileSchema.safeParse({ avatarUrl: "https://example.com/a.png" }).success).toBe(true);
    expect(profileSchema.safeParse({ avatarUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(profileSchema.safeParse({ avatarUrl: "/api/images/../../etc/passwd" }).success).toBe(false);
  });
});

describe("multiple categories", () => {
  it("saves up to 10 categories with the first as primary", async () => {
    const u = await makeUser();
    const c = await createCharacter(u, characterInput({ categories: ["mystery", "romance", "fantasy"] }));
    expect(c.category).toBe("mystery");
    expect(JSON.parse(c.categories)).toEqual(["mystery", "romance", "fantasy"]);
  });

  it("rejects zero, more than 10, or unknown categories at the API boundary", () => {
    const base = { name: "X", greeting: "Hi" };
    expect(characterInputSchema.safeParse({ ...base, categories: [] }).success).toBe(false);
    const eleven = ["adventure", "romance", "fantasy", "sci-fi", "slice-of-life", "mystery", "horror", "comedy", "anime", "companion", "education"];
    expect(characterInputSchema.safeParse({ ...base, categories: eleven }).success).toBe(false);
    expect(characterInputSchema.safeParse({ ...base, categories: ["not-a-category"] }).success).toBe(false);
    expect(characterInputSchema.parse({ ...base, categories: ["comedy", "comedy", "horror"] }).categories).toEqual(["comedy", "horror"]);
  });

  it("finds a character by any of its categories", async () => {
    const u = await makeUser();
    const name = `Multi${Date.now()}`;
    const c = await makeCharacter(u, { name, categories: ["horror", "comedy"] }, "public");
    for (const category of ["horror", "comedy"] as const) {
      const { items } = await searchCharacters({ q: name, category, sort: "newest", page: 1 }, null);
      expect(items.map((i) => i.id)).toContain(c.id);
    }
    const { items } = await searchCharacters({ q: name, category: "romance", sort: "newest", page: 1 }, null);
    expect(items).toHaveLength(0);
    const card = toCard({ ...(await db.character.findUniqueOrThrow({ where: { id: c.id } })), owner: { displayName: "x" } });
    expect(card.categories).toEqual(["horror", "comedy"]);
  });
});
