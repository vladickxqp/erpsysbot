"use client";

import { Building2, ExternalLink, Plus, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { themeVars, type SiteKind, type Theme } from "@/lib/site";
import { cn } from "@/lib/utils";
import { FONT_STACKS } from "@/app/shop/[slug]/fonts";
import { createStoreAction } from "../store/actions";

type Row = { id: string; name: string; slug: string; status: string; kind: SiteKind; theme: Theme };

const KINDS = [
  { kind: "creator", icon: UserRound },
  { kind: "company", icon: Building2 },
] as const;

export function SitesView({ sites, ai }: { sites: Row[]; ai: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SiteKind>("company");
  const [pending, start] = useTransition();

  const create = (withAi: boolean) =>
    start(async () => {
      const result = await createStoreAction(name, kind);
      if (result.ok && result.id) router.push(`/app/sites/${result.id}${withAi ? "?ai=1" : ""}`);
      else toast.error(t(result.error ?? "common.error"));
    });

  return (
    <div className="grid gap-6">
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("sites.kind.title")}>
            {KINDS.map(({ kind: k, icon: Icon }) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn("flex items-center gap-3 rounded-lg border p-4 text-left transition hover:bg-accent", kind === k && "border-primary ring-2 ring-primary/30")}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="grid">
                  <span className="font-medium">{t(`sites.kind.${k}`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`sites.kind.${k}Hint`)}</span>
                </span>
              </button>
            ))}
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create(false);
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("store.name")} aria-label={t("store.name")} maxLength={120} className="w-full sm:w-72" />
            <Button type="submit" variant={ai ? "outline" : "default"} disabled={pending || !name.trim()}>
              <Plus className="size-4" /> {t("sites.new")}
            </Button>
            {ai && (
              <Button type="button" disabled={pending || !name.trim()} onClick={() => create(true)}>
                <Sparkles className="size-4" /> {t("sites.newWithAi")}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
      {sites.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((s) => (
            <Card key={s.id} className="overflow-hidden pt-0">
              <Link href={`/app/sites/${s.id}`} aria-label={s.name} className="block">
                <Thumb theme={s.theme} name={s.name} />
              </Link>
              <CardContent className="grid gap-2">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/app/sites/${s.id}`} className="min-w-0 truncate font-medium hover:underline">
                    {s.name}
                  </Link>
                  <Badge variant={s.status === "PUBLISHED" ? "secondary" : "outline"} className={s.status === "PUBLISHED" ? "border-success/20 bg-success/10 text-success" : undefined}>
                    {t(`store.status.${s.status}`)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>{t(`sites.kind.${s.kind}`)}</span>
                  <a href={`/shop/${s.slug}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline">
                    /shop/{s.slug} <ExternalLink className="size-3.5" />
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** A small picture of the site in its own colours and fonts. */
export function Thumb({ theme, name, className }: { theme: Theme; name: string; className?: string }) {
  const fonts = FONT_STACKS[theme.font];
  return (
    <div
      aria-hidden
      style={{ ...themeVars(theme), fontFamily: fonts.body } as React.CSSProperties}
      className={cn("grid h-36 content-between overflow-hidden bg-[var(--site-bg)] p-4 text-[var(--site-fg)]", className)}
    >
      <div className="flex items-center justify-between gap-2 text-[10px] opacity-70">
        <span className="truncate font-semibold" style={{ fontFamily: fonts.heading }}>
          {name}
        </span>
        <span className="flex gap-1.5">
          <span className="h-1.5 w-6 rounded-full bg-current opacity-40" />
          <span className="h-1.5 w-6 rounded-full bg-current opacity-40" />
        </span>
      </div>
      <div
        className="grid gap-1.5 rounded-[var(--site-radius)] p-3 text-[var(--site-on-primary)]"
        style={{ backgroundImage: "linear-gradient(120deg, var(--shop-primary), var(--shop-accent))" }}
      >
        <span className="truncate text-sm font-bold" style={{ fontFamily: fonts.heading }}>
          {name}
        </span>
        <span className="h-4 w-14 rounded-[min(var(--site-radius),8px)] bg-[var(--shop-accent)]" />
      </div>
    </div>
  );
}
