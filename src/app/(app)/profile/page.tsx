import { ProfileSettings } from "@/components/profile/profile-settings";
import { pageUser } from "@/server/auth/current";
import { can } from "@/server/domain/permissions";
import { toPublicUser } from "@/server/services/users";
import { pageTitle } from "@/i18n/server";
import { cookies } from "next/headers";
import { modelOptions, resolveModel } from "@/server/ai/models";
import { readDisplayPrefs } from "@/lib/display-prefs";

export const generateMetadata = pageTitle("profile");

export default async function ProfilePage() {
  const user = await pageUser("/profile");
  return (
    <div className="mx-auto max-w-2xl animate-fade-in">
      <ProfileSettings me={JSON.parse(JSON.stringify(toPublicUser(user)))} isStaff={can(user.role, "admin.view")}
        models={modelOptions()}
        model={resolveModel(user.chatModel).id}
        display={readDisplayPrefs(await cookies())}
      />
    </div>
  );
}
