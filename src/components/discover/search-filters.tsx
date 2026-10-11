"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Hash, LayoutGrid, X } from "lucide-react";
import { ChipPicker } from "@/components/ui/chip-picker";
import { useT } from "@/i18n/client";
import { CATEGORY_GROUPS, POPULAR_CATEGORIES, TAG_GROUPS } from "@/server/domain/taxonomy";

type Params = { q?: string; category?: string; tag?: string; sort: string };

function href(p: Params, patch: Partial<Params>) {
  const merged = { ...p, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, String(v));
  return `/search?${qs.toString()}`;
}

/** Category/tag filters: popular categories as chips, everything else in picker dialogs. */
export function SearchFilters({ params }: { params: Params }) {
  const t = useT();
  const router = useRouter();
  const [picker, setPicker] = useState<null | "category" | "tag">(null);
  const quick = params.category && !POPULAR_CATEGORIES.includes(params.category) ? [params.category, ...POPULAR_CATEGORIES] : POPULAR_CATEGORIES;
  const chip = (on: boolean) => `shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${on ? "bg-accent text-white" : "border border-line text-muted hover:text-fg"}`;

  return (
    <div className="mb-6 space-y-3">
      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        <Link href={href(params, { category: undefined })} className={chip(!params.category)}>
          {t.search.all}
        </Link>
        {quick.map((c) => (
          <Link key={c} href={href(params, { category: c })} className={chip(params.category === c)}>
            {t.enums.category[c] ?? c}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setPicker("category")} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm hover:border-line-strong">
          <LayoutGrid className="size-4 text-accent" />
          {params.category ? (t.enums.category[params.category] ?? params.category) : t.picker.allCategories}
          <ChevronDown className="size-4 text-faint" />
        </button>
        <button type="button" onClick={() => setPicker("tag")} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm hover:border-line-strong">
          <Hash className="size-4 text-accent" />
          {params.tag ? (t.enums.tag[params.tag] ?? params.tag) : t.picker.filterTag}
          <ChevronDown className="size-4 text-faint" />
        </button>
        {params.tag && (
          <Link href={href(params, { tag: undefined })} className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
            <X className="size-3.5" /> {t.search.clear}
          </Link>
        )}
        <div className="ml-auto flex gap-1 rounded-xl border border-line p-1 text-sm">
          {(["popular", "newest", "favorites"] as const).map((s) => (
            <Link key={s} href={href(params, { sort: s })} className={`rounded-lg px-2.5 py-1 ${params.sort === s ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"}`}>
              {t.search.sorts[s]}
            </Link>
          ))}
        </div>
      </div>
      <ChipPicker
        open={picker === "category"}
        onClose={() => setPicker(null)}
        title={t.picker.allCategories}
        groups={CATEGORY_GROUPS}
        selected={params.category ? [params.category] : []}
        max={1}
        onChange={(next) => {
          setPicker(null);
          router.push(href(params, { category: next[0] }));
        }}
      />
      <ChipPicker
        open={picker === "tag"}
        onClose={() => setPicker(null)}
        title={t.picker.chooseTags}
        groups={TAG_GROUPS}
        selected={params.tag ? [params.tag] : []}
        max={1}
        onChange={(next) => {
          setPicker(null);
          router.push(href(params, { tag: next[0] }));
        }}
      />
    </div>
  );
}
