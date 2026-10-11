import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/auth-forms";
import { pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("register");

export default function Page() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
