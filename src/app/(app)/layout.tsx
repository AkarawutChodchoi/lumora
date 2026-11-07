import { AppShell } from "@/components/layout/app-shell";
import { currentUser } from "@/lib/server/access";
import { activeAiProvider } from "@/lib/server/config";
import { can, isStaff } from "@/lib/permissions";
import { getBalance } from "@/lib/server/wallet";
import { staffInbox } from "@/lib/server/admin";
import { unreadCount } from "@/lib/server/notify";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const shellUser = user
    ? {
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isStaff: can(user.roles, "admin.view"),
        balance: await getBalance(user.id),
        status: user.status,
        unread: await unreadCount(user.id),
        staffInbox: can(user.roles, "reports.review") ? (await staffInbox()).total : 0,
        prefs: user.prefs,
      }
    : null;
  // holds a staff role whose powers are dormant until 2FA is turned on
  const needs2fa = Boolean(user && isStaff(user.allRoles) && !isStaff(user.roles));
  return (
    <AppShell user={shellUser} devMode={activeAiProvider() === "dev"} needs2fa={needs2fa}>
      {children}
    </AppShell>
  );
}
