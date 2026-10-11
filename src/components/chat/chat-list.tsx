"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Pin, Search } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";

export interface ChatListItem {
  id: string;
  title: string;
  pinned: boolean;
  lastMessageAt: string;
  preview: string;
  lastFromUser: boolean;
  note: string | null;
  noteAt: string | null;
  character: { id: string; name: string; avatarUrl: string | null };
}

const NOTE_FRESH_MS = 3 * 24 * 60 * 60 * 1000;
/** Notes come only from the characters the user talked to most recently. */
const NOTE_CHARACTERS = 10;

/** Instagram-style inbox: character notes along the top, conversations below. */
export function ChatList({ items }: { items: ChatListItem[] }) {
  const t = useT();
  const locale = useLocale();
  const [q, setQ] = useState("");

  const when = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    if (diff < 60_000) return t.chats.now;
    if (diff < 3_600_000) return t.chats.minutes(Math.floor(diff / 60_000));
    if (diff < 86_400_000) return t.chats.hours(Math.floor(diff / 3_600_000));
    return new Date(d).toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "short" });
  };

  // One bubble per character, limited to the 10 characters chatted with most recently.
  const notes = useMemo(() => {
    const seen = new Set<string>();
    return [...items]
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
      .filter((c) => (seen.has(c.character.id) ? false : (seen.add(c.character.id), true)))
      .slice(0, NOTE_CHARACTERS)
      .filter((c) => c.note && c.noteAt && Date.now() - new Date(c.noteAt).getTime() < NOTE_FRESH_MS);
  }, [items]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((c) => c.title.toLowerCase().includes(s) || c.character.name.toLowerCase().includes(s) || c.preview.toLowerCase().includes(s)) : items;
  }, [items, q]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="shrink-0 font-display text-xl font-bold">{t.chats.title}</h1>
        <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.chats.search}
          aria-label={t.chats.search}
          className="h-10 w-full rounded-full border border-line bg-surface-2 pr-4 pl-10 text-base placeholder:text-faint focus:border-accent focus:outline-none sm:text-sm"
        />
        </div>
      </div>

      {notes.length > 0 && !q && (
        <section aria-label={t.chats.notes} className="mb-4">
          <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pt-12 pb-1">
            {notes.map((c) => (
              <Link key={c.id} href={`/chats/${c.id}`} className="relative flex w-24 shrink-0 flex-col items-center gap-1.5">
                <span className="absolute -top-11 left-1/2 z-10 w-[92px] -translate-x-1/2 animate-fade-in">
                  <span className="relative block rounded-2xl bg-surface-3 px-2.5 py-1.5 text-center text-[11px] leading-snug text-fg shadow-lg">
                    <span className="line-clamp-2">{c.note}</span>
                    <span className="absolute -bottom-1 left-1/2 size-2.5 -translate-x-1/2 rotate-45 bg-surface-3" aria-hidden="true" />
                  </span>
                </span>
                <span className="rounded-full bg-gradient-to-tr from-accent via-glow to-warn p-[2px]">
                  <span className="block rounded-full bg-bg p-[2px]">
                    <Avatar name={c.character.name} src={c.character.avatarUrl} className="size-16 text-xl" />
                  </span>
                </span>
                <span className="w-full truncate text-center text-xs text-muted">{c.character.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <h2 className="mb-1 text-sm font-semibold text-muted">{t.chats.messages}</h2>
      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-faint">{t.picker.noResults}</p>
      ) : (
        <ul className="-mx-2">
          {filtered.map((c) => (
            <li key={c.id}>
              <Link href={`/chats/${c.id}`} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-surface-2">
                <Avatar name={c.character.name} src={c.character.avatarUrl} className="size-14 text-lg" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-semibold">
                    {c.title}
                    {c.pinned && <Pin className="size-3.5 shrink-0 text-accent" aria-label={t.chat.pinned} />}
                  </p>
                  <p className="flex min-w-0 items-center gap-1 text-sm text-muted">
                    <span className="truncate">
                      {c.lastFromUser ? `${t.chats.you}: ` : ""}
                      {c.preview || t.chats.noMessages}
                    </span>
                    <span className="shrink-0 text-faint">· {when(c.lastMessageAt)}</span>
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
