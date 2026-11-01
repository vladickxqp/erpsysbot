import { ArrowRight, Bot, Receipt, Users } from "lucide-react";
import Link from "next/link";
import { LocaleSwitch } from "@/components/app/locale-switch";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { currentUser } from "@/server/request";

export default async function Home() {
  const { t } = await getT();
  const user = await currentUser();
  const features = [
    { icon: Users, text: t("landing.f1") },
    { icon: Receipt, text: t("landing.f2") },
    { icon: Bot, text: t("landing.f3") },
  ];
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          <LocaleSwitch />
          <ThemeToggle />
          <Button variant="ghost" asChild className="ml-1">
            <Link href={user ? "/app" : "/login"}>{user ? t("nav.dashboard") : t("landing.login")}</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="py-20 text-center sm:py-28">
          <p className="text-sm font-medium text-primary">{t("brand.tagline")}</p>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{t("landing.headline")}</h1>
          <div className="mt-8 flex justify-center gap-3">
            <Button size="lg" asChild>
              <Link href={user ? "/app" : "/register"}>
                {user ? t("nav.dashboard") : t("landing.start")} <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </section>
        <section className="grid gap-4 pb-24 sm:grid-cols-3">
          {features.map(({ icon: Icon, text }) => (
            <div key={text} className="rounded-xl border bg-card p-6 shadow-xs">
              <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <p className="mt-4 font-medium">{text}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
