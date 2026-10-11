"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SelectField, TextArea, TextField, Toggle } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/i18n/client";

/** A privileged action that always asks for a reason (recorded in the audit log). */
export function ReasonAction({
  label,
  endpoint,
  body,
  reasonKey = "reason",
  variant = "secondary",
  title,
  minReason = 3,
}: {
  label: string;
  endpoint: string;
  body: Record<string, unknown>;
  reasonKey?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  title?: string;
  minReason?: number;
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title ?? label}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api(endpoint, { method: "POST", body: { ...body, [reasonKey]: reason } });
              toast.success(t.common.done);
              setOpen(false);
              setReason("");
              router.refresh();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <TextArea label={t.admin.actions.reason} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" variant={variant === "danger" ? "danger" : "primary"} loading={busy} disabled={reason.trim().length < minReason}>
              {t.common.confirm}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function EnforceForm({ userId }: { userId: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [action, setAction] = useState("warning");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!confirm(t.admin.actions.applyConfirm(t.enums.enforcement[action]))) return;
        setBusy(true);
        try {
          await api(`/api/admin/users/${userId}/enforce`, { method: "POST", body: { action, reason } });
          toast.success(t.admin.actions.applied);
          setReason("");
          router.refresh();
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <SelectField
        label={t.admin.actions.action}
        value={action}
        onChange={(e) => setAction(e.target.value)}
        options={[
          { value: "warning", label: t.admin.actions.warningOpt },
          { value: "restriction", label: t.admin.actions.restrictOpt },
          { value: "suspension", label: t.admin.actions.suspendOpt },
          { value: "reinstatement", label: t.admin.actions.reinstateOpt },
        ]}
      />
      <TextArea label={t.admin.actions.reasonShort} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
      <Button type="submit" loading={busy} disabled={reason.trim().length < 5}>
        {t.admin.actions.apply}
      </Button>
    </form>
  );
}

export function AdjustCreditsForm({ userId }: { userId: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = Number(delta);
        if (!Number.isInteger(n) || n === 0) return toast.error(t.admin.actions.wholeNumber);
        if (!confirm(t.admin.actions.adjustConfirm(n))) return;
        setBusy(true);
        try {
          await api("/api/admin/billing/adjust", { method: "POST", body: { userId, delta: n, reason, requestId: crypto.randomUUID() } });
          toast.success(t.admin.actions.posted);
          setDelta("");
          setReason("");
          router.refresh();
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField label={t.admin.actions.coinsDelta} type="number" step={1} value={delta} onChange={(e) => setDelta(e.target.value)} />
      <TextArea label={t.admin.actions.reasonShort} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      <Button type="submit" loading={busy} disabled={reason.trim().length < 5 || !delta}>
        {t.admin.actions.post}
      </Button>
    </form>
  );
}

export function EraseUserButton({ userId }: { userId: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  return (
    <Button
      variant="danger"
      size="sm"
      onClick={async () => {
        if (!confirm(t.admin.actions.eraseConfirm)) return;
        try {
          await api(`/api/admin/users/${userId}/erase`, { method: "POST" });
          toast.success(t.admin.actions.erased);
          router.replace("/admin/users");
        } catch (e) {
          toast.error(errorMessage(e));
        }
      }}
    >
      {t.admin.actions.erase}
    </Button>
  );
}

interface AiSettings {
  standardModel: string;
  premiumModel: string;
  maxOutputTokens: number;
  effort: string;
  contextTokenBudget: number;
  memoryTokenBudget: number;
  requestTimeoutMs: number;
  costPerMessage: number;
  premiumCostPerMessage: number;
  promptVersion: string;
}

export function SettingsForms({ ai: initialAi, flags: initialFlags }: { ai: AiSettings; flags: Record<string, boolean> }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [ai, setAi] = useState(initialAi);
  const [flags, setFlags] = useState(initialFlags);
  const [busy, setBusy] = useState(false);
  const num = (k: keyof AiSettings) => (e: { target: { value: string } }) => setAi({ ...ai, [k]: Number(e.target.value) });

  async function save(key: "ai" | "flags", value: unknown) {
    setBusy(true);
    try {
      await api("/api/admin/settings", { method: "PUT", body: { key, value } });
      toast.success(t.profile.settingsSaved);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-4 rounded-2xl border border-line bg-surface p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save("ai", ai);
        }}
      >
        <h2 className="font-semibold">{t.admin.actions.routing}</h2>
        <SelectField
          label={t.admin.actions.effort}
          value={ai.effort}
          onChange={(e) => setAi({ ...ai, effort: e.target.value })}
          options={["low", "medium", "high"].map((v) => ({ value: v, label: v }))}
          hint={t.admin.actions.effortHint}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t.admin.actions.maxOut} type="number" value={ai.maxOutputTokens} onChange={num("maxOutputTokens")} />
          <TextField label={t.admin.actions.ctxBudget} type="number" value={ai.contextTokenBudget} onChange={num("contextTokenBudget")} />
          <TextField label={t.admin.actions.memBudget} type="number" value={ai.memoryTokenBudget} onChange={num("memoryTokenBudget")} />
          <TextField label={t.admin.actions.timeout} type="number" value={ai.requestTimeoutMs} onChange={num("requestTimeoutMs")} />
        </div>
        <TextField label={t.admin.actions.promptLabel} value={ai.promptVersion} onChange={(e) => setAi({ ...ai, promptVersion: e.target.value })} />
        <Button type="submit" loading={busy}>
          {t.admin.actions.saveAi}
        </Button>
      </form>
      <form
        className="space-y-2 rounded-2xl border border-line bg-surface p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save("flags", flags);
        }}
      >
        <h2 className="font-semibold">{t.admin.actions.flags}</h2>
        <div className="divide-y divide-line">
          {Object.entries(flags).map(([k, v]) => (
            <Toggle key={k} label={t.admin.actions.flagNames[k] ?? k} checked={v} onChange={(nv) => setFlags({ ...flags, [k]: nv })} />
          ))}
        </div>
        <Button type="submit" loading={busy}>
          {t.admin.actions.saveFlags}
        </Button>
      </form>
    </div>
  );
}

