import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai, Plus_Jakarta_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getT } from "@/i18n/server";
import { cookies } from "next/headers";
import { readDisplayPrefs } from "@/lib/display-prefs";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const thai = Noto_Sans_Thai({ subsets: ["thai"], variable: "--font-thai", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: "Lumora AI", template: "%s · Lumora AI" },
    description: t.meta.description,
    applicationName: "Lumora AI",
    // iOS: open full-screen when launched from the home screen.
    appleWebApp: { capable: true, title: "Lumora", statusBarStyle: "black-translucent" },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#0b0a12",
  width: "device-width",
  initialScale: 1,
  // Draw under the notch / home indicator; layouts pad with env(safe-area-inset-*).
  viewportFit: "cover",
  // The on-screen keyboard shrinks the layout (Android Chrome), so the chat box stays visible.
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const prefs = readDisplayPrefs(await cookies());
  return (
    <html lang={locale} className={`${jakarta.variable} ${thai.variable}`} data-theme={prefs.theme} data-text={prefs.text}>
      <body className="ambient min-h-dvh antialiased">
        <I18nProvider locale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
