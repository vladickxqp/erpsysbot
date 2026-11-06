import { ArrowRight, Bot, Check, ChevronDown, Clapperboard, Download, FolderKanban, KeyRound, Receipt, ScrollText, ShieldCheck, Users, Workflow } from "lucide-react";
import Link from "next/link";
import { LegalLinks } from "@/components/app/legal-links";
import { Logo } from "@/components/app/logo";
import { Audiences } from "@/components/landing/audiences";
import { BackdropScene } from "@/components/landing/backdrop-scene";
import { LandingNav } from "@/components/landing/landing-nav";
import { ProductMock } from "@/components/landing/product-mock";
import { HeroScroll, Reveal, ScrollTilt } from "@/components/landing/scroll-fx";
import { Button } from "@/components/ui/button";
import { LOCALES } from "@/i18n";
import { getT } from "@/i18n/server";
import { APP_MODULES, WORKSPACE_TYPES } from "@/lib/modules";
import { publicPlans, TRIAL_DAYS } from "@/server/billing";
import { currentUser } from "@/server/request";
import "./landing.css";

/** The plan modules that get a line of their own on the price list. */
const PLAN_LINES = ["crm", "orders", "calendar", "invoices", "finance", "team", "telegram", "assistant", "reports", "tasks", "documents", "inventory", "automation"];

const TICKER = ["crm", "pipeline", "quotes", "orders", "invoices", "finance", "inventory", "time", "tasks", "calendar", "documents", "media", "content", "social", "team", "reports", "automation", "assistant"];

const delay = (ms: number) => ({ "--delay": `${ms}ms` }) as React.CSSProperties;

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">{title}</h2>
      {sub && <p className="mt-4 text-lg leading-relaxed text-white/60">{sub}</p>}
    </Reveal>
  );
}

