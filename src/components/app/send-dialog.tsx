"use client";

import { Mail, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { reminderTextAction } from "@/app/app/assistant/actions";
import { sendDocumentAction } from "@/app/app/send-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import type { DocumentKind } from "@/server/send";

/** "Send by e-mail": the client's address prefilled, an optional own text, the PDF attached. */
export function SendButton({
  kind,
  id,
  email,
  label,
  variant = "outline",
  draftFor,
}: {
  /** The invoice to write a text for with the assistant. */
  draftFor?: string;
  kind: DocumentKind;
  id: string;
  email: string | null;
  label?: string;
  variant?: "outline" | "default" | "ghost";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(email ?? "");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Mail className="size-4" /> {label ?? t("send.button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{label ?? t("send.button")}</DialogTitle>
            <DialogDescription className="sr-only">{t("send.button")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const result = await sendDocumentAction(kind, id, to, message);
                if (result.ok) {
                  toast.success(t("send.sent"));
                  setOpen(false);
                  router.refresh();
                } else toast.error(t(`send.${result.error ?? "failed"}`));
              });
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`send-to-${id}`}>{t("send.to")}</Label>
              <Input id={`send-to-${id}`} type="email" value={to} onChange={(e) => setTo(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={`send-msg-${id}`}>{t("send.message")}</Label>
                {draftFor && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const result = await reminderTextAction(draftFor);
                        if (result.text) setMessage(result.text);
                        else toast.error(t(result.error ?? "common.error"));
                      })
                    }
                  >
                    <Sparkles className="size-4" /> {t("hub.ai.draftText")}
                  </Button>
                )}
              </div>
              <Textarea id={`send-msg-${id}`} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("send.standard")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t("common.loading") : t("send.send")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
