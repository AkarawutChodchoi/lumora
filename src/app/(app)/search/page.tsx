import Link from "next/link";
import { SearchX } from "lucide-react";
import { CharacterGrid } from "@/components/characters/character-card";
import { SearchFilters } from "@/components/discover/search-filters";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { currentUser } from "@/server/auth/current";
import { searchCharacters, searchSchema } from "@/server/services/characters";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("search");

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = searchSchema.safeParse(flat);
  const params = parsed.success ? parsed.data : searchSchema.parse({});
  const { items, hasMore } = await searchCharacters(params, await currentUser());
  const t = await getT();
  const qs = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    const merged = { q: params.q, category: params.category, tag: params.tag, sort: params.sort, page: params.page, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") next.set(k, String(v));
    return `/search?${next.toString()}`;
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title={t.search.title} description={t.search.subtitle} />
      <form action="/search" className="mb-5 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">{t.search.label}</label>
        <input
          id="q"
          name="q"
          defaultValue={params.q}
          placeholder={t.search.placeholder}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-4 placeholder:text-faint focus:border-accent focus:outline-none"
        />
        {params.category && <input type="hidden" name="category" value={params.category} />}
        {params.tag && <input type="hidden" name="tag" value={params.tag} />}
        <input type="hidden" name="sort" value={params.sort} />
        <button className="h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-strong">{t.common.search}</button>
      </form>

      <SearchFilters params={{ q: params.q, category: params.category, tag: params.tag, sort: params.sort }} />

      {items.length ? (
        <>
          <CharacterGrid items={items} />
          <div className="mt-8 flex justify-center gap-3">
            {params.page > 1 && <Link className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-surface-2" href={qs({ page: params.page - 1 })}>{t.common.previous}</Link>}
            {hasMore && <Link className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-surface-2" href={qs({ page: params.page + 1 })}>{t.common.next}</Link>}
          </div>
        </>
      ) : (
        <EmptyState icon={<SearchX className="size-6" />} title={t.search.emptyTitle} description={t.search.emptyBody} />
      )}
    </div>
  );
}
