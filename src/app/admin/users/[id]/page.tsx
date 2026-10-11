import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { AccountControls, AdjustCreditsForm, EnforceForm, EraseUserButton } from "@/components/admin/admin-actions";
import { pageStaff } from "@/server/auth/current";
import { can } from "@/server/domain/permissions";
import { userDetail } from "@/server/services/admin";
import { AppError } from "@/server/errors";
import { getLocale, getT, pageTitle } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";

export const generateMetadata = pageTitle("adminUser");

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const actor = await pageStaff("users.view");
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const T = t.admin.user;
  const L = INTL_LOCALE[locale];
  const { id } = await params;
  let u;
  try {
    u = await userDetail(id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const row = "flex justify-between gap-3";
  return (
    <div>
      <PageHeader title={u.displayName} description={`${u.email} · ${u.id}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-2 p-5 text-sm">
          <h2 className="mb-2 font-semibold">{T.account}</h2>
          <p className={row}><span className="text-muted">{t.admin.users.role}</span>{t.enums.role[u.role] ?? u.role}</p>
          <p className={row}><span className="text-muted">{t.admin.users.status}</span><Badge>{t.enums.userStatus[u.status] ?? u.status}</Badge></p>
          <p className={row}><span className="text-muted">{t.admin.users.joined}</span>{u.createdAt.toLocaleString(L)}</p>
          <p className={row}><span className="text-muted">{t.admin.users.lastActive}</span>{u.lastActiveAt.toLocaleString(L)}</p>
          <p className={row}><span className="text-muted">{T.counts}</span>{u._count.characters} / {u._count.conversations} / {u._count.reportsFiled}</p>
          <p className={row}><span className="text-muted">{T.balance}</span>{u.creditAccount?.balance ?? 0}</p>
          <p className={row}>
            <span className="text-muted">{T.ledgerCheck}</span>
            {u.ledger.consistent ? <Badge tone="ok">{T.consistent}</Badge> : <Badge tone="danger">{T.mismatch(u.ledger.balance, u.ledger.ledgerSum)}</Badge>}
          </p>
          {u.status === "deletion_requested" && can(actor.role, "users.process_deletion") && (
            <div className="pt-3">
              <p className="mb-2 text-xs text-warn">{T.deletionNote(u.deletionRequestedAt?.toLocaleString(L) ?? "")}</p>
              <EraseUserButton userId={u.id} />
            </div>
          )}
        </Card>
        {can(actor.role, "users.enforce") && actor.id !== u.id && (
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">{T.enforcement}</h2>
            <EnforceForm userId={u.id} />
          </Card>
        )}
        {can(actor.role, "billing.adjust") && (
          <Card className="p-5">
            <h2 className="mb-1 font-semibold">{T.adjust}</h2>
            <p className="mb-3 text-xs text-faint">{T.adjustNote}</p>
            <AdjustCreditsForm userId={u.id} />
          </Card>
        )}
        {(can(actor.role, "users.manage_roles") || can(actor.role, "users.grant_premium") || can(actor.role, "users.enforce")) && (
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">{t.admin.account.controls}</h2>
            <AccountControls
              userId={u.id}
              email={u.email}
              role={u.role}
              isSelf={actor.id === u.id}
              canRoles={can(actor.role, "users.manage_roles")}
              canPremium={can(actor.role, "users.grant_premium")}
              canErase={can(actor.role, "users.erase")}
            />
          </Card>
        )}
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 font-semibold">{T.history}</h2>
          {u.enforcements.length === 0 ? (
            <p className="text-sm text-faint">{t.common.none}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {u.enforcements.map((e) => (
                <li key={e.id} className="py-2.5">
                  <Badge>{t.enums.enforcement[e.action] ?? e.action}</Badge> <span className="ml-2 text-muted">{e.reason}</span>
                  <span className="block text-xs text-faint">{e.createdAt.toLocaleString(L)} · {T.byActor(e.actorId)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
