"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Ban, Flag, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { TextArea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";

interface Report {
  id: string;
  targetType: string;
  category: string;
  status: string;
  createdAt: string;
}
interface Enforcement {
  id: string;
  action: string;
  reason: string;
  createdAt: string;
  appeals: { id: string; status: string; decisionNote: string | null }[];
}

const STATUS_TONE: Record<string, "neutral" | "accent" | "ok" | "warn" | "danger"> = { open: "warn", reviewing: "accent", actioned: "ok", dismissed: "neutral", accepted: "ok", rejected: "danger" };

function Block({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold">
        <span className="text-accent">{icon}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

export function SafetyCenter({ blocked: initialBlocked, reports, enforcements }: { blocked: { id: string; name: string }[]; reports: Report[]; enforcements: Enforcement[] }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [blocked, setBlocked] = useState(initialBlocked);
  const [appealFor, setAppealFor] = useState<Enforcement | null>(null);

  return (
    <div className="space-y-6">
      <Block icon={<ShieldCheck className="size-5" />} title={t.safety.rules}>
        <ul className="space-y-2 text-sm text-muted">
          {t.safety.ruleList.map((r) => (
            <li key={r} className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
              {r}
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
          {t.safety.crisis1} <strong className="text-fg">1323</strong> {t.safety.crisis2}
        </p>
      </Block>

      <Block icon={<Ban className="size-5" />} title={t.safety.blocked}>
        {blocked.length === 0 ? (
          <p className="text-sm text-faint">{t.safety.noBlocked}</p>
        ) : (
          <ul className="divide-y divide-line">
            {blocked.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2.5 text-sm">
                {c.name}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await api(`/api/characters/${c.id}/block`, { method: "DELETE" });
                      setBlocked((b) => b.filter((x) => x.id !== c.id));
                      toast.success(t.safety.unblocked(c.name));
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                >
                  {t.character.unblock}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block icon={<Flag className="size-5" />} title={t.safety.reports}>
        {reports.length === 0 ? (
          <p className="text-sm text-faint">{t.safety.noReports}</p>
        ) : (
          <ul className="divide-y divide-line">
            {reports.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>
                  <span>{t.enums.targetType[r.targetType]}</span> · {t.enums.reportCategory[r.category] ?? r.category}
                  <span className="block text-xs text-faint">{new Date(r.createdAt).toLocaleDateString(INTL_LOCALE[locale])}</span>
                </span>
                <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{t.enums.reportStatus[r.status] ?? r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block icon={<Scale className="size-5" />} title={t.safety.standing}>
        {enforcements.length === 0 ? (
          <p className="text-sm text-ok">{t.safety.good}</p>
        ) : (
          <ul className="space-y-3">
            {enforcements.map((e) => {
              const appeal = e.appeals[0];
              return (
                <li key={e.id} className="rounded-xl border border-line p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone={e.action === "reinstatement" ? "ok" : e.action === "warning" ? "warn" : "danger"}>{t.enums.enforcement[e.action] ?? e.action}</Badge>
                    <span className="text-xs text-faint">{new Date(e.createdAt).toLocaleDateString(INTL_LOCALE[locale])}</span>
                  </div>
                  <p className="mt-2 text-muted">{e.reason}</p>
                  {appeal ? (
                    <p className="mt-2 text-xs">
                      {t.safety.appeal}: <Badge tone={STATUS_TONE[appeal.status] ?? "neutral"}>{t.enums.appealStatus[appeal.status] ?? appeal.status}</Badge> {appeal.decisionNote && <span className="text-faint">— {appeal.decisionNote}</span>}
                    </p>
                  ) : (
                    e.action !== "reinstatement" && (
                      <Button size="sm" variant="secondary" className="mt-3" onClick={() => setAppealFor(e)}>
                        {t.safety.appealThis}
                      </Button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      {appealFor && (
        <AppealDialog
          enforcement={appealFor}
          onClose={() => setAppealFor(null)}
          onDone={() => {
            setAppealFor(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AppealDialog({ enforcement, onClose, onDone }: { enforcement: Enforcement; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={t.safety.appealTitle}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/api/appeals", { method: "POST", body: { enforcementId: enforcement.id, message } });
            toast.success(t.safety.appealSent);
            onDone();
          } catch (err) {
            toast.error(errorMessage(err));
            setBusy(false);
          }
        }}
      >
        <TextArea label={t.safety.appealLabel} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} counter={{ value: message.length, max: 2000 }} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" loading={busy} disabled={message.trim().length < 10}>
            {t.safety.submitAppeal}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
