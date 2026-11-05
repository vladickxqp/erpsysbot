"use client";

import { AtSign, Bell, Check, CheckCircle2, CheckCheck, Inbox as InboxIcon, Lightbulb, ListTodo, ShieldCheck, Star, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { InsightCard } from "@/components/app/insight-card";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { InboxCategory, InboxItem } from "@/server/inbox";
import { completeAction, decideAction, dismissAction, readAction, readAllAction, type InboxResult } from "./actions";

const TABS: { key: InboxCategory | "all"; icon: typeof Bell }[] = [
  { key: "all", icon: InboxIcon },
  { key: "important", icon: Star },
  { key: "assigned", icon: ListTodo },
  { key: "mention", icon: AtSign },
  { key: "approval", icon: ShieldCheck },
  { key: "update", icon: Bell },
  { key: "insight", icon: Lightbulb },
];

export function InboxView({ items }: { items: InboxItem[] }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<InboxCategory | "all">("all");
  const [pending, start] = useTransition();
  const run = (work: () => Promise<InboxResult>) =>
    start(async () => {
      const result = await work();
      if (result.error) toast.error(t(result.error, result.vars));
      router.refresh();
    });
  const inTab = (key: InboxCategory | "all", i: InboxItem) => key === "all" || (key === "important" ? i.priority === 2 : i.category === key);
  const shown = items.filter((i) => inTab(tab, i));
  const hasUnreadNotes = items.some((i) => i.id.startsWith("note:") && !i.read);

  return (
    <>
      <PageHeader
        title={t("hub.inbox.title")}
        actions={
          hasUnreadNotes && (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(readAllAction)}>
              <CheckCheck className="size-4" /> {t("hub.inbox.readAll")}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label={t("hub.inbox.title")}>
        {TABS.map(({ key, icon: Icon }) => {
          const count = items.filter((i) => inTab(key, i) && !i.read).length;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", tab === key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              <Icon className="size-3.5" aria-hidden /> {t(`hub.inbox.${key}`)}
              {count > 0 && <span className="text-xs tabular-nums">{count}</span>}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t("hub.inbox.empty")} />
      ) : (
        <div className="grid gap-2">
          {shown.map((item) =>
            item.insight ? (
              <InsightCard key={item.id} insight={item.insight} />
            ) : (
              <div key={item.id} className={cn("flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 text-sm", item.read && "opacity-60", item.priority === 2 && !item.read && "border-destructive/40")}>
                <div className="min-w-0 flex-1">
                  {item.href ? (
                    <Link href={item.href} className="font-medium hover:text-primary" onClick={() => item.id.startsWith("note:") && !item.read && void readAction(item.id)}>
                      {t(`hub.n.${item.kind}`, item.vars)}
                    </Link>
                  ) : (
                    <span className="font-medium">{t(`hub.n.${item.kind}`, item.vars)}</span>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {t(`hub.inbox.${item.category}`)} · {formatDate(item.at, locale, region)}
                  </div>
                </div>
                {item.actions.includes("complete") && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => completeAction(item.id))}>
                    <CheckCircle2 className="size-4" /> {t("hub.today.done")}
                  </Button>
                )}
                {item.actions.includes("approve") && (
                  <Button size="sm" disabled={pending} onClick={() => run(() => decideAction(item.id, true))}>
                    <Check className="size-4" /> {t("hub.inbox.approve")}
                  </Button>
                )}
                {item.actions.includes("reject") && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideAction(item.id, false))}>
                    <X className="size-4" /> {t("hub.inbox.reject")}
                  </Button>
                )}
                {item.actions.includes("read") && (
                  <Button size="icon" variant="ghost" className="size-8" disabled={pending} aria-label={t("hub.inbox.markRead")} onClick={() => run(() => readAction(item.id))}>
                    <Check className="size-4" />
                  </Button>
                )}
                {item.actions.includes("dismiss") && (
                  <Button size="icon" variant="ghost" className="size-8" disabled={pending} aria-label={t("hub.inbox.dismiss")} onClick={() => run(() => dismissAction(item.id))}>
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </>
  );
}
