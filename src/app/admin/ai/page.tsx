import { Card, PageHeader } from "@/components/ui/misc";
import { SettingsForms } from "@/components/admin/admin-actions";
import { pageStaff } from "@/server/auth/current";
import { AI_PROVIDER_LABEL, activeAiProvider } from "@/server/config";
import { getAiSettings, getFeatureFlags } from "@/server/services/settings";
import { PROMPT_VERSION } from "@/server/ai/prompt";
import { CHAT_MODELS, availableModels, defaultModel } from "@/server/ai/models";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("adminAi");

export default async function AdminAi() {
  await pageStaff("ai.configure");
  const [ai, flags, t] = await Promise.all([getAiSettings(), getFeatureFlags(), getT()]);
  const T = t.admin.ai;
  const provider = activeAiProvider();
  return (
    <div className="space-y-6">
      <PageHeader title={t.titles.adminAi} description={T.subtitle} />
      <Card className="space-y-1 p-5 text-sm">
        <p><span className="text-muted">{T.active}</span> {provider === "dev" ? T.devProvider : AI_PROVIDER_LABEL[provider]}</p>
        <p><span className="text-muted">{T.apiKey}</span> {provider === "dev" ? T.keyMissing : T.keySet}</p>
        <p><span className="text-muted">{T.policy}</span> <span className="font-mono">{PROMPT_VERSION}</span></p>
        <p className="text-xs text-faint">{T.note}</p>
      </Card>
      <Card className="p-5">
        <h2 className="mb-1 font-semibold">{T.models}</h2>
        <p className="mb-3 text-xs text-faint">{T.modelsNote}</p>
        <ul className="divide-y divide-line text-sm">
          {CHAT_MODELS.map((m) => {
            const on = availableModels().some((a) => a.id === m.id);
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{m.label}</span> <span className="font-mono text-xs text-faint">{m.id}</span>
                  {defaultModel()?.id === m.id && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">{T.default}</span>}
                </span>
                <span className={`shrink-0 text-xs ${on ? "text-ok" : "text-faint"}`}>
                  {t.common.coins(String(m.cost))} · {on ? T.on : m.paidOnly ? T.needsPaid : T.needsKey}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      <SettingsForms ai={ai} flags={flags} />
    </div>
  );
}
