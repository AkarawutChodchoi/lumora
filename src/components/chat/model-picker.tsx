"use client";

import { useState } from "react";
import { Check, ChevronDown, Coins, Sparkles, Star } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/i18n/client";

export interface ModelOption {
  id: string;
  label: string;
  blurb: string;
  cost: number;
  quality: number;
}

/** List of models with price and quality. Saving goes through the server, which validates the choice. */
export function ModelList({ models, value, onChange }: { models: ModelOption[]; value: string; onChange: (id: string) => void }) {
  const t = useT();
  const toast = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  async function pick(m: ModelOption) {
    if (m.id === value || saving) return;
    setSaving(m.id);
    try {
      await api("/api/users/me", { method: "PATCH", body: { chatModel: m.id } });
      onChange(m.id);
      toast.success(t.chat.modelSaved(m.label));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <ul className="flex flex-col gap-2" role="radiogroup" aria-label={t.chat.model}>
      {models.map((m) => {
        const selected = m.id === value;
        return (
          <li key={m.id}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => pick(m)}
              disabled={saving !== null}
              className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors disabled:opacity-60 ${selected ? "border-accent bg-accent-soft" : "border-line bg-surface-2 hover:border-line-strong"}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{m.label}</span>
                <span className="mt-0.5 flex text-warn" aria-label={`${m.quality}/5`}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} className={`size-3 ${i < m.quality ? "fill-current" : "opacity-25"}`} aria-hidden="true" />
                  ))}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{t.chat.models[m.blurb] ?? ""}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-3 px-2.5 py-1 text-xs font-semibold">
                <Coins className="size-3.5 text-warn" /> {t.chat.perReply(m.cost)}
              </span>
              {selected && <Check className="size-4 shrink-0 text-accent" aria-hidden="true" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Compact chip in the chat composer that opens the model list. */
export function ModelPicker({ models, value, onChange }: { models: ModelOption[]; value: string; onChange: (id: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const current = models.find((m) => m.id === value) ?? models[0];
  if (!current) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted hover:border-line-strong hover:text-fg"
        aria-label={`${t.chat.pickModel}: ${current.label}`}
        aria-haspopup="dialog"
      >
        <Sparkles className="size-3.5 shrink-0 text-accent" />
        <span className="truncate">{current.label}</span>
        <span className="shrink-0 text-faint">· {current.cost}</span>
        <Coins className="size-3 shrink-0 text-warn" />
        <ChevronDown className="size-3.5 shrink-0" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t.chat.pickModel}>
        <p className="mb-4 text-sm text-muted">{t.chat.pickModelSub}</p>
        <ModelList
          models={models}
          value={current.id}
          onChange={(id) => {
            onChange(id);
            setOpen(false);
          }}
        />
      </Modal>
    </>
  );
}
