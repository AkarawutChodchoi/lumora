"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useT } from "@/i18n/client";

// Top-level tabs have no "back": they are reached from the bottom navigation.
const ROOTS = new Set(["/", "/discover", "/search", "/characters/new", "/chats", "/profile", "/admin"]);

/** Back arrow for phones. Goes back in history, or to `fallback` when the page was opened directly. */
export function BackButton({ fallback = "/discover", className = "" }: { fallback?: string; className?: string }) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  if (ROOTS.has(path)) return null;
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
      className={`-ml-2 grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg ${className}`}
      aria-label={t.nav.back}
    >
      <ArrowLeft className="size-5" />
    </button>
  );
}
