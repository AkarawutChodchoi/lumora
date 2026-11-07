import Link from "next/link";
import { Logo } from "@/components/layout/app-shell";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

/** Alinmanga-style sign-in frame: logo on top, one centered card. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-10">
      <div className="mb-8 flex w-full max-w-[420px] items-center justify-between">
        <Link href="/discover" aria-label="Lumora">
          <Logo />
        </Link>
        <LanguageSwitcher compact />
      </div>
      <main className="w-full max-w-[420px] rounded-[18px] border border-line bg-card p-6 sm:p-8">{children}</main>
    </div>
  );
}
