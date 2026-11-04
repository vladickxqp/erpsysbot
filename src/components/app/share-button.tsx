"use client";

import { Link2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { revokeShareAction, shareAction } from "@/app/app/share-actions";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";

/** Makes a client link and puts it on the clipboard. */
export function ShareButton({ kind, id }: { kind: "quote" | "invoice"; id: string }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await shareAction(kind, id);
            if (res.error || !res.url) {
              toast.error(t(res.error ?? "common.error"));
              return;
            }
            setUrl(res.url);
            await navigator.clipboard?.writeText(res.url).catch(() => undefined);
            toast.success(t("team.copied"));
          })
        }
      >
        <Link2 className="size-4" /> {t("share.link")}
      </Button>
      {url && <input readOnly value={url} aria-label={t("share.link")} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border bg-transparent px-2 py-1 font-mono text-xs" />}
      {url && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await revokeShareAction(kind, id);
              if (res.error) toast.error(t(res.error));
              else setUrl(null);
            })
          }
        >
          {t("share.revoke")}
        </Button>
      )}
    </>
  );
}
