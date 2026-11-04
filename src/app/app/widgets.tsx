"use client";

import { ArrowDownRight, ArrowUpRight, Bell, CircleCheck, CircleDashed, CircleSlash, FileText, Lightbulb, Plus, Scale, ShoppingCart, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { ContentStatusBadge, InvoiceStatusBadge } from "@/components/app/badges";
import { FlowChart } from "@/components/app/flow-chart";
import { GrowthChart } from "@/components/app/growth-chart";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney, intlTag } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { ACTIVITY_VERB } from "@/lib/activity";
import { CONTENT_STATUSES } from "@/lib/content";
import { cn } from "@/lib/utils";
import type { WidgetType } from "@/server/dashboards";
import type { Notice, WidgetData } from "@/server/widget-data";
import { Delta } from "./social/social-view";

/** Where a widget's title leads. */
export const WIDGET_LINK: Partial<Record<WidgetType, string>> = {
  revenue: "/app/finance",
  expenses: "/app/finance",
  profit: "/app/finance",
  outstanding: "/app/invoices?filter=OPEN",
  openOrders: "/app/orders",
  clients: "/app/clients",
  clientGrowth: "/app/clients",
  cashFlow: "/app/finance",
  myTasks: "/app/tasks?mine=1",
  projects: "/app/tasks",
  agenda: "/app/calendar?view=day",
  content: "/app/content",
  social: "/app/social",
  services: "/app/integrations",
  recentInvoices: "/app/invoices",
};

function Empty({ text, href, action }: { text: string; href?: string; action?: string }) {
  return (
    <div className="grid justify-items-start gap-2 py-2 text-sm text-muted-foreground">
      <p>{text}</p>
      {href && action && (
        <Button asChild size="sm" variant="outline" className="h-auto max-w-full whitespace-normal py-1.5 text-left">
          <Link href={href}>{action}</Link>
        </Button>
      )}
    </div>
  );
}

