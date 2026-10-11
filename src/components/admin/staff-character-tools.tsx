"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ReasonAction } from "./admin-actions";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/i18n/client";

/** Moderation and admin controls shown on a character page to staff (not the owner). */
export function StaffCharacterTools({
  characterId,
  publicationStatus,
  visibility,
  featured,
  canEditAny,
}: {
  characterId: string;
  publicationStatus: string;
  visibility: string;
  featured: boolean;
  canEditAny: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const T = t.admin.characters;
  const endpoint = `/api/admin/characters/${characterId}`;
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-accent uppercase">
        <ShieldCheck className="size-4" /> {t.admin.account.staffTools} · {t.enums.publication[publicationStatus]}
      </p>
      <div className="flex flex-wrap gap-2">
        {(publicationStatus === "hidden" || publicationStatus === "suspended") && <ReasonAction label={T.restore} endpoint={endpoint} body={{ action: "restore" }} />}
        {publicationStatus !== "hidden" && <ReasonAction label={T.hide} endpoint={endpoint} body={{ action: "hide" }} />}
        {publicationStatus !== "suspended" && <ReasonAction label={T.suspend} variant="danger" endpoint={endpoint} body={{ action: "suspend" }} />}
        {publicationStatus === "published" && visibility === "public" && (
          <ReasonAction label={featured ? T.unfeature : T.feature} endpoint={endpoint} body={{ action: featured ? "unfeature" : "feature" }} />
        )}
        {canEditAny && (
          <>
            <ButtonLink href={`/characters/${characterId}/edit`} variant="secondary" size="sm">
              <Pencil className="size-4" /> {t.admin.account.editAny}
            </ButtonLink>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> {t.admin.account.deleteAny}
            </Button>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t.character.confirmDelete[0]}
        description={t.character.confirmDelete[1]}
        confirmLabel={t.character.deleteForever}
        danger
        onConfirm={async () => {
          try {
            await api(`/api/characters/${characterId}`, { method: "DELETE" });
            toast.success(t.character.deletedToast);
            router.replace("/admin/characters");
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}