/** One-tap coin top-up for the signed-in admin (goes through the ledger like any adjustment). */
export function SelfTopUp({ selfId }: { selfId: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      {[100, 1000, 10000].map((n) => (
        <Button
          key={n}
          size="sm"
          variant="secondary"
          loading={busy === n}
          onClick={async () => {
            setBusy(n);
            try {
              await api("/api/admin/billing/adjust", { method: "POST", body: { userId: selfId, delta: n, reason: "Admin self top-up", requestId: crypto.randomUUID() } });
              toast.success(t.coins.added(n));
              router.refresh();
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          +{n.toLocaleString()}
        </Button>
      ))}
    </div>
  );
}

/** Admin-only account controls: role, free Plus, sign-out everywhere, erase. */
export function AccountControls({ userId, email, role, isSelf, canRoles, canPremium, canErase }: { userId: string; email: string; role: string; isSelf: boolean; canRoles: boolean; canPremium: boolean; canErase: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [newRole, setNewRole] = useState(role);
  const [days, setDays] = useState("30");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const A = t.admin.account;

  async function call(key: string, path: string, body?: unknown, done?: string, after?: () => void) {
    setBusy(key);
    try {
      await api(`/api/admin/users/${userId}/${path}`, { method: "POST", body });
      toast.success(done ?? t.admin.actions.applied);
      if (after) after();
      else router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {canRoles && !isSelf && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1">
            <SelectField label={A.role} value={newRole} onChange={(e) => setNewRole(e.target.value)} options={["user", "moderator", "admin"].map((r) => ({ value: r, label: t.enums.role[r] }))} />
          </div>
          <Button loading={busy === "role"} disabled={newRole === role} onClick={() => call("role", "role", { role: newRole, reason: "Changed in admin dashboard" })}>
            {A.saveRole}
          </Button>
        </div>
      )}
      {canPremium && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32">
            <TextField label={A.plusDays} type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <Button loading={busy === "plus"} onClick={() => call("plus", "premium", { days: Math.max(1, Number(days) || 30), reason: "Granted in admin dashboard" }, A.plusGranted)}>
            {A.grantPlus}
          </Button>
          <Button variant="secondary" loading={busy === "plus0"} onClick={() => call("plus0", "premium", { days: 0, reason: "Ended in admin dashboard" }, A.plusEnded)}>
            {A.endPlus}
          </Button>
        </div>
      )}
      {!isSelf && (
        <Button variant="secondary" loading={busy === "out"} onClick={() => call("out", "signout", undefined, A.signedOut)}>
          {A.signOut}
        </Button>
      )}
      {canErase && !isSelf && role !== "admin" && (
        <div className="space-y-2 rounded-xl border border-danger/30 p-3">
          <p className="text-xs text-danger">{A.eraseWarn}</p>
          <TextField label={A.typeEmail(email)} value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="off" />
          <Button variant="danger" loading={busy === "erase"} disabled={confirmEmail.trim().toLowerCase() !== email} onClick={() => call("erase", "erase-now", { confirmEmail }, t.admin.actions.erased, () => router.replace("/admin/users"))}>
            {A.eraseNow}
          </Button>
        </div>
      )}
    </div>
  );
}
