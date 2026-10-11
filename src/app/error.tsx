"use client";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-bold">{t.errorPage.title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">{t.errorPage.body}</p>
      <Button className="mt-6" onClick={reset}>
        {t.common.tryAgain}
      </Button>
    </div>
  );
}
