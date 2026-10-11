import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui/misc";
import { ReasonAction } from "@/components/admin/admin-actions";
import { pageStaff } from "@/server/auth/current";
import { searchAllCharacters } from "@/server/services/admin";
import { PUBLICATION_STATUSES } from "@/server/domain/enums";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("adminCharacters");

export default async function AdminCharacters({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await pageStaff("characters.moderate");
  const t = await getT();
  const T = t.admin.characters;
  const sp = await searchParams;
  const items = await searchAllCharacters(sp.q?.slice(0, 100) || undefined, sp.status?.slice(0, 30) || undefined);
  return (
    <div>
      <PageHeader title={t.titles.adminCharacters} description={T.subtitle} />
      <form className="mb-5 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder={T.placeholder} aria-label={t.common.search} className="h-10 min-w-48 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm" />
        <select name="status" defaultValue={sp.status ?? ""} aria-label={t.admin.users.status} className="h-10 rounded-xl border border-line bg-surface-2 px-3 text-sm">
          <option value="">{t.admin.users.anyStatus}</option>
          {PUBLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>{t.enums.publication[s]}</option>
          ))}
        </select>
        <button className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white">{t.common.filter}</button>
      </form>
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4">
            <div className="min-w-0 flex-1">
              <Link href={`/admin/characters/${c.id}`} className="font-semibold text-accent hover:underline">{c.name}</Link>
              <span className="ml-2 text-xs text-faint">v{c.currentVersion} · {t.common.by(c.owner.displayName)} · {T.chatsN(c.chatCount)}</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge>{t.enums.visibility[c.visibility]}</Badge>
                <Badge tone={c.publicationStatus === "published" ? "ok" : c.publicationStatus === "draft" ? "neutral" : "danger"}>{t.enums.publication[c.publicationStatus]}</Badge>
                <Badge tone={c.contentRating === "mature" ? "danger" : "neutral"}>{t.enums.rating[c.contentRating]}</Badge>
                {c.featured && <Badge tone="accent">{T.featured}</Badge>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(c.publicationStatus === "hidden" || c.publicationStatus === "suspended") && <ReasonAction label={T.restore} endpoint={`/api/admin/characters/${c.id}`} body={{ action: "restore" }} />}
              {c.publicationStatus !== "hidden" && <ReasonAction label={T.hide} endpoint={`/api/admin/characters/${c.id}`} body={{ action: "hide" }} />}
              {c.publicationStatus !== "suspended" && <ReasonAction label={T.suspend} variant="danger" endpoint={`/api/admin/characters/${c.id}`} body={{ action: "suspend" }} />}
              {c.publicationStatus === "published" && c.visibility === "public" && (
                <ReasonAction label={c.featured ? T.unfeature : T.feature} endpoint={`/api/admin/characters/${c.id}`} body={{ action: c.featured ? "unfeature" : "feature" }} />
              )}
            </div>
          </li>
        ))}
        {items.length === 0 && <p className="py-8 text-center text-sm text-faint">{T.none}</p>}
      </ul>
    </div>
  );
}
