import { Suspense } from "react";
import { ResetForm } from "@/components/auth/auth-forms";
import { pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("reset");

export default function Page() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
