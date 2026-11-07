import { getT } from "@/i18n/server";

export async function generateMetadata() {
  return { title: (await getT()).legal.privacyTitle };
}

export default async function Page() {
  const t = await getT();
  return (
    <article className="mx-auto max-w-2xl animate-fade-in">
      <h1 className="font-display text-[28px] font-bold">{t.legal.privacyTitle}</h1>
      <p className="mt-2 rounded-[10px] border border-warn/30 bg-warn-bg px-3 py-2 text-xs text-warn">{t.legal.draft}</p>
      <div className="mt-6 space-y-6">
        {t.legal.privacy.map((s) => (
          <section key={s.h}>
            <h2 className="font-display text-lg font-semibold">{s.h}</h2>
            <p className="mt-1.5 leading-relaxed text-sub">{s.p}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
