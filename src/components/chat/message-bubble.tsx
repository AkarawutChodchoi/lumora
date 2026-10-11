"use client";

import { useState } from "react";
import { Copy, Check, RefreshCw, Pencil, Flag, AlertCircle } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { TypingDots } from "@/components/ui/spinner";
import { useT } from "@/i18n/client";

export interface ChatMessage {
  id: string;
  sequence: number;
  role: string;
  content: string;
  status: string;
  errorCode: string | null;
  /** Set while the reply is still being generated, so it can be stopped after a reload. */
  generationId?: string | null;
  createdAt: string | Date;
}

/** Renders *actions* in italics. Everything else is plain text (React escapes it). */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.length > 2 && p.startsWith("*") && p.endsWith("*") ? (
          <em key={i} className="text-muted italic">
            {p.slice(1, -1)}
          </em>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function MessageBubble({
  message: m,
  characterName,
  characterAvatar,
  canRegenerate,
  canEdit,
  onRegenerate,
  onEdit,
  onReport,
}: {
  message: ChatMessage;
  characterName: string;
  characterAvatar: string | null;
  canRegenerate: boolean;
  canEdit: boolean;
  onRegenerate: () => void;
  onEdit: () => void;
  onReport: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const isUser = m.role === "user";
  const waiting = (m.status === "pending" || m.status === "streaming") && !m.content;
  const failed = m.status === "failed";
  const isTemp = m.id.startsWith("temp");

  return (
    <div className={`group flex animate-fade-in gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && <Avatar name={characterName} src={characterAvatar} className="mt-1 size-8 shrink-0" />}
      <div className={`flex max-w-[85%] flex-col sm:max-w-[75%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap ${
            isUser ? "rounded-tr-md bg-accent text-white" : `rounded-tl-md border bg-surface-2 ${failed ? "border-danger/40" : "border-line"}`
          }`}
        >
          {waiting ? (
            <TypingDots label={t.chat.typing(characterName)} />
          ) : (
            <>
              {m.content && <RichText text={m.content} />}
              {m.status === "streaming" && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-accent" aria-hidden="true" />}
            </>
          )}
          {failed && (
            <p className={`flex items-center gap-1.5 text-xs text-danger ${m.content ? "mt-2" : ""}`}>
              <AlertCircle className="size-3.5" /> {t.chat.failures[m.errorCode ?? ""] ?? t.chat.failures.default}
            </p>
          )}
          {m.status === "cancelled" && <p className="mt-1 text-xs text-faint">{t.chat.stopped}</p>}
        </div>

        {!isTemp && !waiting && m.status !== "streaming" && (
          <div className="mt-1 flex gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            {m.content && (
              <IconBtn
                label={copied ? t.chat.copied : t.chat.copy}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(m.content);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    /* clipboard blocked */
                  }
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </IconBtn>
            )}
            {canRegenerate && (
              <IconBtn label={failed ? t.chat.retry : t.chat.regenerate} onClick={onRegenerate}>
                <RefreshCw className="size-3.5" />
              </IconBtn>
            )}
            {canEdit && (
              <IconBtn label={t.chat.edit} onClick={onEdit}>
                <Pencil className="size-3.5" />
              </IconBtn>
            )}
            {!isUser && m.content && (
              <IconBtn label={t.chat.reportMessage} onClick={onReport}>
                <Flag className="size-3.5" />
              </IconBtn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="rounded-lg p-1.5 text-faint hover:bg-surface-2 hover:text-fg">
      {children}
    </button>
  );
}
