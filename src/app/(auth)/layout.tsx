import { Logo } from "@/components/layout/app-shell";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-10">
      <div className="mb-8 flex w-full max-w-sm items-center justify-between">
        <Logo />
        <LanguageSwitcher compact />
      </div>
      <main className="w-full max-w-sm rounded-3xl border border-line bg-surface/80 p-6 shadow-2xl backdrop-blur sm:p-8">{children}</main>
    </div>
  );
}
