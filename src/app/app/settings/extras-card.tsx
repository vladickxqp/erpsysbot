"use client";

import { CalendarSync, ImageIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/client";
import { calendarLinkAction, setLogoAction } from "./actions";

/** The picture on invoices and quotes. */
export function LogoCard({ logoId }: { logoId: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const upload = (file: File) =>
    start(async () => {
      const form = new FormData();
      form.append("file", file);
      form.append("category", "logo");
      const res = await fetch("/app/documents/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { ids?: string[]; error?: string };
      if (!body.ids?.[0]) {
        toast.error(t(`documents.${body.error ?? "TYPE"}`));
        return;
      }
      const saved = await setLogoAction(body.ids[0]);
      if (saved.error) toast.error(t(saved.error));
      router.refresh();
    });
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageIcon className="size-4" /> {t("company.logo")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {logoId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/app/documents/${logoId}/file`} alt={t("company.logo")} className="max-h-16 w-fit rounded bg-white object-contain p-1" />
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload(file);
          }}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => input.current?.click()}>
            {t("documents.upload")}
          </Button>
          {logoId && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await setLogoAction(null);
                  router.refresh();
                })
              }
            >
              {t("common.delete")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** One's calendar in the phone, Google or Outlook. */
export function CalendarLinkCard() {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarSync className="size-4" /> {t("calendarLink.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {url && <input readOnly value={url} aria-label={t("calendarLink.title")} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border bg-transparent px-2 py-1 font-mono text-xs" />}
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await calendarLinkAction();
                setUrl(res.url);
              })
            }
          >
            {t("calendarLink.create")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
