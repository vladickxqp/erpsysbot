"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LocaleSwitch } from "@/components/app/locale-switch";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

const LINKS = ["features", "audiences", "how", "pricing", "faq"] as const;

export function LandingNav({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 border-b border-transparent transition-all duration-500", (solid || open) && "border-white/8 bg-[#050814]/75 backdrop-blur-xl")}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="NEXORA ONE">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label={t("landing.nav.label")}>
          {LINKS.map((key) => (
            <a key={key} href={`#${key}`} className="text-sm text-white/65 transition-colors hover:text-white">
              {t(`landing.nav.${key}`)}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <LocaleSwitch />
          {!signedIn && (
            <Button variant="ghost" asChild className="hidden sm:inline-flex">
              <Link href="/login">{t("landing.login")}</Link>
            </Button>
          )}
          <Button asChild className="ml-1 hidden rounded-full px-4 sm:inline-flex">
            <Link href={signedIn ? "/app" : "/register"}>{signedIn ? t("nav.dashboard") : t("landing.start")}</Link>
          </Button>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("landing.nav.label")} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>
      {open && (
        <nav className="grid gap-1 border-t border-white/8 px-4 py-3 md:hidden" aria-label={t("landing.nav.label")}>
          {LINKS.map((key) => (
            <a key={key} href={`#${key}`} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-white/80 hover:bg-white/5">
              {t(`landing.nav.${key}`)}
            </a>
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {!signedIn && (
              <Button variant="outline" asChild>
                <Link href="/login">{t("landing.login")}</Link>
              </Button>
            )}
            <Button asChild className={signedIn ? "col-span-2" : undefined}>
              <Link href={signedIn ? "/app" : "/register"}>{signedIn ? t("nav.dashboard") : t("landing.start")}</Link>
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
