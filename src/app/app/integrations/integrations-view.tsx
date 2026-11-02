"use client";

import { CircleCheck, CircleDashed, CircleSlash, ExternalLink, Mail, Send, Share2, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { IntegrationState } from "@/server/integrations";
import { addSocialAction, removeSocialAction } from "../social/actions";

type Channel = { id: string; provider: string; name: string; url: string | null; lastError: string | null };

const ICONS: Record<string, typeof Mail> = { assistant: Sparkles, telegramBot: Send, mail: Mail };

function StateBadge({ state }: { state: IntegrationState["state"] }) {
  const { t } = useI18n();
  const Icon = state === "ready" ? CircleCheck : state === "setup" ? CircleDashed : CircleSlash;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 whitespace-nowrap",
        state === "ready" && "border-success/30 bg-success/10 text-success",
        state === "setup" && "border-warning/30 bg-warning/10 text-warning",
        state === "unavailable" && "text-muted-foreground",
      )}
    >
      <Icon className="size-3" /> {t(`integrations.state.${state}`)}
    </Badge>
  );
}

function AddChannel({ provider }: { provider: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        start(async () => {
          const res = await addSocialAction(provider, value);
          if (res.error) toast.error(t(res.error));
          else {
            toast.success(t("social.connected"));
            setValue("");
            router.refresh();
          }
        });
      }}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={provider === "YOUTUBE" ? "@channel / UC… / youtube.com/…" : "@channel / t.me/…"}
        aria-label={t("social.channelId")}
      />
      <Button type="submit" variant="outline" disabled={pending || !value.trim()}>
        {t("social.connect")}
      </Button>
    </form>
  );
}

export function IntegrationsView({ states, channels }: { states: IntegrationState[]; channels: Channel[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [removing, setRemoving] = useState<Channel | null>(null);
  const [, start] = useTransition();
  const services = states.filter((s) => s.key in ICONS);
  const social = states.filter((s) => !(s.key in ICONS));

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("integrations.services")}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {services.map((s) => {
            const Icon = ICONS[s.key];
            return (
              <Card key={s.key}>
                <CardContent className="grid gap-2 pt-6">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium">
                      <Icon className="size-4" /> {t(`integrations.name.${s.key}`)}
                    </span>
                    <StateBadge state={s.state} />
                  </div>
                  {s.env && <p className="text-xs text-muted-foreground">{t("integrations.howEnv", { env: s.env })}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("integrations.social")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {social.map((s) => {
            const mine = channels.filter((c) => c.provider === s.key);
            return (
              <Card key={s.key} className={cn(s.state === "unavailable" && "opacity-70")}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span className="flex items-center gap-2">
                      <Share2 className="size-4" /> {t(`social.provider.${s.key}`)}
                    </span>
                    <StateBadge state={s.state} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  {s.state === "unavailable" && <p className="text-xs text-muted-foreground">{t("integrations.unavailableHow")}</p>}
                  {s.env && <p className="text-xs text-muted-foreground">{t("integrations.howEnv", { env: s.env })}</p>}
                  {s.state === "ready" && s.key === "TELEGRAM" && <p className="text-xs text-muted-foreground">{t("integrations.telegramHow")}</p>}
                  {mine.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {c.lastError && <span className="text-xs text-warning">{t(`social.${c.lastError}`)}</span>}
                      {c.url && (
                        <a href={c.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={c.name}>
                          <ExternalLink className="size-4" />
                        </a>
                      )}
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => setRemoving(c)} aria-label={t("common.delete")}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {s.state === "ready" && s.channels && <AddChannel provider={s.key} />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={t("social.disconnect")}
        text={removing?.name ?? ""}
        confirm={t("social.disconnect")}
        destructive
        onConfirm={() => {
          const c = removing;
          setRemoving(null);
          if (c)
            start(async () => {
              const res = await removeSocialAction(c.id);
              if (res.error) toast.error(t(res.error));
              router.refresh();
            });
        }}
      />
    </div>
  );
}
