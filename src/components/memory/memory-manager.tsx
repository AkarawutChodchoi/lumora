"use client";

import { useState } from "react";
import Link from "next/link";
import { Brain, Pencil, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/misc";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { SelectField, TextArea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";

interface Memory {
  id: string;
  type: string;
  content: string;
  source: string;
  importance: number;
  updatedAt: string;
  expiresAt: string | null;
}

export function MemoryManager({ characterId, initial, charLimit, memoryEnabled, userName }: { characterId: string; initial: Memory[]; charLimit: number; memoryEnabled: boolean; userName: string }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<Memory | "new" | null>(null);
  const [confirm, setConfirm] = useState<Memory | "all" | null>(null);
  const used = items.reduce((n, m) => n + m.content.length, 0);
  // Memories store the user as {{user}}; always show the user's own name instead.
  const show = (text: string) => text.split("{{user}}").join(userName);

  async function save(data: { type: string; content: string; importance: number }) {
    try {
      if (editing === "new") {
        const r = await api<{ memory: Memory }>(`/api/memories?characterId=${characterId}`, { method: "POST", body: data });
        setItems((i) => [r.memory, ...i.filter((x) => x.id !== r.memory.id)]);
      } else if (editing) {
        const r = await api<{ memory: Memory }>(`/api/memories/${editing.id}`, { method: "PATCH", body: data });
        setItems((i) => i.map((x) => (x.id === r.memory.id ? r.memory : x)));
      }
      toast.success(t.memory.saved);
      setEditing(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-4">
      {!memoryEnabled && (
        <p className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          {t.memory.offNote1}{" "}
          <Link href="/profile" className="underline">
            {t.memory.offLink}
          </Link>
          {t.memory.offNote2}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-48 flex-1">
          <p className="text-sm text-muted">{t.memory.usage(used.toLocaleString(), charLimit.toLocaleString())}</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={charLimit} aria-valuenow={used}>
            <div className={`h-full rounded-full ${used / charLimit > 0.9 ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.min(100, (used / charLimit) * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-faint">{t.memory.autoNote}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {t.memory.add}
          </Button>
          {items.length > 0 && (
            <Button size="sm" variant="danger" onClick={() => setConfirm("all")}>
              <Trash2 className="size-4" /> {t.memory.forgetAll}
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<Brain className="size-6" />} title={t.memory.emptyTitle} description={t.memory.emptyBody} />
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  <Badge tone="accent">{t.enums.memoryType[m.type] ?? m.type}</Badge>
                  <Badge>{t.enums.memorySource[m.source] ?? m.source}</Badge>
                  {m.expiresAt && <Badge>{t.memory.until(new Date(m.expiresAt).toLocaleDateString(INTL_LOCALE[locale]))}</Badge>}
                </div>
                <p className="text-sm">{show(m.content)}</p>
              </div>
              <button onClick={() => setEditing(m)} className="rounded-lg p-2 text-faint hover:bg-surface-2 hover:text-fg" aria-label={t.memory.edit}>
                <Pencil className="size-4" />
              </button>
              <button onClick={() => setConfirm(m)} className="rounded-lg p-2 text-faint hover:bg-danger/10 hover:text-danger" aria-label={t.memory.deleteOne}>
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && <MemoryDialog initial={editing === "new" ? null : { ...editing, content: show(editing.content) }} onClose={() => setEditing(null)} onSave={save} />}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "all" ? t.memory.forgetTitle : t.memory.deleteTitle}
        description={confirm === "all" ? t.memory.forgetBody : t.memory.deleteBody}
        confirmLabel={t.common.delete}
        danger
        onConfirm={async () => {
          try {
            if (confirm === "all") {
              await api(`/api/memories?characterId=${characterId}`, { method: "DELETE" });
              setItems([]);
            } else if (confirm) {
              await api(`/api/memories/${confirm.id}`, { method: "DELETE" });
              setItems((i) => i.filter((x) => x.id !== confirm.id));
            }
            toast.success(t.memory.deleted);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}

function MemoryDialog({ initial, onClose, onSave }: { initial: Memory | null; onClose: () => void; onSave: (d: { type: string; content: string; importance: number }) => Promise<void> }) {
  const t = useT();
  const [type, setType] = useState(initial?.type ?? "preference");
  const [content, setContent] = useState(initial?.content ?? "");
  const [importance, setImportance] = useState(String(initial?.importance ?? 3));
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={initial ? t.memory.edit : t.memory.addTitle}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onSave({ type, content, importance: Number(importance) });
          setBusy(false);
        }}
      >
        <SelectField label={t.memory.type} value={type} onChange={(e) => setType(e.target.value)} options={Object.entries(t.enums.memoryType).map(([value, label]) => ({ value, label }))} />
        <TextArea label={t.memory.what} value={content} onChange={(e) => setContent(e.target.value)} maxLength={500} counter={{ value: content.length, max: 500 }} hint={t.memory.noSecrets} />
        <SelectField
          label={t.memory.importance}
          value={importance}
          onChange={(e) => setImportance(e.target.value)}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: t.memory.importanceLevels[n - 1] }))}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" loading={busy} disabled={content.trim().length < 3}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
