import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  getViewableCharacter,
  listVersions,
  publishCharacter,
  searchCharacters,
  setBlocked,
  updateCharacter,
  createCharacter,
} from "@/server/services/characters";
import { startConversation } from "@/server/services/conversations";
import { moderateCharacter } from "@/server/services/admin";
import { characterInput, makeCharacter, makeUser } from "./helpers";

const search = (q: string, viewer: Awaited<ReturnType<typeof makeUser>> | null) => searchCharacters({ q, sort: "newest", page: 1 }, viewer);

describe("character visibility and ownership", () => {
  it("hides private characters from everyone but the owner", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const c = await makeCharacter(owner, { name: "PrivateOne" });
    await expect(getViewableCharacter(c.id, owner)).resolves.toBeTruthy();
    await expect(getViewableCharacter(c.id, other)).rejects.toMatchObject({ code: "not_found" });
    await expect(getViewableCharacter(c.id, null)).rejects.toMatchObject({ code: "not_found" });
  });

  it("publishes immediately when created as public, so other accounts can find it", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const name = `PublicNow${Date.now()}`;
    const c = await createCharacter(owner, characterInput({ name, visibility: "public" }));
    expect(c.publicationStatus).toBe("published");
    expect((await search(name, other)).items.map((i) => i.id)).toContain(c.id);
    await expect(getViewableCharacter(c.id, other)).resolves.toBeTruthy();
  });

  it("keeps unlisted characters out of search but reachable by link", async () => {
    const owner = await makeUser();
    const name = `Unlisted${Date.now()}`;
    const c = await makeCharacter(owner, { name }, "unlisted");
    expect((await search(name, null)).items).toHaveLength(0);
    await expect(getViewableCharacter(c.id, null)).resolves.toBeTruthy();
    await publishCharacter(owner, c.id, "public");
    expect((await search(name, null)).items).toHaveLength(1);
  });

  it("only lets the owner edit, and versions prompt changes", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const c = await makeCharacter(owner);
    await expect(updateCharacter(other, c.id, characterInput({ name: "Hacked" }))).rejects.toMatchObject({ code: "forbidden" });
    await updateCharacter(owner, c.id, characterInput({ tags: ["new"] })); // non-prompt change
    expect((await listVersions(owner, c.id)).length).toBe(1);
    const v2 = await updateCharacter(owner, c.id, characterInput({ personality: "Grumpy" }));
    expect(v2.currentVersion).toBe(2);
    expect((await listVersions(owner, c.id)).length).toBe(2);
  });

  it("pins conversations to the version they started with", async () => {
    const owner = await makeUser();
    const c = await makeCharacter(owner, {}, "public");
    const conv = await startConversation(owner, c.id);
    await updateCharacter(owner, c.id, characterInput({ visibility: "public", greeting: "A new greeting" }));
    const pinned = await db.conversation.findUniqueOrThrow({ where: { id: conv.id }, include: { characterVersion: true } });
    expect(pinned.characterVersion.version).toBe(1);
  });

  it("blocks suspended characters from publishing and new chats", async () => {
    const owner = await makeUser();
    const admin = await makeUser({ role: "admin" });
    const user = await makeUser();
    const c = await makeCharacter(owner, {}, "public");
    await moderateCharacter(admin, c.id, { action: "suspend", reason: "policy violation" });
    await expect(publishCharacter(owner, c.id, "public")).rejects.toMatchObject({ code: "forbidden" });
    await expect(startConversation(user, c.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(startConversation(owner, c.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("hides mature characters unless the viewer opted in as 18+", async () => {
    const owner = await makeUser({ ageConfirmed18: true });
    const minorish = await makeUser();
    const adult = await makeUser({ ageConfirmed18: true, matureContentEnabled: true });
    const name = `Mature${Date.now()}`;
    const c = await makeCharacter(owner, { name, contentRating: "mature" }, "public");
    expect((await search(name, minorish)).items).toHaveLength(0);
    expect((await search(name, adult)).items).toHaveLength(1);
    await expect(getViewableCharacter(c.id, minorish)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses mature ratings from accounts not confirmed 18+, and blocks prohibited content", async () => {
    const u = await makeUser();
    await expect(createCharacter(u, characterInput({ contentRating: "mature" }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(createCharacter(u, characterInput({ backstory: "explicit sex with a 12 year old" }))).rejects.toMatchObject({ code: "content_blocked" });
  });

  it("removes blocked characters from the viewer's search results", async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const name = `Blockable${Date.now()}`;
    const c = await makeCharacter(owner, { name }, "public");
    await setBlocked(viewer, c.id, true);
    expect((await search(name, viewer)).items).toHaveLength(0);
    expect((await search(name, owner)).items).toHaveLength(1);
  });
});
