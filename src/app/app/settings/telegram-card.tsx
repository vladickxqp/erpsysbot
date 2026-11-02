"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/i18n/client";
import { connectTelegramAction, disconnectTelegramAction, telegramNotifyAction } from "./actions";

export function TelegramCard({ linked }: { linked: { name: string; notify: boolean } | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Back from Telegram: show the new state.
  useEffect(() => {
    if (!url) return;
    const refresh = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [url, router]);

  useEffect(() => {
    if (linked) setUrl(null);
  }, [linked]);

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="size-4" /> {t("telegram.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {linked ? (
          <>
            <div>{t("telegram.connected", { name: linked.name })}</div>
            <label className="flex items-center gap-2">
              <Checkbox checked={linked.notify} disabled={pending} onCheckedChange={(c) => start(() => telegramNotifyAction(c === true))} />
              {t("telegram.notify")}
            </label>
            <Button variant="outline" size="sm" className="w-fit" disabled={pending} onClick={() => start(() => disconnectTelegramAction())}>
              {t("telegram.disconnect")}
            </Button>
          </>
        ) : url ? (
          <Button asChild className="w-fit">
            <a href={url} target="_blank" rel="noopener noreferrer">
              {t("telegram.open")}
            </a>
          </Button>
        ) : (
          <Button
            className="w-fit"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await connectTelegramAction();
                if (result.url) setUrl(result.url);
                else toast.error(t("telegram.notSet"));
              })
            }
          >
            {t("telegram.connect")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
