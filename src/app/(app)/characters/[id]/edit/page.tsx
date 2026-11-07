import { notFound } from "next/navigation";
import { CharacterForm } from "@/components/characters/character-form";
import { PageHeader } from "@/components/ui/misc";
import { pageUser } from "@/lib/server/access";
import { can } from "@/lib/permissions";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { findCharacter } from "@/lib/server/characters";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("editCharacter");

export default async function EditCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser(`/characters/${id}/edit`);
  const c = await findCharacter(id);
  // Non-owners get a 404 so private characters are not revealed (admins may edit any).
  if (!c || (c.ownerId !== user.id && !can(user.roles, "characters.edit_any"))) notFound();
  const [{ n: versions }] = await db.select({ n: count() }).from(schema.characterVersion).where(eq(schema.characterVersion.characterId, id));
  const t = await getT();
  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t.form.editTitle(c.name)}
        description={t.form.editSub(c.currentVersion, versions)}
      />
      <CharacterForm
        mode="edit"
        characterId={c.id}
        canMature={user.ageConfirmed18}
        initial={{
          name: c.name,
          tagline: c.tagline,
          description: c.description,
          avatarUrl: c.avatarUrl ?? "",
          personality: c.personality,
          backstory: c.backstory,
          scenario: c.scenario,
          greeting: c.greeting,
          exampleDialogues: c.exampleDialogues,
          tags: c.tags,
          categories: c.categories.length ? c.categories : [c.category],
          contentRating: c.contentRating,
          visibility: c.visibility,
        }}
      />
    </div>
  );
}
