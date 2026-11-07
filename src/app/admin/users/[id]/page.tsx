import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { AccountControls, AdjustCreditsForm, EnforceForm, EraseUserButton } from "@/components/admin/admin-actions";
import { pageStaff } from "@/lib/server/access";
import { can } from "@/lib/permissions";
import { userDetail } from "@/lib/server/admin";
import { AppError } from "@/lib/server/errors";
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
          <p className={row}><span className="text-muted">{t.admin.users.role}</span>{u.roles.length ? u.roles.map((r) => t.enums.role[r] ?? r).join(", ") : t.enums.role.member}</p>
          <p className={row}><span className="text-muted">2FA</span>{u.twoFactorEnabled ? <Badge tone="ok">{t.admin.roles.twoFaOn}</Badge> : <Badge tone="warn">{t.admin.roles.twoFaOff}</Badge>}</p>
          <p className={row}><span className="text-muted">{t.admin.users.status}</span><Badge>{t.enums.userStatus[u.status] ?? u.status}</Badge></p>
          <p className={row}><span className="text-muted">{t.admin.users.joined}</span>{u.createdAt.toLocaleString(L)}</p>
          <p className={row}><span className="text-muted">{t.admin.users.lastActive}</span>{u.lastActiveAt.toLocaleString(L)}</p>
          <p className={row}><span className="text-muted">{T.counts}</span>{u.counts.characters} / {u.counts.conversations} / {u.counts.reportsFiled}</p>
          <p className={row}><span className="text-muted">{T.balance}</span>{u.wallet.paid + u.wallet.bonus} ({t.pay.paidCoins} {u.wallet.paid} · {t.pay.bonusCoins} {u.wallet.bonus})</p>
          <p className={row}><span className="text-muted">Lumora Plus</span>{u.plusUntil ? u.plusUntil.toLocaleDateString(L) : "—"}</p>
          {u.bannedReason && <p className={row}><span className="text-muted">{t.enums.userStatus.suspended}</span>{u.bannedReason}</p>}
          <p className={row}>
            <span className="text-muted">{T.ledgerCheck}</span>
            {u.ledger.consistent ? <Badge tone="ok">{T.consistent}</Badge> : <Badge tone="danger">{T.mismatch(u.ledger.balance, u.ledger.ledgerSum)}</Badge>}
          </p>
          {u.status === "deletion_requested" && can(actor.roles, "users.process_deletion") && (
            <div className="pt-3">
              <p className="mb-2 text-xs text-warn">{T.deletionNote(u.deletionRequestedAt?.toLocaleString(L) ?? "")}</p>
              <EraseUserButton userId={u.id} />
            </div>
          )}
        </Card>
        {can(actor.roles, "users.enforce") && actor.id !== u.id && (
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">{T.enforcement}</h2>
            <EnforceForm userId={u.id} />
          </Card>
        )}
        {can(actor.roles, "billing.adjust") && (
          <Card className="p-5">
            <h2 className="mb-1 font-semibold">{T.adjust}</h2>
            <p className="mb-3 text-xs text-faint">{T.adjustNote}</p>
            <AdjustCreditsForm userId={u.id} />
          </Card>
        )}
        {(can(actor.roles, "users.manage_roles") || can(actor.roles, "users.grant_premium") || can(actor.roles, "users.enforce")) && (
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">{t.admin.account.controls}</h2>
            <AccountControls
              userId={u.id}
              email={u.email}
              roles={u.roles}
              isSelf={actor.id === u.id}
              canRoles={can(actor.roles, "users.manage_roles")}
              canPremium={can(actor.roles, "users.grant_premium")}
              canErase={can(actor.roles, "users.erase")}
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
