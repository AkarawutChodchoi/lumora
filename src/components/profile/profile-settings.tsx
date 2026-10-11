"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LogOut, Heart, Coins, ShieldCheck, ChevronRight, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextArea, TextField, Toggle } from "@/components/ui/field";
import { Avatar, Card } from "@/components/ui/misc";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useT } from "@/i18n/client";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { ImageUpload } from "@/components/ui/image-upload";
import { ModelList, type ModelOption } from "@/components/chat/model-picker";
import { applyDisplayPref, TEXT_SIZES, THEMES } from "@/lib/display-prefs";

interface Me {
  email: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  status: string;
  ageConfirmed18: boolean;
  matureContentEnabled: boolean;
  memoryEnabled: boolean;
  responseStyle: string;
}

/** Accessible segmented control (radio group). */
function Segmented({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid grid-flow-col auto-cols-fr gap-1 rounded-2xl border border-line bg-surface-2 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-xl px-2 py-2 text-sm font-medium transition-colors ${value === o.value ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </Card>
  );
}

export function ProfileSettings({
  me: initial,
  isStaff,
  models,
  model: initialModel,
  display,
}: {
  me: Me;
  isStaff: boolean;
  models: ModelOption[];
  model: string;
  display: { theme: string; text: string };
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [me, setMe] = useState(initial);
  const [profile, setProfile] = useState({ displayName: initial.displayName, bio: initial.bio, avatarUrl: initial.avatarUrl ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<null | "password" | "wipe" | "delete" | "logout">(null);
  const [model, setModel] = useState(initialModel);
  const [theme, setTheme] = useState(display.theme);
  const [textSize, setTextSize] = useState(display.text);

  async function patch(data: Partial<Me>) {
    try {
      const r = await api<{ user: Me }>("/api/users/me", { method: "PATCH", body: data });
      setMe(r.user);
      toast.success(t.profile.settingsSaved);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const r = await api<{ user: Me }>("/api/users/me", { method: "PATCH", body: { ...profile, avatarUrl: profile.avatarUrl || null } });
      setMe(r.user);
      toast.success(t.profile.profileUpdated);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Avatar name={me.displayName} src={me.avatarUrl} className="size-16 text-2xl" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold">{me.displayName}</h1>
          <p className="truncate text-sm text-muted">{me.email}</p>
        </div>
      </div>

      {me.status === "deletion_requested" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          {t.profile.scheduled}
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                await api("/api/users/me/cancel-deletion", { method: "POST" });
                toast.success(t.profile.deletionCancelled);
                router.refresh();
                setMe({ ...me, status: "active" });
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            {t.profile.cancelDeletion}
          </Button>
        </div>
      )}

      <nav className="grid gap-2 md:hidden" aria-label={t.profile.account}>
        {[
          { href: "/library", label: t.profile.linkLibrary, icon: Heart },
          { href: "/coins", label: t.profile.linkCoins, icon: Coins },
          { href: "/safety", label: t.profile.linkSafety, icon: ShieldCheck },
          ...(isStaff ? [{ href: "/admin", label: t.profile.linkAdmin, icon: LayoutDashboard }] : []),
        ].map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-sm font-medium hover:bg-surface-2">
            <l.icon className="size-5 text-accent" /> {l.label} <ChevronRight className="ml-auto size-4 text-faint" />
          </Link>
        ))}
      </nav>

      <Section title={t.profile.profile}>
        <form onSubmit={saveProfile} className="space-y-4">
          <TextField label={t.auth.displayName} value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} maxLength={40} error={errors.displayName} />
          <TextArea label={t.profile.bio} value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} maxLength={300} counter={{ value: profile.bio.length, max: 300 }} error={errors.bio} />
          <ImageUpload label={t.profile.avatar} name={profile.displayName} shape="round" value={profile.avatarUrl} onChange={(url) => setProfile({ ...profile, avatarUrl: url })} error={errors.avatarUrl} />
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              {t.profile.saveProfile}
            </Button>
          </div>
        </form>
      </Section>

      <Section title={t.common.language} description={t.profile.languageSub}>
        <LanguageSwitcher />
      </Section>

      <Section title={t.profile.appearance} description={t.profile.appearanceSub}>
        <div className="space-y-4">
          <Segmented
            label={t.profile.theme}
            options={THEMES.map((v) => ({ value: v, label: t.profile.themes[v] }))}
            value={theme}
            onChange={(v) => {
              setTheme(v);
              applyDisplayPref("theme", v);
            }}
          />
          <Segmented
            label={t.profile.textSize}
            options={TEXT_SIZES.map((v) => ({ value: v, label: t.profile.textSizes[v] }))}
            value={textSize}
            onChange={(v) => {
              setTextSize(v);
              applyDisplayPref("text", v);
            }}
          />
        </div>
      </Section>

      <Section title={t.profile.chatContent}>
        <div className="mb-5 space-y-5">
          <div>
            <Segmented
              label={t.profile.replyStyle}
              options={(["concise", "balanced", "detailed"] as const).map((v) => ({ value: v, label: t.profile.styles[v] }))}
              value={me.responseStyle}
              onChange={(v) => patch({ responseStyle: v })}
            />
            <p className="mt-1.5 text-xs text-faint">{t.profile.replyStyleSub}</p>
          </div>
          {models.length > 1 && (
            <div>
              <p className="text-sm font-medium">{t.profile.defaultModel}</p>
              <p className="mb-2 text-xs text-faint">{t.profile.defaultModelSub}</p>
              <ModelList models={models} value={model} onChange={setModel} />
            </div>
          )}
        </div>
        <div className="divide-y divide-line">
          <Toggle label={t.profile.memoryToggle} description={t.profile.memoryToggleSub} checked={me.memoryEnabled} onChange={(v) => patch({ memoryEnabled: v })} />
          <Toggle label={t.profile.adultToggle} description={t.profile.adultToggleSub} checked={me.ageConfirmed18} onChange={(v) => patch({ ageConfirmed18: v })} />
          <Toggle
            label={t.profile.matureToggle}
            description={t.profile.matureToggleSub}
            checked={me.matureContentEnabled}
            disabled={!me.ageConfirmed18}
            onChange={(v) => patch({ matureContentEnabled: v })}
          />
        </div>
      </Section>

      <Section title={t.profile.security}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDialog("password")}>
            {t.profile.changePassword}
          </Button>
          <Button variant="secondary" onClick={() => setDialog("logout")}>
            <LogOut className="size-4" /> {t.profile.signOut}
          </Button>
        </div>
      </Section>

      <Section title={t.profile.privacy} description={t.profile.privacySub}>
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" onClick={() => setDialog("wipe")}>
            {t.profile.wipe}
          </Button>
          {me.status !== "deletion_requested" && (
            <Button variant="danger" onClick={() => setDialog("delete")}>
              {t.profile.deleteAccount}
            </Button>
          )}
        </div>
      </Section>

      {dialog === "password" && <PasswordDialog onClose={() => setDialog(null)} />}
      {dialog === "delete" && <DeleteAccountDialog onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === "wipe"}
        onClose={() => setDialog(null)}
        title={t.profile.wipeTitle}
        description={t.profile.wipeBody}
        confirmLabel={t.profile.wipeConfirm}
        danger
        onConfirm={async () => {
          try {
            const r = await api<{ deletedConversations: number; deletedMemories: number }>("/api/users/me/data", { method: "DELETE" });
            toast.success(t.profile.wiped(r.deletedConversations, r.deletedMemories));
            router.refresh();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={dialog === "logout"}
        onClose={() => setDialog(null)}
        title={t.profile.signOutTitle}
        description={t.profile.signOutBody}
        confirmLabel={t.profile.signOut}
        onConfirm={async () => {
          await api("/api/auth/logout", { method: "POST" }).catch(() => {});
          router.replace("/");
          router.refresh();
        }}
      />
    </div>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={t.profile.changePassword}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError(null);
          try {
            await api("/api/users/me/password", { method: "POST", body: { currentPassword: f.get("current"), newPassword: f.get("next") } });
            toast.success(t.profile.passwordChanged);
            onClose();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <TextField label={t.profile.currentPassword} name="current" type="password" autoComplete="current-password" />
        <TextField label={t.auth.newPassword} name="next" type="password" autoComplete="new-password" hint={t.auth.passwordHint} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" loading={busy}>
            {t.auth.updatePassword}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={t.profile.deleteTitle}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/api/users/me", { method: "DELETE", body: { password: new FormData(e.currentTarget).get("password") } });
            router.replace("/");
            router.refresh();
          } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted">
          {t.profile.deleteBody}
        </p>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <TextField label={t.profile.confirmWithPassword} name="password" type="password" autoComplete="current-password" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t.profile.keepAccount}
          </Button>
          <Button type="submit" variant="danger" loading={busy}>
            {t.profile.deleteAccount}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
