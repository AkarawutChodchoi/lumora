"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { useT } from "@/i18n/client";

type Toast = { id: number; tone: "ok" | "error"; text: string };
const Ctx = createContext<(tone: Toast["tone"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex max-w-md animate-fade-in items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${
              toast.tone === "ok" ? "border-ok/30 bg-surface-2/95" : "border-danger/40 bg-surface-2/95"
            }`}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            {toast.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />}
            <span>{toast.text}</span>
            <button className="ml-2 text-faint hover:text-fg" onClick={() => setToasts((x) => x.filter((y) => y.id !== toast.id))} aria-label={t.common.dismiss}>
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  return { success: (t: string) => push("ok", t), error: (t: string) => push("error", t) };
}
