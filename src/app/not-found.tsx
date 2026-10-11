import { ButtonLink } from "@/components/ui/button";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-6xl font-extrabold text-accent">404</p>
      <h1 className="mt-4 text-xl font-bold">{t.notFound.title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">{t.notFound.body}</p>
      <ButtonLink href="/discover" className="mt-6">
        {t.notFound.back}
      </ButtonLink>
    </div>
  );
}
