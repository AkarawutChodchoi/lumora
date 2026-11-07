import { Suspense } from "react";
import { ForgotForm } from "@/components/auth/auth-forms";
import { emailDeliveryEnabled } from "@/lib/server/config";
import { pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("forgot");

export default function Page() {
  return (
    <Suspense>
      {/* In development the link is printed to the server log, so the flow can be tested. */}
      <ForgotForm emailEnabled={emailDeliveryEnabled() || process.env.NODE_ENV !== "production"} />
    </Suspense>
  );
}
