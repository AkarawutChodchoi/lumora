import { PageHeader } from "@/components/ui/misc";
import { SafetyCenter } from "@/components/safety/safety-center";
import { pageUser } from "@/server/auth/current";
import { listBlocked } from "@/server/services/characters";
import { listMyEnforcements, listMyReports } from "@/server/services/reports";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("safety");

export default async function SafetyPage() {
  const user = await pageUser("/safety");
  const [blocked, reports, enforcements, t] = await Promise.all([listBlocked(user), listMyReports(user), listMyEnforcements(user), getT()]);
  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader title={t.titles.safety} description={t.safety.subtitle} />
      <SafetyCenter blocked={blocked} reports={JSON.parse(JSON.stringify(reports))} enforcements={JSON.parse(JSON.stringify(enforcements))} />
    </div>
  );
}
