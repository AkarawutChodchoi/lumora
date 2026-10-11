import { AppShell } from "@/components/layout/app-shell";
import { currentUser } from "@/server/auth/current";
import { activeAiProvider } from "@/server/config";
import { can } from "@/server/domain/permissions";
import { getBalance } from "@/server/services/credits";
import { staffInbox } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const shellUser = user
    ? {
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isStaff: can(user.role, "admin.view"),
        balance: await getBalance(user.id),
        status: user.status,
        staffInbox: can(user.role, "reports.review") ? (await staffInbox()).total : 0,
      }
    : null;
  return (
    <AppShell user={shellUser} devMode={activeAiProvider() === "dev"}>
      {children}
    </AppShell>
  );
}