function Figure({ value, hint, icon: Icon, tone }: { value: string; hint?: string; icon: typeof Users; tone?: "warning" }) {
  return (
    <div className="flex items-end justify-between gap-2">
      <div>
        <div className={cn("text-3xl font-semibold tracking-tight tabular-nums", tone === "warning" && "text-warning")}>{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <Icon className="size-5 text-muted-foreground" aria-hidden />
    </div>
  );
}

function Notices({ items, empty, icon: Icon }: { items: Notice[]; empty: string; icon: typeof Bell }) {
  const { t } = useI18n();
  if (!items.length) return <Empty text={empty} />;
  return (
    <div className="grid gap-1.5">
      {items.map((n) => (
        <Link key={n.key} href={n.href} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
          <Icon className={cn("mt-0.5 size-4 shrink-0", n.tone === "danger" ? "text-destructive" : n.tone === "warning" ? "text-warning" : "text-primary")} aria-hidden />
          <span>{t(`widgets.n.${n.key}`, n.vars)}</span>
        </Link>
      ))}
    </div>
  );
}


export function WidgetBody({ type, data }: { type: WidgetType; data: WidgetData }) {
  const { t, locale, region } = useI18n();
  const money = (cents: number) => formatMoney(cents, locale, region);
  const tag = intlTag(locale, region);
  const nf = new Intl.NumberFormat(tag);
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "—" : nf.format(v));

  switch (type) {
    case "quickActions":
      return (
        data.quickActions && (
          <div className="flex flex-wrap gap-2">
            {data.quickActions.map((a) => (
              <Button key={a.key} asChild size="sm" variant="outline">
                <Link href={a.href}>
                  <Plus className="size-3.5" /> {t(`widgets.quick.${a.key}`)}
                </Link>
              </Button>
            ))}
          </div>
        )
      );
    case "revenue":
      return data.finance && <Figure value={money(data.finance.incomeCents)} hint={t("widgets.thisMonth")} icon={ArrowUpRight} />;
    case "expenses":
      return data.finance && <Figure value={money(data.finance.expenseCents)} hint={t("widgets.thisMonth")} icon={ArrowDownRight} />;
    case "profit":
      return data.finance && <Figure value={money(data.finance.resultCents)} hint={t("widgets.thisMonth")} icon={Scale} />;
    case "outstanding":
      return (
        data.outstanding && (
          <Figure
            value={money(data.outstanding.outstandingCents)}
            hint={data.outstanding.overdue ? t("dash2.overdue", { count: nf.format(data.outstanding.overdue) }) : t("widgets.invoicesOpen", { count: nf.format(data.outstanding.outstanding) })}
            icon={FileText}
            tone={data.outstanding.overdue ? "warning" : undefined}
          />
        )
      );
    case "openOrders":
      return data.openOrders && <Figure value={nf.format(data.openOrders.count)} hint={money(data.openOrders.netCents)} icon={ShoppingCart} />;
    case "clients":
      return (
        data.clients &&
        (data.clients.total === 0 ? (
          <Empty text={t("dashboard.emptyTitle")} href="/app/clients?new=1" action={t("dashboard.addFirst")} />
        ) : (
          <Figure
            value={nf.format(data.clients.total)}
            hint={`${t("dashboard.active")}: ${nf.format(data.clients.active)} · ${t("dashboard.newThisMonth")}: ${nf.format(data.clients.newThisMonth)}`}
            icon={Users}
          />
        ))
      );
    case "clientGrowth":
      return data.clients && <GrowthChart data={data.clients.growth} />;
    case "cashFlow":
      return data.cashFlow && <FlowChart data={data.cashFlow} />;
    case "myTasks":
      return (
        data.myTasks &&
        (data.myTasks.length === 0 ? (
          <Empty text={t("widgets.noTasks")} href="/app/tasks" action={t("nav.tasks")} />
        ) : (
          <div className="grid divide-y">
            {data.myTasks.map((task) => (
              <Link key={task.id} href="/app/tasks?mine=1" className="flex items-center gap-2 py-2 text-sm hover:text-primary">
                <span className={cn("size-2 shrink-0 rounded-full", task.priority === "HIGH" ? "bg-destructive" : task.priority === "MEDIUM" ? "bg-warning" : "bg-muted-foreground/40")} />
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                {task.dueDate && <span className={cn("text-xs tabular-nums text-muted-foreground", task.overdue && "text-destructive")}>{formatDate(task.dueDate, locale, region)}</span>}
              </Link>
            ))}
          </div>
        ))
      );
    case "projects":
      return (
        data.projects &&
        (data.projects.length === 0 ? (
          <Empty text={t("widgets.noProjects")} href="/app/tasks" action={t("nav.tasks")} />
        ) : (
          <div className="grid gap-3">
            {data.projects.map((p) => {
              const total = p.open + p.done;
              return (
                <Link key={p.id} href={`/app/tasks?project=${p.id}`} className="grid gap-1 text-sm hover:text-primary">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {p.done}/{total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${total ? Math.round((p.done / total) * 100) : 0}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        ))
      );
    case "agenda":
      return (
        data.agenda &&
        (data.agenda.length === 0 ? (
          <Empty text={t("widgets.noAppointments")} href="/app/calendar" action={t("nav.calendar")} />
        ) : (
          <div className="grid divide-y">
            {data.agenda.map((a) => (
              <Link key={a.id} href="/app/calendar?view=day" className="flex items-center gap-3 py-2 text-sm hover:text-primary">
                <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                  {a.start}–{a.end}
                </span>
                <span className="min-w-0 flex-1 truncate">{a.title}</span>
                {a.clientName && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{a.clientName}</span>}
              </Link>
            ))}
          </div>
        ))
      );
    case "content":
      return (
        data.content && (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_STATUSES.map((s) => (
                <Link key={s} href={`/app/content?view=list&status=${s}`} className="flex items-center gap-1">
                  <ContentStatusBadge status={s} />
                  <span className="text-sm tabular-nums">{nf.format(data.content!.byStatus[s])}</span>
                </Link>
              ))}
            </div>
            {data.content.upcoming.length === 0 ? (
              <Empty text={t("widgets.noUpcoming")} href="/app/content" action={t("studio.title")} />
            ) : (
              <div className="grid divide-y">
                {data.content.upcoming.map((c) => (
                  <Link key={c.id} href={`/app/content/${c.id}`} className="flex items-center gap-2 py-2 text-sm hover:text-primary">
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <span className="text-xs text-muted-foreground">{t(`studio.platform.${c.platform}`)}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(c.scheduledAt))}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )
      );
    case "social":
      return (
        data.social &&
        (data.social.channels.length === 0 ? (
          <Empty text={t("social.emptyHow")} href="/app/integrations" action={t("integrations.title")} />
        ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">{t("social.followers")}</div>
                <div className="text-2xl font-semibold tabular-nums">{num(data.social.followers)}</div>
                <Delta value={data.social.followersDelta} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{t("social.views")}</div>
                <div className="text-2xl font-semibold tabular-nums">{num(data.social.views)}</div>
                <Delta value={data.social.viewsDelta} />
              </div>
            </div>
            <div className="grid divide-y text-sm">
              {data.social.channels.map((c) => (
                <div key={c.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{t(`social.provider.${c.provider}`)}</span>
                  <span className="tabular-nums">{num(c.followers)}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      );
    case "services":
      return (
        data.services && (
          <div className="grid gap-1 text-sm">
            {data.services
              .filter((s) => s.state !== "unavailable")
              .map((s) => {
                const Icon = s.state === "ready" ? CircleCheck : s.state === "setup" ? CircleDashed : CircleSlash;
                return (
                  <div key={s.key} className="flex items-center gap-2">
                    <Icon className={cn("size-4", s.state === "ready" ? "text-success" : "text-warning")} aria-hidden />
                    <span className="flex-1">{s.key in { assistant: 1, telegramBot: 1, mail: 1 } ? t(`integrations.name.${s.key}`) : t(`social.provider.${s.key}`)}</span>
                    <span className="text-xs text-muted-foreground">{t(`integrations.state.${s.state}`)}</span>
                  </div>
                );
              })}
          </div>
        )
      );
    case "activity":
      return (
        data.activity &&
        (data.activity.length === 0 ? (
          <Empty text={t("widgets.noActivity")} />
        ) : (
          <div className="grid divide-y">
            {data.activity.map((a) => {
              const [entity, verb] = a.action.split(".");
              return (
                <div key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {a.who ?? "—"} · {t(`activity.entity.${entity}`)}: {t(`activity.verb.${ACTIVITY_VERB[verb] ?? "changed"}`)}
                    {a.via !== "web" && <span className="text-muted-foreground"> · {a.via === "ai" ? "AI" : "Telegram"}</span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(a.at))}
                  </span>
                </div>
              );
            })}
          </div>
        ))
      );
    case "recentInvoices":
      return (
        data.recentInvoices &&
        (data.recentInvoices.length === 0 ? (
          <Empty text={t("widgets.noInvoices")} href="/app/invoices/new" action={t("nav.invoices")} />
        ) : (
          <div className="grid divide-y">
            {data.recentInvoices.map((inv) => (
              <Link key={inv.id} href={`/app/invoices/${inv.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-primary">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{inv.clientName}</div>
                  <div className="text-xs text-muted-foreground">
                    {inv.number ?? t("invoices.draftNumber")}
                    {inv.issueDate && ` · ${formatDate(inv.issueDate, locale, region)}`}
                  </div>
                </div>
                <InvoiceStatusBadge status={inv.status} overdue={inv.overdue} kind={inv.kind} />
                <div className="w-28 text-right tabular-nums">{formatMoney(inv.grossCents, locale, { ...region, currency: inv.currency ?? region.currency })}</div>
              </Link>
            ))}
          </div>
        ))
      );
    case "notifications":
      return data.notifications && <Notices items={data.notifications} empty={t("widgets.allClear")} icon={Bell} />;
    case "recommendations":
      return (
        data.recommendations && (
          <div className="grid gap-2">
            <Notices items={data.recommendations} empty={t("widgets.noRecommendations")} icon={Lightbulb} />
            {data.assistant && (
              <Button asChild size="sm" variant="outline" className="justify-self-start">
                <Link href={`/app/assistant?ask=${encodeURIComponent(t("widgets.analysisPrompt"))}`}>
                  <Sparkles className="size-4" /> {t("widgets.aiAnalysis")}
                </Link>
              </Button>
            )}
          </div>
        )
      );
  }
}
