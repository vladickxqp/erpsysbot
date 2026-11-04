"use client";

import { KeyRound, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { createApiKeyAction, deleteApiKeyAction } from "./actions";

type Key = { id: string; name: string; prefix: string; writable: boolean; lastUsedAt: string | null };

export function ApiKeysCard({ keys }: { keys: Key[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [writable, setWritable] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" /> {t("apiKeys.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {fresh && (
          <div className="grid gap-1 rounded-lg border border-warning/30 bg-warning/10 p-2.5">
            <span className="text-xs">{t("apiKeys.once")}</span>
            <input readOnly value={fresh} aria-label={t("apiKeys.title")} onFocus={(e) => e.currentTarget.select()} className="w-full rounded border bg-background px-2 py-1 font-mono text-xs" />
          </div>
        )}
        {keys.map((k) => (
          <div key={k.id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate">{k.name}</span>
            <code className="text-xs text-muted-foreground">{k.prefix}…</code>
            <span className="text-xs text-muted-foreground">{t(k.writable ? "apiKeys.write" : "apiKeys.read")}</span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={pending}
              aria-label={t("common.delete")}
              onClick={() =>
                start(async () => {
                  const res = await deleteApiKeyAction(k.id);
                  if (res.error) toast.error(t(res.error));
                  router.refresh();
                })
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createApiKeyAction(name, writable);
              if (res.error) toast.error(t(res.error));
              else {
                setFresh(res.token ?? null);
                setName("");
                setWritable(false);
              }
              router.refresh();
            });
          }}
        >
          <Input className="min-w-40 flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("apiKeys.name")} aria-label={t("apiKeys.name")} required maxLength={80} />
          <label className="flex items-center gap-2">
            <Checkbox checked={writable} onCheckedChange={(v) => setWritable(v === true)} /> {t("apiKeys.write")}
          </label>
          <Button type="submit" variant="outline" disabled={pending}>
            {t("common.create")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
