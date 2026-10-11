"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Heart, MessageCircle, Flag, Ban, Pencil, Trash2, Globe, Link2, Lock, Brain } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/i18n/client";
import { ReportDialog } from "@/components/safety/report-dialog";

export function StartChatButton({ characterId, signedIn, disabled }: { characterId: string; signedIn: boolean; disabled?: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!signedIn) {
    return (
      <ButtonLink href={`/login?next=/characters/${characterId}`} size="lg" className="flex-1 sm:flex-none">
        <MessageCircle className="size-5" /> {t.character.signInToChat}
      </ButtonLink>
    );
  }
  return (
    <Button
      size="lg"
      className="flex-1 sm:flex-none"
      loading={busy}
      disabled={disabled}
      onClick={async () => {
        setBusy(true);
        try {
          const { id } = await api<{ id: string }>("/api/conversations", { method: "POST", body: { characterId } });
          router.push(`/chats/${id}`);
        } catch (e) {
          toast.error(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <MessageCircle className="size-5" /> {t.character.startChat}
    </Button>
  );
}

export function FavoriteButton({ characterId, initial }: { characterId: string; initial: boolean }) {
  const t = useT();
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      size="lg"
      aria-pressed={fav}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/characters/${characterId}/favorite`, { method: fav ? "DELETE" : "PUT" });
          setFav(!fav);
          toast.success(fav ? t.character.removedFav : t.character.addedFav);
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Heart className={`size-5 ${fav ? "fill-danger text-danger" : ""}`} />
      <span className="sr-only sm:not-sr-only">{fav ? t.character.favorited : t.character.favorite}</span>
    </Button>
  );
}

export function ViewerSafetyActions({ characterId, blocked: initialBlocked }: { characterId: string; blocked: boolean }) {
  const t = useT();
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blocked, setBlocked] = useState(initialBlocked);
  const toast = useToast();
  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="sm" onClick={() => setReportOpen(true)}>
        <Flag className="size-4" /> {t.character.report}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setBlockOpen(true)}>
        <Ban className="size-4" /> {blocked ? t.character.unblock : t.character.block}
      </Button>
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} targetType="character" targetId={characterId} />
      <ConfirmDialog
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        title={blocked ? t.character.unblockTitle : t.character.blockTitle}
        description={blocked ? t.character.unblockBody : t.character.blockBody}
        confirmLabel={blocked ? t.character.unblock : t.character.block}
        danger={!blocked}
        onConfirm={async () => {
          try {
            await api(`/api/characters/${characterId}/block`, { method: blocked ? "DELETE" : "PUT" });
            setBlocked(!blocked);
            toast.success(blocked ? t.character.unblockedToast : t.character.blockedToast);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}

export function OwnerActions({ characterId, visibility, publicationStatus }: { characterId: string; visibility: string; publicationStatus: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | "delete" | "public" | "unlisted" | "private">(null);
  const restricted = publicationStatus === "suspended" || publicationStatus === "hidden";

  async function run(kind: NonNullable<typeof confirm>) {
    try {
      if (kind === "delete") {
        await api(`/api/characters/${characterId}`, { method: "DELETE" });
        toast.success(t.character.deletedToast);
        router.replace("/library");
        return;
      }
      if (kind === "private") await api(`/api/characters/${characterId}/publish`, { method: "DELETE" });
      else await api(`/api/characters/${characterId}/publish`, { method: "POST", body: { visibility: kind } });
      toast.success(kind === "private" ? t.character.privateToast : kind === "public" ? t.character.publicToast : t.character.unlistedToast);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const copy = {
    public: t.character.confirmPublic,
    unlisted: t.character.confirmUnlisted,
    private: t.character.confirmPrivate,
    delete: t.character.confirmDelete,
  };

  return (
    <div className="rounded-2xl border border-line bg-surface-2/60 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">{t.character.creatorTools}</p>
      {restricted && (
        <p className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
          {t.character.restricted(publicationStatus)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/characters/${characterId}/edit`} variant="secondary" size="sm">
          <Pencil className="size-4" /> {t.character.edit}
        </ButtonLink>
        <ButtonLink href={`/memories/${characterId}`} variant="secondary" size="sm">
          <Brain className="size-4" /> {t.character.memories}
        </ButtonLink>
        {visibility !== "public" && !restricted && (
          <Button size="sm" onClick={() => setConfirm("public")}>
            <Globe className="size-4" /> {t.character.publish}
          </Button>
        )}
        {visibility !== "unlisted" && !restricted && (
          <Button variant="secondary" size="sm" onClick={() => setConfirm("unlisted")}>
            <Link2 className="size-4" /> {t.character.shareLink}
          </Button>
        )}
        {visibility !== "private" && (
          <Button variant="secondary" size="sm" onClick={() => setConfirm("private")}>
            <Lock className="size-4" /> {t.character.makePrivate}
          </Button>
        )}
        <Button variant="danger" size="sm" onClick={() => setConfirm("delete")}>
          <Trash2 className="size-4" /> {t.common.delete}
        </Button>
      </div>
      {confirm && (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          title={copy[confirm][0]}
          description={copy[confirm][1]}
          danger={confirm === "delete"}
          confirmLabel={confirm === "delete" ? t.character.deleteForever : t.common.confirm}
          onConfirm={() => run(confirm)}
        />
      )}
    </div>
  );
}
