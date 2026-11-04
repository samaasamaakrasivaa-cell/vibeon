import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getLang } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { Suspense } from "react";
import { NavLoader } from "@/components/NavLoader";

export const metadata: Metadata = {
  title: { default: "VibeOn", template: "%s · VibeOn" },
  description: "Платформа для репетиторов английского: кабинет учителя, кабинет ученика, онлайн-урок и конструктор уроков.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F2F7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang}>
      <body>
        <I18nProvider lang={lang}>{children}</I18nProvider>
        <Suspense fallback={null}><NavLoader /></Suspense>
      </body>
    </html>
  );
}
