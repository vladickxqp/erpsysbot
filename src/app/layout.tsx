import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { ThemeProvider } from "next-themes";
import { ServiceWorker } from "@/components/app/service-worker";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: { default: "NEXORA ONE", template: "%s · NEXORA ONE" },
  description: "One platform. Your entire business. Powered by AI.",
  appleWebApp: { capable: true, title: "Business OS", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale, messages, region } = await getT();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
          <I18nProvider locale={locale} region={region} messages={messages}>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster richColors closeButton position="top-right" />
            <ServiceWorker />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
