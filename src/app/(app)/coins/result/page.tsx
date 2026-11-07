import { PayResult } from "@/components/billing/pay-result";
import { pageUser } from "@/lib/server/access";
import { getPayment } from "@/lib/server/payments/actions";
import { mockAllowed } from "@/lib/server/payments/gateway";
import { pageTitle } from "@/i18n/server";

export const dynamic = "force-dynamic";
export const generateMetadata = pageTitle("coins");

export default async function PayResultPage({ searchParams }: { searchParams: Promise<{ tx?: string }> }) {
  const { tx } = await searchParams;
  await pageUser(`/coins/result${tx ? `?tx=${encodeURIComponent(tx)}` : ""}`);
  const payment = tx ? await getPayment(tx) : null;
  return <PayResult initial={payment} testTools={mockAllowed() && payment?.status === "pending"} />;
}
