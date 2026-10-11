import { Suspense } from "react";
import { ForgotForm } from "@/components/auth/auth-forms";
import { pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("forgot");

export default function Page() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
