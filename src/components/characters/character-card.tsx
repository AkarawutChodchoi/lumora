"use client";

import Link from "next/link";
import { MessageCircle, Heart, Lock, EyeOff } from "lucide-react";
import type { CharacterCard as Card } from "@/server/services/characters";
import { Avatar, Badge } from "@/components/ui/misc";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";

export function CharacterCard({ c, showStatus }: { c: Card; showStatus?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const compact = (n: number) => Intl.NumberFormat(INTL_LOCALE[locale], { notation: "compact" }).format(n);
  return (
    <Link
      href={`/characters/${c.id}`}
      className="group relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_12px_40px_-16px_#8b7bff80] focus-visible:-translate-y-0.5"
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        <Avatar name={c.name} src={c.avatarUrl} className="size-full text-6xl transition duration-500 group-hover:scale-[1.03]" rounded="rounded-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/10 to-transparent" />
        <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5">
          {c.contentRating !== "general" && <Badge tone={c.contentRating === "mature" ? "danger" : "warn"}>{c.contentRating === "mature" ? "18+" : t.card.teen}</Badge>}
          {showStatus && c.visibility === "private" && (
            <Badge>
              <Lock className="size-3" /> {t.card.private}
            </Badge>
          )}
          {showStatus && c.visibility === "unlisted" && <Badge tone="accent">{t.enums.visibility.unlisted}</Badge>}
          {showStatus && (c.publicationStatus === "hidden" || c.publicationStatus === "suspended") && (
            <Badge tone="danger">
              <EyeOff className="size-3" /> {t.enums.publication[c.publicationStatus]}
            </Badge>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 p-3.5">
          <h3 className="truncate font-display text-base font-bold">{c.name}</h3>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{c.tagline || t.card.noTagline}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-xs text-faint">
        <span className="truncate">{t.common.by(c.creatorName)}</span>
        <span className="flex shrink-0 items-center gap-2.5">
          <span className="flex items-center gap-1" title={t.card.chats}>
            <MessageCircle className="size-3.5" />
            {compact(c.chatCount)}
          </span>
          <span className="flex items-center gap-1" title={t.card.favorites}>
            <Heart className="size-3.5" />
            {compact(c.favoriteCount)}
          </span>
        </span>
      </div>
    </Link>
  );
}

export function CharacterGrid({ items, showStatus }: { items: Card[]; showStatus?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {items.map((c) => (
        <CharacterCard key={c.id} c={c} showStatus={showStatus} />
      ))}
    </div>
  );
}

export function CharacterGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-[var(--radius-card)] border border-line">
          <div className="skeleton aspect-[4/5]" />
          <div className="skeleton m-3 h-3 w-2/3 rounded" />
        </div>
      ))}
    </div>
  );
}
