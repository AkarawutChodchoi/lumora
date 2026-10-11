"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useT } from "@/i18n/client";

function safeNext(raw: string | null) {
  // Only allow same-site relative paths to avoid open redirects.
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/discover";
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
      {message}
    </p>
  );
}

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("suspended") ? t.auth.suspended : null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { email: f.get("email"), password: f.get("password") } });
      router.replace(safeNext(params.get("next")));
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-xl font-bold">{t.auth.welcomeBack}</h1>
        <p className="mt-1 text-sm text-muted">{t.auth.signInSub}</p>
      </div>
      <FormError message={error} />
      <TextField label={t.auth.email} name="email" type="email" autoComplete="email" required />
      <TextField label={t.auth.password} name="password" type="password" autoComplete="current-password" required />
      <div className="text-right">
        <Link href="/forgot-password" className="text-xs text-muted hover:text-fg">
          {t.auth.forgot}
        </Link>
      </div>
      <Button type="submit" className="w-full" loading={busy}>
        {t.auth.signIn}
      </Button>
      <p className="text-center text-sm text-muted">
        {t.auth.newHere}{" "}
        <Link href="/register" className="font-semibold text-accent hover:underline">
          {t.auth.createAccountLink}
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: { displayName: f.get("displayName"), email: f.get("email"), password: f.get("password"), ageConfirmed: f.get("age") === "on" ? true : false },
      });
      router.replace("/discover");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.details) setFields(err.fieldErrors());
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-xl font-bold">{t.auth.createTitle}</h1>
        <p className="mt-1 text-sm text-muted">{t.auth.createSub}</p>
      </div>
      <FormError message={error} />
      <TextField label={t.auth.displayName} name="displayName" autoComplete="nickname" maxLength={40} required error={fields.displayName} />
      <TextField label={t.auth.email} name="email" type="email" autoComplete="email" required error={fields.email} />
      <TextField label={t.auth.password} name="password" type="password" autoComplete="new-password" required hint={t.auth.passwordHint} error={fields.password} />
      <label className="flex items-start gap-2.5 text-sm text-muted">
        <input type="checkbox" name="age" className="mt-0.5 size-4 accent-[var(--color-accent)]" required />
        <span>{t.auth.ageCheck}</span>
      </label>
      {fields.ageConfirmed && <p className="text-xs text-danger">{fields.ageConfirmed}</p>}
      <Button type="submit" className="w-full" loading={busy}>
        {t.auth.createAccount}
      </Button>
      <p className="text-center text-sm text-muted">
        {t.auth.haveAccount}{" "}
        <Link href="/login" className="font-semibold text-accent hover:underline">
          {t.auth.signIn}
        </Link>
      </p>
    </form>
  );
}

export function ForgotForm() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/forgot-password", { method: "POST", body: { email: new FormData(e.currentTarget).get("email") } });
      setDone(t.auth.resetSent);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-xl font-bold">{t.auth.resetTitle}</h1>
        <p className="mt-1 text-sm text-muted">{t.auth.resetSub}</p>
      </div>
      <FormError message={error} />
      {done ? (
        <p className="rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok" role="status">
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
        <Link href="/login" className="text-muted hover:text-fg">
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
  const [error, setError] = useState<string | null>(null);
  const token = params.get("token") ?? "";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) return setError(t.auth.mismatch);
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/reset-password", { method: "POST", body: { token, newPassword: f.get("password") } });
      router.replace("/login");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h1 className="text-xl font-bold">{t.auth.newPasswordTitle}</h1>
      <FormError message={token ? error : t.auth.missingToken} />
      <TextField label={t.auth.newPassword} name="password" type="password" autoComplete="new-password" required hint={t.auth.passwordHint} />
      <TextField label={t.auth.confirmPassword} name="confirm" type="password" autoComplete="new-password" required />
      <Button type="submit" className="w-full" loading={busy} disabled={!token}>
        {t.auth.updatePassword}
      </Button>
    </form>
  );
}
