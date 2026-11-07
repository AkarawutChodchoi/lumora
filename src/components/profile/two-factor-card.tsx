"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import QRCode from "qrcode";
import { ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/authClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";

type Step = { kind: "idle" } | { kind: "scan"; qr: string; secret: string; backup: string[] } | { kind: "disable" };

const input = "h-11 w-full rounded-[10px] border border-line2 bg-field px-3.5 text-[15px] text-ink outline-none placeholder:text-dim focus:border-line3";

/** Turn TOTP two-step sign-in on or off (same flow as Alinmanga). */
export function TwoFactorCard({ enabled, needed }: { enabled: boolean; needed: boolean }) {
  const t = useT();
  const T = t.profile.twoFa;
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const start = async () => {
    setBusy(true);
    setErr("");
    const r = await authClient.twoFactor.enable({ password: pw });
    setBusy(false);
    if (r.error || !r.data || !("totpURI" in r.data)) return setErr(r.error?.code === "INVALID_PASSWORD" ? T.badPassword : T.failed);
    const uri = r.data.totpURI;
    setStep({ kind: "scan", qr: await QRCode.toDataURL(uri, { margin: 1, width: 200 }), secret: new URL(uri).searchParams.get("secret") ?? "", backup: r.data.backupCodes });
    setPw("");
  };

  const verify = async () => {
    setBusy(true);
    setErr("");
    const r = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    setBusy(false);
    if (r.error) return setErr(T.badCode);
    setStep({ kind: "idle" });
    setCode("");
    toast.success(T.enabled);
    router.refresh();
  };

  const disable = async () => {
    setBusy(true);
    setErr("");
    const r = await authClient.twoFactor.disable({ password: pw });
    setBusy(false);
    if (r.error) return setErr(T.badPassword);
    setStep({ kind: "idle" });
    setPw("");
    toast.success(T.disabled);
    router.refresh();
  };

  return (
    <Card className="p-5 sm:p-6">
      <section id="security" className="flex scroll-mt-24 flex-col gap-4">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <ShieldCheck size={20} className={enabled ? "text-free" : "text-muted"} aria-hidden="true" /> {T.title}
        </h2>
        {needed && !enabled && <p className="rounded-[10px] border border-accent-line bg-accent-soft px-3 py-2 text-sm text-accent-ink">{T.needed}</p>}
        <p className="text-sm text-sub">{enabled ? T.on : T.off}</p>

        {step.kind === "idle" && !enabled && (
          <div className="flex flex-col gap-2 md:flex-row">
            <input aria-label={t.profile.currentPassword} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t.profile.currentPassword} className={input} />
            <Button disabled={busy || pw.length < 8} onClick={start} className="shrink-0">
              {T.enable}
            </Button>
          </div>
        )}

        {step.kind === "scan" && (
          <div className="flex flex-col gap-4 md:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
            <img src={step.qr} alt="QR" width={200} height={200} className="self-start rounded-lg bg-white p-2" />
            <div className="flex flex-1 flex-col gap-3 text-sm">
              <p>
                {T.scan} <code className="break-all rounded bg-field px-1.5 py-0.5">{step.secret}</code>
              </p>
              <div>
                <p className="mb-1 font-semibold">{T.backup}</p>
                <div className="grid grid-cols-2 gap-1 font-mono text-xs text-sub md:grid-cols-5">
                  {step.backup.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2 md:flex-row">
                <input aria-label={T.code} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder={T.code} className={input} />
                <Button disabled={busy || code.replace(/\s/g, "").length !== 6} onClick={verify} className="shrink-0">
                  {T.verify}
                </Button>
              </div>
            </div>
          </div>
        )}

        {enabled && step.kind === "idle" && (
          <Button variant="secondary" onClick={() => setStep({ kind: "disable" })} className="w-fit">
            {T.disable}
          </Button>
        )}
        {step.kind === "disable" && (
          <div className="flex flex-col gap-2 md:flex-row">
            <input aria-label={t.profile.currentPassword} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t.profile.currentPassword} className={input} />
            <Button variant="danger" disabled={busy || pw.length < 8} onClick={disable} className="shrink-0">
              {T.confirmOff}
            </Button>
            <Button variant="ghost" onClick={() => setStep({ kind: "idle" })} className="shrink-0">
              {t.common.cancel}
            </Button>
          </div>
        )}
        {err && (
          <p role="alert" className="text-[13px] text-danger">
            {err}
          </p>
        )}
      </section>
    </Card>
  );
}
