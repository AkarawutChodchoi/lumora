"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Modal } from "./modal";
import { Button } from "./button";
import { useLocale, useT } from "@/i18n/client";
import type { TaxonomyGroup } from "@/server/domain/taxonomy";

/**
 * Searchable, grouped chip picker in a dialog (bottom sheet on phones).
 * `max = 1` behaves like a single choice: picking replaces the selection.
 */
export function ChipPicker({
  open,
  onClose,
  title,
  groups,
  selected,
  onChange,
  max,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  groups: TaxonomyGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
  max: number;
}) {
  const t = useT();
  const locale = useLocale();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((it) => it.en.toLowerCase().includes(q) || it.th.includes(q) || it.key.includes(q)) }))
      .filter((g) => g.items.length);
  }, [groups, query]);

  function toggle(key: string) {
    if (max === 1) return onChange(selected[0] === key ? [] : [key]);
    if (selected.includes(key)) onChange(selected.filter((k) => k !== key));
    else if (selected.length < max) onChange([...selected, key]);
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex max-h-[70dvh] flex-col">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.picker.search}
            aria-label={t.picker.search}
            className="h-10 w-full rounded-xl border border-line bg-surface-2 pr-3 pl-9 text-base placeholder:text-faint focus:border-accent focus:outline-none sm:text-sm"
          />
        </div>
        <div className="scrollbar-thin -mx-1 flex-1 space-y-4 overflow-y-auto px-1 pb-2">
          {filtered.length === 0 && <p className="py-6 text-center text-sm text-faint">{t.picker.noResults}</p>}
          {filtered.map((g) => (
            <section key={g.key}>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-faint uppercase">{g[locale]}</h3>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((it) => {
                  const on = selected.includes(it.key);
                  const full = !on && max > 1 && selected.length >= max;
                  return (
                    <button
                      key={it.key}
                      type="button"
                      onClick={() => toggle(it.key)}
                      aria-pressed={on}
                      disabled={full}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-35 ${
                        on ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg"
                      }`}
                    >
                      {on && <Check className="size-3.5 text-accent" />}
                      {it[locale]}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-xs text-faint">{max > 1 ? t.picker.selected(selected.length, max) : ""}</span>
          <Button type="button" onClick={onClose}>
            {t.picker.done}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
