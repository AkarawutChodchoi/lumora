import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth-forms";
import { pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("login");

export default function Page() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
