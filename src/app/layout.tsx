import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai, Kanit, Sarabun } from "next/font/google";
import { cookies } from "next/headers";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getT } from "@/i18n/server";
import { readDisplayPrefs } from "@/lib/display-prefs";
import "./globals.css";

const kanit = Kanit({ variable: "--font-kanit", subsets: ["thai", "latin"], weight: ["500", "600", "700"], display: "swap" });
const plex = IBM_Plex_Sans_Thai({ variable: "--font-plex", subsets: ["thai", "latin"], weight: ["400", "500", "600"], display: "swap" });
const sarabun = Sarabun({ variable: "--font-sarabun", subsets: ["thai", "latin"], weight: ["400", "500", "600"], display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000"),
    title: { default: "Lumora AI", template: "%s · Lumora AI" },
    description: t.meta.description,
    applicationName: "Lumora AI",
    // iOS: open full-screen when launched from the home screen.
    appleWebApp: { capable: true, title: "Lumora", statusBarStyle: "black-translucent" },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#0f0f12",
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
    <html lang={locale} className={`${kanit.variable} ${plex.variable} ${sarabun.variable} h-full antialiased`} data-theme={prefs.theme} data-accent={prefs.accent} data-text={prefs.text}>
      <body className="flex min-h-dvh flex-col">
        <I18nProvider locale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
