"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, LayoutGrid, MessageCircle } from "lucide-react";
import type { CharacterCard } from "@/server/services/characters";
import { Avatar, Badge } from "@/components/ui/misc";
import { ChipPicker } from "@/components/ui/chip-picker";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";
import { CATEGORY_GROUPS, POPULAR_CATEGORIES } from "@/server/domain/taxonomy";

const compact = (n: number, locale: string) => Intl.NumberFormat(locale, { notation: "compact" }).format(n);

/** Steam-style hero: big swipeable spotlight cards that advance on their own. */
export function HeroCarousel({ items }: { items: CharacterCard[] }) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const paused = useRef(false);

  const go = (i: number) => {
    const el = track.current;
    if (!el || !items.length) return;
    const next = (i + items.length) % items.length;
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => !paused.current && go(index + 1), 6000);
    return () => clearInterval(id);
  });

  if (!items.length) return null;
  return (
    <section className="relative mb-10" aria-roledescription="carousel" aria-label={t.discover.featured} onPointerEnter={() => (paused.current = true)} onPointerLeave={() => (paused.current = false)}>
      <div
        ref={track}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto rounded-[var(--radius-card)]"
      >
        {items.map((c) => (
          <Link key={c.id} href={`/characters/${c.id}`} className="relative w-full shrink-0 snap-center overflow-hidden rounded-[var(--radius-card)] border border-line" aria-label={c.name}>
            {/* Blurred backdrop from the portrait, then the portrait itself — like a store capsule. */}
            <div className="absolute inset-0 scale-105 opacity-80 sm:scale-110 sm:opacity-50 sm:blur-2xl" aria-hidden="true">
              <Avatar name={c.name} src={c.avatarUrl} className="size-full text-9xl" rounded="rounded-none" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/0 sm:bg-gradient-to-r sm:from-bg sm:via-bg/80 sm:to-bg/30" />
            <div className="relative flex min-h-[360px] items-end gap-5 p-5 sm:min-h-[320px] sm:items-center sm:p-8">
              <Avatar name={c.name} src={c.avatarUrl} className="hidden aspect-[4/5] w-44 text-6xl shadow-2xl sm:grid lg:w-52" rounded="rounded-2xl" />
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {c.categories.slice(0, 3).map((k) => (
                    <Badge key={k} tone="accent">
                      {t.enums.category[k] ?? k}
                    </Badge>
                  ))}
                  {c.contentRating === "mature" && <Badge tone="danger">18+</Badge>}
                </div>
                <h2 className="font-display text-3xl leading-tight font-extrabold tracking-tight sm:text-4xl">{c.name}</h2>
                <p className="mt-2 line-clamp-2 max-w-xl text-sm text-muted sm:text-base">{c.tagline}</p>
                <p className="mt-3 flex items-center gap-3 text-xs text-faint">
                  <span className="flex items-center gap-1">
                    <MessageCircle className="size-3.5" /> {c.chatCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="size-3.5" /> {c.favoriteCount}
                  </span>
                  <span>{t.common.by(c.creatorName)}</span>
                </p>
                <span className="mt-4 inline-flex items-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white">{t.discover.meet}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {items.length > 1 && (
        <>
          <button type="button" onClick={() => go(index - 1)} className="absolute top-1/2 -left-3 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/90 backdrop-blur hover:bg-surface-2 md:grid" aria-label={t.common.previous}>
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" onClick={() => go(index + 1)} className="absolute top-1/2 -right-3 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/90 backdrop-blur hover:bg-surface-2 md:grid" aria-label={t.common.next}>
            <ChevronRight className="size-5" />
          </button>
          <div className="mt-3 flex justify-center gap-1.5">
            {items.map((c, i) => (
              <button key={c.id} type="button" onClick={() => go(i)} aria-label={`${i + 1}`} aria-current={i === index} className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-accent" : "w-1.5 bg-line-strong"}`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const TILE_COLORS = [
  "from-rose-500/80 to-fuchsia-700/80",
  "from-violet-500/80 to-indigo-700/80",
  "from-amber-500/80 to-orange-700/80",
  "from-sky-500/80 to-blue-700/80",
  "from-emerald-500/80 to-teal-700/80",
  "from-slate-500/80 to-slate-800/80",
];

/** "Browse by category" tiles, plus a button that opens the full category picker. */
export function CategoryTiles() {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">{t.discover.browseCategories}</h2>
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 text-sm text-muted hover:text-fg">
          <LayoutGrid className="size-4" /> {t.picker.allCategories}
        </button>
      </div>
      <div className="scrollbar-none -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4">
        {POPULAR_CATEGORIES.map((k, i) => (
          <Link
            key={k}
            href={`/search?category=${k}`}
            className={`relative flex h-24 w-36 shrink-0 snap-start items-end overflow-hidden rounded-2xl bg-gradient-to-br p-3 font-display text-base font-bold text-white shadow-lg sm:w-44 ${TILE_COLORS[i % TILE_COLORS.length]}`}
          >
            <span className="absolute -top-6 -right-6 size-20 rounded-full bg-white/10" aria-hidden="true" />
            {t.enums.category[k] ?? k}
          </Link>
        ))}
        <button type="button" onClick={() => setOpen(true)} className="flex h-24 w-36 shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line-strong text-sm text-muted hover:text-fg sm:w-44">
          <LayoutGrid className="size-5" /> {t.picker.allCategories}
        </button>
      </div>
      <ChipPicker
        open={open}
        onClose={() => setOpen(false)}
        title={t.picker.allCategories}
        groups={CATEGORY_GROUPS}
        selected={[]}
        max={1}
        onChange={(next) => {
          setOpen(false);
          if (next[0]) router.push(`/search?category=${next[0]}`);
        }}
      />
    </section>
  );
}

/** Horizontal row of compact capsules (swipe on phones). */
export function CapsuleRow({ title, href, items, seeAll }: { title: string; href: string; items: CharacterCard[]; seeAll: string }) {
  if (!items.length) return null;
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <Link href={href} className="text-sm text-muted hover:text-fg">
          {seeAll}
        </Link>
      </div>
      <div className="scrollbar-none -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4">
        {items.map((c) => (
          <Link key={c.id} href={`/characters/${c.id}`} className="group w-36 shrink-0 snap-start sm:w-44">
            <div className="relative overflow-hidden rounded-2xl border border-line">
              <Avatar name={c.name} src={c.avatarUrl} className="aspect-[4/5] w-full text-5xl transition duration-500 group-hover:scale-[1.04]" rounded="rounded-none" />
              {c.contentRating === "mature" && (
                <Badge tone="danger" className="absolute top-2 left-2">
                  18+
                </Badge>
              )}
            </div>
            <p className="mt-2 truncate text-sm font-semibold">{c.name}</p>
            <p className="truncate text-xs text-faint">{c.tagline}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Steam-style tabbed list (New & trending / Top / Most loved) with dense rows. */
export function StoreTabs({ lists }: { lists: { key: string; label: string; items: CharacterCard[] }[] }) {
  const t = useT();
  const locale = useLocale();
  const [tab, setTab] = useState(lists[0]?.key);
  const current = lists.find((l) => l.key === tab) ?? lists[0];
  if (!current) return null;
  return (
    <section className="mb-10">
      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {lists.map((l) => (
          <button
            key={l.key}
            role="tab"
            aria-selected={l.key === current.key}
            onClick={() => setTab(l.key)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${l.key === current.key ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <ul className="space-y-2" role="tabpanel">
        {current.items.slice(0, 10).map((c, i) => (
          <li key={c.id}>
            <Link href={`/characters/${c.id}`} className="flex items-center gap-3 rounded-2xl border border-transparent bg-surface/60 p-2 pr-3 hover:border-line hover:bg-surface-2">
              <span className="w-5 shrink-0 text-center text-sm font-bold text-faint tabular-nums">{i + 1}</span>
              <Avatar name={c.name} src={c.avatarUrl} className="aspect-[4/5] w-14 text-xl" rounded="rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="truncate text-xs text-muted">{c.tagline}</p>
                <div className="mt-1 flex gap-1 overflow-hidden">
                  {c.categories.slice(0, 2).map((k) => (
                    <span key={k} className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">
                      {t.enums.category[k] ?? k}
                    </span>
                  ))}
                  {c.tags.slice(0, 2).map((k) => (
                    <span key={k} className="shrink-0 truncate rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] text-faint">
                      #{t.enums.tag[k] ?? k}
                    </span>
                  ))}
                </div>
              </div>
              <div className="shrink-0 text-right text-xs text-faint">
                <p className="flex items-center justify-end gap-1">
                  <MessageCircle className="size-3.5" /> {compact(c.chatCount, INTL_LOCALE[locale])}
                </p>
                <p className="mt-1 flex items-center justify-end gap-1">
                  <Heart className="size-3.5" /> {compact(c.favoriteCount, INTL_LOCALE[locale])}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
