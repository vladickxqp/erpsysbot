import { Check } from "lucide-react";
import Link from "next/link";
import { LegalLinks } from "@/components/app/legal-links";
import { LocaleSwitch } from "@/components/app/locale-switch";
import { Logo } from "@/components/app/logo";
import { BackdropScene } from "@/components/landing/backdrop-scene";
import { getT } from "@/i18n/server";
import { TRIAL_DAYS } from "@/server/billing";
import "../landing.css";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getT();
  const points = [t("landing.auth.p1", { days: TRIAL_DAYS }), t("landing.auth.p2"), t("landing.auth.p3")];
  return (
    <div className="auth-shell dark relative grid lg:grid-cols-[1.15fr_1fr]">
      <aside className="relative hidden overflow-hidden lg:sticky lg:top-0 lg:block lg:h-dvh">
        <BackdropScene priority />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#050814]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050814]/80 via-transparent to-[#050814]/40" />
        <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
          <Link href="/" aria-label="NEXORA ONE" className="w-fit">
            <Logo />
          </Link>
          <div className="rise max-w-lg">
            <h2 className="text-gradient text-4xl leading-tight font-semibold tracking-tight xl:text-5xl">{t("landing.headline")}</h2>
            <ul className="mt-7 grid gap-3">
              {points.map((point) => (
                <li key={point} className="flex items-center gap-3 text-white/80">
                  <span className="grid size-6 place-items-center rounded-full bg-cyan-300/15 text-cyan-300">
                    <Check className="size-3.5" aria-hidden />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <div className="relative flex min-h-dvh flex-col overflow-hidden">
        <div className="absolute inset-0 opacity-40 lg:hidden">
          <BackdropScene />
          <div className="absolute inset-0 bg-gradient-to-b from-[#050814]/40 to-[#050814]" />
        </div>
        <header className="relative flex h-16 items-center justify-between px-4 sm:px-8 lg:justify-end">
          <Link href="/" aria-label="NEXORA ONE" className="lg:hidden">
            <Logo />
          </Link>
          <LocaleSwitch />
        </header>
        <main className="relative grid flex-1 place-items-center px-4 pt-4 pb-10 sm:px-8">
          <div className="auth-panel rise glass w-full max-w-md rounded-3xl p-6 sm:p-9">{children}</div>
        </main>
        <div className="relative">
          <LegalLinks />
        </div>
      </div>
    </div>
  );
}
