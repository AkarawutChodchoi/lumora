"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export function MarkAllRead({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await api("/api/notifications", { method: "POST" }).catch(() => undefined);
        setBusy(false);
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
