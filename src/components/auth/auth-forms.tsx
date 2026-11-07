"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { authClient, authErrorKey } from "@/lib/authClient";
import { useT } from "@/i18n/client";

function safeNext(raw: string | null) {
  // Only allow same-site relative paths to avoid open redirects.
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/discover";
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-[10px] border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger-soft" role="alert">
      {message}
    </p>
  );
}

const PASSWORD_OK = (p: string) => p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"password" | "2fa">("password");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(params.get("suspended") ? t.auth.suspended : params.get("reset") ? null : null);
  const done = () => {
    router.replace(safeNext(params.get("next")));
    router.refresh();
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.email({ email: String(f.get("email") ?? "").trim().toLowerCase(), password: String(f.get("password") ?? ""), rememberMe: f.get("remember") === "on" });
    if (res.error) {
      setError(t.auth.err[authErrorKey(res.error)]);
      setBusy(false);
      return;
    }
    if (res.data && "twoFactorRedirect" in res.data && res.data.twoFactorRedirect) {
      setStep("2fa");
      setBusy(false);
      return;
    }
    done();
  }

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = code.replace(/\s/g, "");
    setBusy(true);
    setError(null);
    // 6 digits = authenticator app, anything else = a backup code
    const res = /^\d{6}$/.test(c) ? await authClient.twoFactor.verifyTotp({ code: c }) : await authClient.twoFactor.verifyBackupCode({ code: c });
    if (res.error) {
      setError(t.auth.err[authErrorKey(res.error)] ?? t.auth.err.code);
      setBusy(false);
      return;
    }
    done();
  }

  if (step === "2fa") {
    return (
      <form onSubmit={verify} className="space-y-4" noValidate>
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
            <ShieldCheck className="size-6 text-accent-ink" aria-hidden="true" /> {t.auth.twoFaTitle}
          </h1>
          <p className="mt-1 text-sm text-muted">{t.auth.twoFaSub}</p>
        </div>
        <FormError message={error} />
        <TextField label={t.auth.twoFaCode} name="code" inputMode="text" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />
        <Button type="submit" className="w-full" loading={busy} disabled={code.replace(/\s/g, "").length < 6}>
          {t.auth.verify}
        </Button>
        <button
          type="button"
          className="w-full cursor-pointer text-center text-sm text-muted hover:text-ink"
          onClick={() => {
            setStep("password");
            setCode("");
            setError(null);
          }}
        >
          {t.auth.useOtherAccount}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <h1 className="font-display text-2xl font-bold">{t.auth.welcomeBack}</h1>
        <p className="mt-1 text-sm text-muted">{t.auth.signInSub}</p>
      </div>
      {params.get("reset") && (
        <p className="rounded-[10px] border border-free/30 bg-free-bg px-3 py-2 text-sm text-free" role="status">
          {t.auth.passwordUpdated}
        </p>
      )}
      <FormError message={error} />
      <TextField label={t.auth.email} name="email" type="email" autoComplete="email" required />
      <TextField label={t.auth.password} name="password" type="password" autoComplete="current-password" required />
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-sub">
          <input type="checkbox" name="remember" defaultChecked className="size-4" /> {t.auth.remember}
        </label>
        <Link href="/forgot-password" className="text-xs text-muted hover:text-ink">
          {t.auth.forgot}
        </Link>
      </div>
      <Button type="submit" className="w-full" loading={busy}>
        {t.auth.signIn}
      </Button>
      <p className="text-center text-sm text-muted">
        {t.auth.newHere}{" "}
        <Link href={`/register${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`} className="font-semibold text-accent-ink hover:underline">
          {t.auth.createAccountLink}
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("displayName") ?? "").trim();
    const email = String(f.get("email") ?? "").trim().toLowerCase();
    const password = String(f.get("password") ?? "");
    const bad: Record<string, string> = {};
    if (name.length < 2 || name.length > 40) bad.displayName = t.auth.err.name;
    if (!PASSWORD_OK(password)) bad.password = t.auth.err.weak;
    if (f.get("age") !== "on") bad.ageConfirmed = t.auth.err.age;
    setFields(bad);
    if (Object.keys(bad).length) return;
    setBusy(true);
    setError(null);
    const res = await authClient.signUp.email({ name, email, password });
    if (res.error) {
      setError(t.auth.err[authErrorKey(res.error)]);
      setBusy(false);
      return;
    }
    router.replace(safeNext(params.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <h1 className="font-display text-2xl font-bold">{t.auth.createTitle}</h1>
        <p className="mt-1 text-sm text-muted">{t.auth.createSub}</p>
      </div>
      <FormError message={error} />
      <TextField label={t.auth.displayName} name="displayName" autoComplete="nickname" maxLength={40} required error={fields.displayName} />
      <TextField label={t.auth.email} name="email" type="email" autoComplete="email" required error={fields.email} />
      <TextField label={t.auth.password} name="password" type="password" autoComplete="new-password" required hint={t.auth.passwordHint} error={fields.password} />
      <label className="flex items-start gap-2.5 text-sm text-sub">
        <input type="checkbox" name="age" className="mt-0.5 size-4" required />
        <span>{t.auth.ageCheck}</span>
      </label>
      {fields.ageConfirmed && <p className="text-xs text-danger">{fields.ageConfirmed}</p>}
      <Button type="submit" className="w-full" loading={busy}>
        {t.auth.createAccount}
      </Button>
      <p className="text-center text-sm text-muted">
        {t.auth.haveAccount}{" "}
        <Link href="/login" className="font-semibold text-accent-ink hover:underline">
          {t.auth.signIn}
        </Link>
      </p>
    </form>
  );
}

export function ForgotForm({ emailEnabled }: { emailEnabled: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim().toLowerCase();
    const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setBusy(false);
    // Same answer whether or not the account exists (no account enumeration).
    if (res.error && res.error.status === 429) return setError(t.auth.err.rate);
    setDone(emailEnabled ? t.auth.resetSent : t.auth.resetUnavailable);
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <h1 className="font-display text-2xl font-bold">{t.auth.resetTitle}</h1>
        <p className="mt-1 text-sm text-muted">{t.auth.resetSub}</p>
      </div>
      <FormError message={error} />
      {done ? (
        <p className="rounded-[10px] border border-free/30 bg-free-bg px-3 py-2 text-sm text-free" role="status">
          {done}
        </p>
      ) : (
        <>
          <TextField label={t.auth.email} name="email" type="email" autoComplete="email" required />
          <Button type="submit" className="w-full" loading={busy}>
            {t.auth.sendLink}
          </Button>
        </>
      )}
      <p className="text-center text-sm">
        <Link href="/login" className="text-muted hover:text-ink">
          {t.auth.backToSignIn}
        </Link>
      </p>
    </form>
  );
}

export function ResetForm() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? t.auth.err.token : null);
  const token = params.get("token") ?? "";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pw = String(f.get("password") ?? "");
    if (pw !== f.get("confirm")) return setError(t.auth.mismatch);
    if (!PASSWORD_OK(pw)) return setError(t.auth.err.weak);
    setBusy(true);
    setError(null);
    const res = await authClient.resetPassword({ newPassword: pw, token });
    if (res.error) {
      setError(t.auth.err[authErrorKey(res.error)]);
      setBusy(false);
      return;
    }
    router.replace("/login?reset=1");
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h1 className="font-display text-2xl font-bold">{t.auth.newPasswordTitle}</h1>
      <FormError message={token ? error : t.auth.missingToken} />
      <TextField label={t.auth.newPassword} name="password" type="password" autoComplete="new-password" required hint={t.auth.passwordHint} />
      <TextField label={t.auth.confirmPassword} name="confirm" type="password" autoComplete="new-password" required />
      <Button type="submit" className="w-full" loading={busy} disabled={!token}>
        {t.auth.updatePassword}
      </Button>
    </form>
  );
}
