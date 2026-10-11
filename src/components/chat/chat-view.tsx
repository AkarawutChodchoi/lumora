"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Brain, Coins, MoreVertical, Pin, PinOff, Pencil, Trash2, Flag, UserRound, WifiOff, LifeBuoy, X } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ReportDialog } from "@/components/safety/report-dialog";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/i18n/client";
import { shortNumber } from "@/lib/format";
import { MessageBubble, type ChatMessage } from "./message-bubble";
import { Composer } from "./composer";
import type { ModelOption } from "./model-picker";

type StreamEvent =
  | { type: "start"; generationId: string; userMessage: ChatMessage | null; assistantMessageId: string; replacedMessageIds: string[]; devMode: boolean; notice?: string }
  | { type: "delta"; text: string }
  | { type: "done"; message: ChatMessage; balance: number }
  | { type: "error"; code: string; message: string; balance?: number };

interface Props {
  conversation: { id: string; title: string; pinned: boolean; status: string };
  character: { id: string; name: string; avatarUrl: string | null; tagline: string; publicationStatus: string };
  initialMessages: ChatMessage[];
  initialHasMore: boolean;
  initialBalance: number;
  models: ModelOption[];
  initialModel: string;
  devMode: boolean;
  generatingOnLoad: boolean;
  canAct: boolean;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function ChatView(props: Props) {
  const { conversation, character } = props;
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>(props.initialMessages);
  const [hasMore, setHasMore] = useState(props.initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [balance, setBalance] = useState(props.initialBalance);
  const [modelId, setModelId] = useState(props.initialModel);
  const [active, setActive] = useState<{ generationId: string | null; assistantId: string } | null>(null);
  // True while this tab is reading the reply stream; false when it only polls (after a reload).
  const streaming = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [banner, setBanner] = useState<{ tone: "error" | "info"; text: string; coins?: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [pinned, setPinned] = useState(conversation.pinned);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "rename" | "delete" | "report-character" | { report: string } | { edit: ChatMessage }>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const busy = active !== null;
  const characterUnavailable = character.publicationStatus === "suspended";

  // ---- scrolling ----
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  useLayoutEffect(() => scrollToBottom(), [scrollToBottom]);
  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages, scrollToBottom]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // ---- fit the visible screen (browser bars and the keyboard change it on phones) ----
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setViewport({ height: vv.height, top: vv.offsetTop });
      if (stickToBottom.current) requestAnimationFrame(() => scrollToBottom());
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [scrollToBottom]);

  // ---- connectivity ----
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // ---- resync from the server (after a dropped stream or a refresh mid-reply) ----
  const resync = useCallback(async () => {
    try {
      const page = await api<{ items: ChatMessage[]; hasMore: boolean }>(`/api/conversations/${conversation.id}/messages?limit=40`);
      setMessages(page.items);
      const last = page.items.at(-1);
      if (last && last.role === "assistant" && (last.status === "pending" || last.status === "streaming")) {
        setActive({ generationId: last.generationId ?? null, assistantId: last.id });
        setTimeout(resync, 1500);
      } else {
        setActive(null);
        api<{ balance: number }>("/api/credits").then((c) => setBalance(c.balance)).catch(() => {});
      }
    } catch {
      setTimeout(resync, 3000);
    }
  }, [conversation.id]);

  useEffect(() => {
    if (props.generatingOnLoad) void resync();
  }, [props.generatingOnLoad, resync]);

  // ---- older history ----
  async function loadOlder() {
    if (!messages.length || loadingOlder) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await api<{ items: ChatMessage[]; hasMore: boolean }>(`/api/conversations/${conversation.id}/messages?limit=30&before=${messages[0].sequence}`);
      stickToBottom.current = false;
      setMessages((m) => [...page.items, ...m]);
      setHasMore(page.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingOlder(false);
    }
  }

  // ---- sending ----
  async function generate(body: { mode: "send"; content: string } | { mode: "regenerate" } | { mode: "edit"; messageId: string; content: string }) {
    if (busy) return;
    setBanner(null);
    stickToBottom.current = true;
    const tempUserId = `temp-user-${newId()}`;
    const tempAssistantId = `temp-assistant-${newId()}`;
    const now = new Date().toISOString();
    const lastSeq = messages.at(-1)?.sequence ?? 0;

    setMessages((m) => {
      let next = m;
      if (body.mode === "regenerate") next = next.slice(0, -1);
      if (body.mode === "edit") next = next.filter((x) => x.sequence < (m.find((y) => y.id === body.messageId)?.sequence ?? Infinity));
      if (body.mode !== "regenerate") next = [...next, { id: tempUserId, sequence: lastSeq + 1, role: "user", content: body.content, status: "completed", errorCode: null, createdAt: now }];
      return [...next, { id: tempAssistantId, sequence: lastSeq + 2, role: "assistant", content: "", status: "pending", errorCode: null, createdAt: now }];
    });
    setActive({ generationId: null, assistantId: tempAssistantId });

    const rollback = () => setMessages((m) => m.filter((x) => x.id !== tempUserId && x.id !== tempAssistantId));
    let res: Response;
    try {
      res = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, clientRequestId: newId() }),
      });
    } catch {
      rollback();
      setActive(null);
      if (body.mode === "regenerate") void resync();
      setBanner({ tone: "error", text: t.chat.unreachable });
      return;
    }

    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => null);
      rollback();
      setActive(null);
      if (body.mode !== "send") void resync();
      const code = data?.error?.code;
      setBanner({ tone: "error", text: data?.error?.message ?? t.common.genericError, coins: code === "insufficient_credits" });
      return;
    }

    let assistantId = tempAssistantId;
    let settled = false;
    streaming.current = true;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const handle = (e: StreamEvent) => {
      if (e.type === "start") {
        assistantId = e.assistantMessageId;
        setActive({ generationId: e.generationId, assistantId });
        if (e.notice) setNotice(t.chat.selfHarm);
        setMessages((m) =>
          m
            .filter((x) => !e.replacedMessageIds.includes(x.id))
            .map((x) => (x.id === tempUserId && e.userMessage ? e.userMessage : x.id === tempAssistantId ? { ...x, id: assistantId, status: "streaming" } : x)),
        );
      } else if (e.type === "delta") {
        setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, content: x.content + e.text, status: "streaming" } : x)));
      } else if (e.type === "done") {
        settled = true;
        setBalance(e.balance);
        setMessages((m) => (e.message.status === "cancelled" && !e.message.content ? m.filter((x) => x.id !== assistantId) : m.map((x) => (x.id === assistantId ? e.message : x))));
      } else if (e.type === "error") {
        settled = true;
        if (typeof e.balance === "number") setBalance(e.balance);
        setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, status: "failed", errorCode: e.code, content: e.code === "content_policy" ? "" : x.content } : x)));
        setBanner({ tone: "error", text: `${t.chat.failures[e.code] ?? t.chat.failures.default} ${t.chat.refunded}` });
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (line) handle(JSON.parse(line.slice(6)) as StreamEvent);
        }
      }
    } catch {
      /* connection dropped — handled below */
    }

    streaming.current = false;
    if (!settled) {
      // The server keeps generating even if our connection dropped; fetch the saved result.
      setBanner({ tone: "info", text: t.chat.interrupted });
      void resync().then(() => setBanner(null));
      return;
    }
    setActive(null);
  }

  async function stop() {
    if (!active?.generationId || stopping) return;
    setStopping(true);
    try {
      await api(`/api/generations/${active.generationId}/cancel`, { method: "POST" });
      // Without a live stream (e.g. after reopening the app) nothing else will tell us it stopped.
      if (!streaming.current) await resync();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setStopping(false);
    }
  }

  // ---- conversation actions ----
  async function patch(data: { title?: string; pinned?: boolean }) {
    try {
      await api(`/api/conversations/${conversation.id}`, { method: "PATCH", body: data });
      if (data.title !== undefined) setTitle(data.title);
      if (data.pinned !== undefined) setPinned(data.pinned);
      toast.success(data.pinned !== undefined ? (data.pinned ? t.chat.pinnedToast : t.chat.unpinnedToast) : t.chat.renamedToast);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const canRegenerate = !busy && props.canAct && !characterUnavailable && lastAssistant && lastAssistant === messages.at(-1) && lastAssistant.sequence !== 1 && Boolean(lastUser);

  return (
    <div
      className="fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden overscroll-none"
      style={viewport ? { height: viewport.height, transform: `translateY(${viewport.top}px)` } : undefined}
    >
      {/* Header */}
      <header className="relative z-30 flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-center pt-[env(safe-area-inset-top)] gap-3 border-b border-line bg-surface/80 px-3 backdrop-blur sm:px-5">
        <button onClick={() => router.push("/chats")} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label={t.chat.back}>
          <ArrowLeft className="size-5" />
        </button>
        <Link href={`/characters/${character.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar name={character.name} src={character.avatarUrl} className="size-10" />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 truncate font-semibold">
              {title} {pinned && <Pin className="size-3.5 text-accent" aria-label={t.chat.pinned} />}
            </span>
            <span className="block truncate text-xs text-faint">{busy ? t.chat.writing(character.name) : character.tagline || character.name}</span>
          </span>
        </Link>
        <Link href="/coins" className="hidden items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm sm:flex" title={t.nav.coinBalance}>
          <Coins className="size-4 text-warn" /> {shortNumber(balance)}
        </Link>
        <div className="relative">
          <button onClick={() => setMenuOpen((o) => !o)} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label={t.chat.options} aria-expanded={menuOpen} aria-haspopup="menu">
            <MoreVertical className="size-5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div role="menu" className="absolute right-0 z-40 mt-1 w-56 animate-fade-in overflow-hidden rounded-2xl border border-line bg-surface-2 py-1 shadow-2xl" onClick={() => setMenuOpen(false)}>
                <MenuItem icon={<Pencil className="size-4" />} label={t.chat.rename} onClick={() => setDialog("rename")} />
                <MenuItem icon={pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />} label={pinned ? t.chat.unpin : t.chat.pin} onClick={() => patch({ pinned: !pinned })} />
                <MenuItem icon={<Brain className="size-4" />} label={t.chat.memories} href={`/memories/${character.id}`} />
                <MenuItem icon={<UserRound className="size-4" />} label={t.chat.profile} href={`/characters/${character.id}`} />
                <MenuItem icon={<Flag className="size-4" />} label={t.chat.reportCharacter} onClick={() => setDialog("report-character")} />
                <div className="my-1 border-t border-line" />
                <MenuItem icon={<Trash2 className="size-4" />} label={t.chat.deleteChat} danger onClick={() => setDialog("delete")} />
              </div>
            </>
          )}
        </div>
      </header>

      {props.devMode && (
        <div className="shrink-0 border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-center text-xs text-warn">{t.chat.devBanner}</div>
      )}
      {offline && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger" role="status">
          <WifiOff className="size-3.5" /> {t.chat.offline}
        </div>
      )}

      {/* Messages */}
      <div ref={scroller} onScroll={onScroll} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-live="polite" aria-busy={busy}>
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-6 sm:px-6">
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={loadOlder} loading={loadingOlder}>
                {t.chat.loadEarlier}
              </Button>
            </div>
          )}
          {!hasMore && (
            <p className="mx-auto max-w-sm text-center text-xs text-faint">
              {t.chat.start(character.name)}
            </p>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              characterName={character.name}
              characterAvatar={character.avatarUrl}
              canRegenerate={Boolean(canRegenerate && m.id === lastAssistant?.id)}
              canEdit={!busy && props.canAct && !characterUnavailable && m.id === lastUser?.id && !m.id.startsWith("temp")}
              onRegenerate={() => generate({ mode: "regenerate" })}
              onEdit={() => setDialog({ edit: m })}
              onReport={() => setDialog({ report: m.id })}
            />
          ))}
        </div>
      </div>

      {/* Notices + composer */}
      <div className="shrink-0 border-t border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-3 pt-3 sm:px-6">
          {notice && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-sm" role="status">
              <LifeBuoy className="mt-0.5 size-4 shrink-0 text-accent" />
              <span className="flex-1">{notice}</span>
              <button onClick={() => setNotice(null)} aria-label={t.common.dismiss} className="text-faint hover:text-fg">
                <X className="size-4" />
              </button>
            </div>
          )}
          {banner && (
            <div className={`mb-3 flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${banner.tone === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-line bg-surface-2 text-muted"}`} role="alert">
              <span className="flex-1">{banner.text}</span>
              {banner.coins && (
                <ButtonLink href="/coins" size="sm">
                  {t.chat.getCoins}
                </ButtonLink>
              )}
              <button onClick={() => setBanner(null)} aria-label={t.common.dismiss} className="opacity-70 hover:opacity-100">
                <X className="size-4" />
              </button>
            </div>
          )}
        </div>
        <Composer
          disabled={!props.canAct || characterUnavailable || offline || conversation.status !== "active"}
          disabledReason={
            !props.canAct ? t.chat.noAccount : characterUnavailable ? t.chat.unavailable : offline ? t.chat.offlineShort : conversation.status !== "active" ? t.chat.archived : undefined
          }
          busy={busy}
          canStop={Boolean(active?.generationId) && !stopping}
          models={props.models}
          modelId={modelId}
          onModelChange={setModelId}
          balance={balance}
          characterName={character.name}
          onSend={(content) => generate({ mode: "send", content })}
          onStop={stop}
        />
      </div>

      {/* Dialogs */}
      <RenameDialog open={dialog === "rename"} initial={title} onClose={() => setDialog(null)} onSave={(t) => patch({ title: t })} />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        title={t.chat.deleteTitle}
        description={t.chat.deleteBody}
        confirmLabel={t.chat.deleteChat}
        danger
        onConfirm={async () => {
          try {
            await api(`/api/conversations/${conversation.id}`, { method: "DELETE" });
            toast.success(t.chat.deletedToast);
            router.replace("/chats");
            router.refresh();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      <ReportDialog open={dialog === "report-character"} onClose={() => setDialog(null)} targetType="character" targetId={character.id} />
      {dialog && typeof dialog === "object" && "report" in dialog && <ReportDialog open onClose={() => setDialog(null)} targetType="message" targetId={dialog.report} />}
      {dialog && typeof dialog === "object" && "edit" in dialog && (
        <EditDialog
          message={dialog.edit}
          onClose={() => setDialog(null)}
          onSave={(content) => {
            setDialog(null);
            void generate({ mode: "edit", messageId: dialog.edit.id, content });
          }}
        />
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, href, danger }: { icon: React.ReactNode; label: string; onClick?: () => void; href?: string; danger?: boolean }) {
  const cls = `flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm ${danger ? "text-danger hover:bg-danger/10" : "text-fg hover:bg-surface-3"}`;
  return href ? (
    <Link role="menuitem" href={href} className={cls}>
      {icon}
      {label}
    </Link>
  ) : (
    <button role="menuitem" onClick={onClick} className={cls}>
      {icon}
      {label}
    </button>
  );
}

function RenameDialog({ open, initial, onClose, onSave }: { open: boolean; initial: string; onClose: () => void; onSave: (title: string) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial, open]);
  return (
    <Modal open={open} onClose={onClose} title={t.chat.rename}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.trim()) return;
          await onSave(value.trim());
          onClose();
        }}
        className="space-y-4"
      >
        <TextField label={t.chat.titleLabel} value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} autoFocus />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={!value.trim()}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditDialog({ message, onClose, onSave }: { message: ChatMessage; onClose: () => void; onSave: (content: string) => void }) {
  const t = useT();
  const [value, setValue] = useState(message.content);
  return (
    <Modal open onClose={onClose} title={t.chat.editTitle}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSave(value.trim());
        }}
        className="space-y-4"
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={4000}
          className="min-h-32 w-full rounded-xl border border-line bg-surface-2 p-3 text-base focus:border-accent focus:outline-none sm:text-sm"
          aria-label={t.chat.message}
          autoFocus
        />
        <p className="text-xs text-faint">{t.chat.editNote}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={!value.trim() || value.trim() === message.content}>
            {t.chat.saveRegenerate}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
