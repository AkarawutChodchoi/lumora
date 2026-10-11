"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useT } from "@/i18n/client";

const DISMISS_KEY = "lumora:install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/**
 * Mobile-only hint for adding Lumora to the home screen. Uses the browser's install
 * prompt when one is available (Android Chrome over HTTPS); otherwise shows the manual steps.
 */
export function InstallHint() {
  const t = useT();
  const [platform, setPlatform] = useState<"ios" | "android" | null>(null);
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* storage unavailable */
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (dismissed || standalone) return;
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) setPlatform("ios");
    else if (/Android/i.test(ua)) setPlatform("android");

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!platform) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage unavailable */
    }
    setPlatform(null);
  };

  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4 md:hidden" role="status">
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static icon */}
      <img src="/icons/icon-192.png" alt="" className="size-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t.install.title}</p>
        {!prompt && <p className="mt-0.5 text-xs text-muted">{platform === "ios" ? t.install.ios : t.install.android}</p>}
        {prompt && (
          <button
            onClick={async () => {
              await prompt.prompt();
              dismiss();
            }}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Download className="size-3.5" /> {t.install.button}
          </button>
        )}
      </div>
      <button onClick={dismiss} aria-label={t.install.dismiss} className="text-faint hover:text-fg">
        <X className="size-4" />
      </button>
    </div>
  );
}