export default async function Home() {
  const { t, locale } = await getT();
  const [user, plans] = await Promise.all([currentUser(), publicPlans()]);
  const startHref = user ? "/app" : "/register";
  const startLabel = user ? t("nav.dashboard") : t("landing.start");
  const money = (cents: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 0 }).format(cents / 100);

  const stats = [
    { value: APP_MODULES.length, label: t("landing.stats.modules") },
    { value: LOCALES.length, label: t("landing.stats.languages") },
    { value: WORKSPACE_TYPES.length, label: t("landing.stats.workspaces") },
    { value: TRIAL_DAYS, label: t("landing.stats.trial") },
  ];
  const features = [
    { key: "sales", icon: Users, wide: true },
    { key: "money", icon: Receipt, wide: false },
    { key: "work", icon: FolderKanban, wide: false },
    { key: "ai", icon: Bot, wide: true },
    { key: "creator", icon: Clapperboard, wide: true },
    { key: "auto", icon: Workflow, wide: false },
  ];
  const trust = [
    { key: "isolation", icon: ShieldCheck },
    { key: "twoFactor", icon: KeyRound },
    { key: "audit", icon: ScrollText },
    { key: "data", icon: Download },
  ];
  const mock = {
    overview: t("landing.mock.overview"),
    crm: t("landing.m.crm"),
    invoices: t("landing.m.invoices"),
    finance: t("landing.m.finance"),
    tasks: t("landing.m.tasks"),
    calendar: t("landing.m.calendar"),
    documents: t("landing.m.documents"),
    revenue: t("landing.mock.revenue"),
    open: t("landing.mock.open"),
    openTasks: t("landing.mock.tasks"),
    chart: t("landing.mock.chart"),
    today: t("landing.mock.today"),
    t1: t("landing.mock.t1"),
    t2: t("landing.mock.t2"),
    t3: t("landing.mock.t3"),
    sample: t("landing.mock.sample"),
  };

  return (
    <div className="landing dark">
      <noscript>
        <style>{`.reveal{opacity:1!important;transform:none!important;filter:none!important}`}</style>
      </noscript>
      <LandingNav signedIn={!!user} />

      <HeroScroll className="relative flex min-h-dvh flex-col overflow-hidden">
        <div className="hero-film absolute inset-0">
          <BackdropScene priority />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(5,8,20,0.55),transparent_70%)]" />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[#050814] to-transparent" />

        <div className="hero-copy relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 pt-24 pb-10 text-center sm:px-6">
          <p className="rise rounded-full border border-white/12 bg-white/5 px-4 py-1.5 text-xs font-medium text-cyan-200 backdrop-blur sm:text-sm" style={delay(100)}>
            {t("brand.tagline")}
          </p>
          <h1 className="rise text-gradient mt-6 text-5xl leading-[1.05] font-semibold tracking-tight sm:text-7xl" style={delay(220)}>
            {t("landing.headline")}
          </h1>
          <p className="rise mt-6 max-w-2xl text-lg leading-relaxed text-white/70 sm:text-xl" style={delay(360)}>
            {t("landing.sub")}
          </p>
          <div className="rise mt-9 flex flex-col items-center gap-3 sm:flex-row" style={delay(480)}>
            <Button size="lg" asChild className="h-12 rounded-full px-7 text-base shadow-[0_0_40px_-6px] shadow-primary">
              <Link href={startHref}>
                {startLabel} <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="ghost" asChild className="h-12 rounded-full border border-white/15 bg-white/5 px-7 text-base text-white backdrop-blur hover:bg-white/10">
              <a href="#pricing">{t("landing.seePrices")}</a>
            </Button>
          </div>
          <p className="rise mt-5 text-sm text-white/50" style={delay(580)}>
            {t("landing.trialNote", { days: TRIAL_DAYS })}
          </p>
        </div>

        <a href="#product" aria-label={t("landing.product.title")} className="hero-cue relative z-10 mx-auto mb-6 grid size-10 place-items-center rounded-full border border-white/15 text-white/60 transition-colors hover:text-white">
          <ChevronDown className="size-5" aria-hidden />
        </a>
      </HeroScroll>

      <section id="product" className="relative scroll-mt-20 px-4 pt-16 pb-24 sm:px-6">
        <Heading title={t("landing.product.title")} sub={t("landing.product.sub")} />
        <ScrollTilt className="mx-auto mt-14 max-w-5xl">
          <ProductMock text={mock} money={money} />
        </ScrollTilt>
        <Reveal className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-6 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-gradient text-4xl font-semibold tracking-tight sm:text-5xl">{stat.value}</p>
              <p className="mt-1 text-sm text-white/55">{stat.label}</p>
            </div>
          ))}
        </Reveal>
      </section>

      <div className="ticker border-y border-white/8 py-4" aria-hidden>
        <div className="ticker-track">
          {[...TICKER, ...TICKER].map((module, i) => (
            <span key={i} className="mx-5 text-sm whitespace-nowrap text-white/40">
              {t(`landing.m.${module}`)}
            </span>
          ))}
        </div>
      </div>

      <section id="features" className="relative scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
        <div className="glow top-24 left-1/2 -translate-x-1/2" />
        <Heading title={t("landing.features.title")} sub={t("landing.features.sub")} />
        <div className="mx-auto mt-14 grid max-w-6xl gap-4 md:grid-cols-3">
          {features.map(({ key, icon: Icon, wide }, i) => (
            <Reveal key={key} delay={(i % 3) * 90} className={wide ? "md:col-span-2" : undefined}>
              <article className="glass lift h-full rounded-3xl p-7 sm:p-8">
                <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-blue-500/25 to-indigo-500/25 text-cyan-200 ring-1 ring-white/10">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-white">{t(`landing.features.${key}`)}</h3>
                <p className="mt-2 leading-relaxed text-white/60">{t(`landing.features.${key}Text`)}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="audiences" className="relative scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
        <Heading title={t("landing.audiences.title")} sub={t("landing.audiences.sub")} />
        <Reveal className="mx-auto mt-12 max-w-5xl">
          <Audiences />
        </Reveal>
      </section>

      <section id="how" className="relative scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
        <Heading title={t("landing.how.title")} />
        <div className="mx-auto mt-14 grid max-w-5xl gap-4 md:grid-cols-3">
          {["s1", "s2", "s3"].map((step, i) => (
            <Reveal key={step} delay={i * 120}>
              <div className="glass h-full rounded-3xl p-7">
                <span className="text-gradient text-5xl font-semibold tracking-tight">{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold text-white">{t(`landing.how.${step}`)}</h3>
                <p className="mt-2 leading-relaxed text-white/60">{t(`landing.how.${step}Text`)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="relative px-4 py-24 sm:px-6 sm:py-32">
        <div className="glow top-10 right-0" />
        <Heading title={t("landing.trust.title")} sub={t("landing.trust.sub")} />
        <div className="mx-auto mt-14 grid max-w-5xl gap-4 sm:grid-cols-2">
          {trust.map(({ key, icon: Icon }, i) => (
            <Reveal key={key} delay={(i % 2) * 100}>
              <div className="flex h-full gap-4 rounded-2xl border border-white/8 bg-white/[0.025] p-6">
                <Icon className="mt-0.5 size-6 shrink-0 text-cyan-300" aria-hidden />
                <div>
                  <h3 className="font-semibold text-white">{t(`landing.trust.${key}`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-white/60">{t(`landing.trust.${key}Text`)}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="pricing" className="relative scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
        <div className="glow top-40 left-1/4" />
        <Heading title={t("landing.pricing.title")} sub={t("landing.pricing.sub", { days: TRIAL_DAYS })} />
        <div className="mx-auto mt-14 grid max-w-6xl items-stretch gap-5 lg:grid-cols-3">
          {plans.map((plan, i) => {
            const previous = plans[i - 1];
            const lines = PLAN_LINES.filter((m) => plan.modules.includes(m) && !previous?.modules.includes(m));
            const featured = plan.id === "business";
            return (
              <Reveal key={plan.id} delay={i * 110}>
                <article className={`lift relative flex h-full flex-col rounded-3xl p-7 sm:p-8 ${featured ? "plan-featured" : "glass"}`}>
                  {featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium whitespace-nowrap text-white shadow-[0_0_20px_-2px] shadow-primary">
                      {t("landing.pricing.free", { days: TRIAL_DAYS })}
                    </span>
                  )}
                  <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                  <p className="mt-4 flex items-baseline gap-1.5">
                    <span className="text-5xl font-semibold tracking-tight text-white">{money(plan.priceCents)}</span>
                    <span className="text-white/50">/ {t("billing.month")}</span>
                  </p>
                  <ul className="mt-7 grid flex-1 content-start gap-2.5 text-sm text-white/80">
                    <li className="flex gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-cyan-300" aria-hidden /> {t("billing.users", { count: plan.maxUsers })}
                    </li>
                    {plan.aiPerDay > 0 && (
                      <li className="flex gap-2.5">
                        <Check className="mt-0.5 size-4 shrink-0 text-cyan-300" aria-hidden /> {t("billing.ai", { count: plan.aiPerDay })}
                      </li>
                    )}
                    {previous && <li className="mt-2 text-white/50">{t("landing.pricing.plus", { plan: previous.name })}</li>}
                    {lines.map((module) => (
                      <li key={module} className="flex gap-2.5">
                        <Check className="mt-0.5 size-4 shrink-0 text-cyan-300" aria-hidden /> {t(`landing.m.${module}`)}
                      </li>
                    ))}
                  </ul>
                  <Button asChild size="lg" variant={featured ? "default" : "outline"} className="mt-8 h-11 rounded-full">
                    <Link href={startHref}>{user ? t("nav.dashboard") : t("landing.pricing.choose")}</Link>
                  </Button>
                </article>
              </Reveal>
            );
          })}
        </div>
        <Reveal className="mt-8 text-center text-sm text-white/50">{t("landing.pricing.noCard")}</Reveal>
      </section>

      <section id="faq" className="relative scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
        <Heading title={t("landing.faq.title")} />
        <div className="mx-auto mt-12 grid max-w-3xl gap-3">
          {[1, 2, 3, 4, 5].map((n, i) => (
            <Reveal key={n} delay={i * 60}>
              <details className="faq group rounded-2xl border border-white/8 bg-white/[0.025] px-6 py-4 transition-colors open:bg-white/[0.05]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-white [&::-webkit-details-marker]:hidden">
                  {t(`landing.faq.q${n}`)}
                  <ChevronDown className="size-5 shrink-0 text-white/50 transition-transform duration-300 group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mt-3 leading-relaxed text-white/60">{t(`landing.faq.a${n}`, { days: TRIAL_DAYS })}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="relative mx-4 mb-10 overflow-hidden rounded-[2rem] border border-white/10 sm:mx-6 lg:mx-auto lg:max-w-6xl">
        <BackdropScene className="opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050814]/85 via-[#050814]/35 to-transparent" />
        <Reveal className="relative px-6 py-24 text-center sm:py-32">
          <h2 className="text-gradient mx-auto max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">{t("landing.final.title")}</h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/70">{t("landing.trialNote", { days: TRIAL_DAYS })}</p>
          <Button size="lg" asChild className="mt-9 h-12 rounded-full px-8 text-base shadow-[0_0_40px_-6px] shadow-primary">
            <Link href={startHref}>
              {startLabel} <ArrowRight className="size-4" />
            </Link>
          </Button>
        </Reveal>
      </section>

      <footer className="px-4 pt-6 pb-4 text-center">
        <Link href="/" aria-label="NEXORA ONE" className="inline-block">
          <Logo />
        </Link>
        <p className="mt-2 text-sm text-white/45">{t("brand.tagline")}</p>
        <LegalLinks />
      </footer>
    </div>
  );
}
