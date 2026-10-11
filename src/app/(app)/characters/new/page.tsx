import { CharacterForm, EMPTY_CHARACTER } from "@/components/characters/character-form";
import { PageHeader } from "@/components/ui/misc";
import { pageUser } from "@/server/auth/current";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("newCharacter");

export default async function NewCharacterPage() {
  const user = await pageUser("/characters/new");
  const t = await getT();
  return (
    <div className="animate-fade-in">
      <PageHeader title={t.form.createTitle} description={t.form.createSub} />
      <CharacterForm mode="create" initial={EMPTY_CHARACTER} canMature={user.ageConfirmed18} />
    </div>
  );
}
