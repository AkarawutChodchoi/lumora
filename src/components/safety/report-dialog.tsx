"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { SelectField, TextArea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/i18n/client";

export function ReportDialog({ open, onClose, targetType, targetId }: { open: boolean; onClose: () => void; targetType: "character" | "message" | "user"; targetId: string }) {
  const t = useT();
  const [category, setCategory] = useState("other");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title={t.report.title(t.enums.targetType[targetType])}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/api/reports", { method: "POST", body: { targetType, targetId, category, details } });
            toast.success(t.report.thanks);
            setDetails("");
            onClose();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <SelectField label={t.report.what} value={category} onChange={(e) => setCategory(e.target.value)} options={Object.entries(t.enums.reportCategory).map(([value, label]) => ({ value, label }))} />
        <TextArea label={t.report.details} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} counter={{ value: details.length, max: 1000 }} />
        <p className="text-xs text-faint">{t.report.emergency}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" loading={busy}>
            {t.report.submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
