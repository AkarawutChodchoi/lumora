"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { SendHorizonal, Square, Coins } from "lucide-react";
import { useT } from "@/i18n/client";
import { shortNumber } from "@/lib/format";
import { ModelPicker, type ModelOption } from "./model-picker";

export function Composer({
  disabled,
  disabledReason,
  busy,
  canStop,
  models,
  modelId,
  onModelChange,
  balance,
  characterName,
  onSend,
  onStop,
}: {
  disabled: boolean;
  disabledReason?: string;
  busy: boolean;
  canStop: boolean;
  models: ModelOption[];
  modelId: string;
  onModelChange: (id: string) => void;
  balance: number;
  characterName: string;
  onSend: (content: string) => void;
  onStop: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function submit() {
    const content = value.trim();
    if (!content || busy || disabled) return;
    onSend(content);
    setValue("");
    requestAnimationFrame(resize);
  }

  return (
    <div className="mx-auto max-w-3xl px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 rounded-2xl border border-line bg-surface-2 p-2 focus-within:border-accent"
      >
        <label htmlFor="composer" className="sr-only">
          {t.chat.composerLabel(characterName)}
        </label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={value}
          maxLength={4000}
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value);
            resize();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? disabledReason : t.chat.placeholderShort}
          className="max-h-[200px] min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            disabled={!canStop}
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-3 text-fg hover:bg-line-strong disabled:opacity-50"
            aria-label={t.chat.stop}
            title={t.chat.stop}
          >
            <Square className="size-4 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim() || disabled}
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-white hover:bg-accent-strong disabled:opacity-40"
            aria-label={t.chat.send}
          >
            <SendHorizonal className="size-4" />
          </button>
        )}
      </form>
      <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
        <ModelPicker models={models} value={modelId} onChange={onModelChange} />
        <span className="hidden truncate text-[11px] text-faint lg:block">{t.chat.hint}</span>
        <Link
          href="/coins"
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-muted hover:text-fg"
          aria-label={t.chat.balanceLabel(balance.toLocaleString())}
        >
          <Coins className="size-3.5 text-warn" /> {shortNumber(balance)}
        </Link>
      </div>
    </div>
  );
}
