import { PageHeader } from "@/components/ui/misc";
import { PaymentsTable } from "@/components/admin/payments-table";
import { pageStaff } from "@/lib/server/access";
import { can } from "@/lib/permissions";
import { adminListPayments } from "@/lib/server/payments/actions";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments" };

const STATUSES = ["all", "pending", "paid", "failed", "expired", "mismatch", "refunded"] as const;

export default async function AdminPayments({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const actor = await pageStaff("billing.view");
  const t = await getT();
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUSES)[number]) : "all";
  const q = sp.q?.slice(0, 80) ?? "";
  const data = await adminListPayments({ status, q });
  return (
    <div className="space-y-6">
      <PageHeader title={t.admin.nav.payments} description={t.admin.payments.subtitle} />
      <PaymentsTable data={data} status={status} q={q} statuses={[...STATUSES]} canRecheck={can(actor.roles, "payments.recheck")} />
    </div>
  );
}
