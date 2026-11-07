import { ProfileSettings } from "@/components/profile/profile-settings";
import { pageUser } from "@/lib/server/access";
import { can, isStaff } from "@/lib/permissions";
import { toPublicUser } from "@/lib/server/users";
import { pageTitle } from "@/i18n/server";
import { cookies } from "next/headers";
import { modelOptions, resolveModel } from "@/lib/server/ai/models";
import { mergePrefs, readDisplayPrefs } from "@/lib/display-prefs";

export const generateMetadata = pageTitle("profile");

export default async function ProfilePage() {
  const user = await pageUser("/profile");
  return (
    <div className="mx-auto max-w-2xl animate-fade-in">
      <ProfileSettings
        me={JSON.parse(JSON.stringify(toPublicUser(user)))}
        isStaff={can(user.roles, "admin.view")}
        needs2fa={isStaff(user.allRoles)}
        models={modelOptions()}
        model={resolveModel(user.chatModel).id}
        display={mergePrefs(readDisplayPrefs(await cookies()), user.prefs)}
      />
    </div>
  );
}
