"use client";

import { useRef, useState } from "react";
import { ImagePlus, Link2, Trash2 } from "lucide-react";
import { Avatar } from "./misc";
import { Spinner } from "./spinner";
import { useToast } from "./toast";
import { useT } from "@/i18n/client";
import { errorMessage, ApiError } from "@/lib/api";

const MAX_SIDE = 768;

/** Downscale in the browser so uploads stay small (and phone photos don't hit size limits). */
async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("unreadable");
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type: string, q?: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  // WebP keeps PNG transparency and is small; browsers without WebP encoding fall back to JPEG.
  const webp = await toBlob("image/webp", 0.86);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob("image/jpeg", 0.88);
  if (!jpeg) throw new Error("unreadable");
  return jpeg;
}

/**
 * Picture field: upload from device (primary) or paste an https link (secondary).
 * `value` is either "" (none), "/api/images/…" or an https URL.
 */
export function ImageUpload({
  label,
  name,
  value,
  onChange,
  error,
  shape = "portrait",
}: {
  label: string;
  name: string;
  value: string;
  onChange: (url: string) => void;
  error?: string;
  shape?: "portrait" | "round";
}) {
  const t = useT();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [linkMode, setLinkMode] = useState(value.startsWith("https://"));

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await resize(file).catch(() => {
        throw new Error(t.form.imageReadError);
      });
      const form = new FormData();
      form.append("file", blob, "image");
      const res = await fetch("/api/images", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "unknown", data?.error?.message ?? t.common.genericError);
      onChange(data.url);
      setLinkMode(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const preview = value.startsWith("/api/images/") || value.startsWith("https://") ? value : null;
  const frame = shape === "round" ? "size-20 rounded-full" : "aspect-[4/5] w-28 rounded-2xl";

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-start gap-4">
        <div className={`${frame} relative shrink-0 overflow-hidden border border-line bg-surface-2`}>
          <Avatar name={name || "?"} src={preview} className="size-full text-3xl" rounded={shape === "round" ? "rounded-full" : "rounded-none"} />
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-bg/70">
              <Spinner />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
            >
              <ImagePlus className="size-4" /> {busy ? t.form.uploading : preview ? t.form.changeImage : t.form.upload}
            </button>
            {preview && !busy && (
              <button type="button" onClick={() => onChange("")} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm text-muted hover:text-fg">
                <Trash2 className="size-4" /> {t.form.removeImage}
              </button>
            )}
          </div>
          <p className="text-xs text-faint">{t.form.imageTypes}</p>
          <button type="button" onClick={() => setLinkMode((m) => !m)} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            <Link2 className="size-3.5" /> {linkMode ? t.form.useUpload : t.form.useLink}
          </button>
          {linkMode && (
            <input
              type="url"
              inputMode="url"
              value={value.startsWith("/api/images/") ? "" : value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="https://…"
              aria-label={t.form.useLink}
              className="h-10 w-full rounded-xl border border-line bg-surface-2 px-3 text-base placeholder:text-faint focus:border-accent focus:outline-none sm:text-sm"
            />
          )}
          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
