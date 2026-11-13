"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { deleteStoreAction } from "../store/actions";

/**
 * Deleting a site or shop: a draft after one question, a site that is
 * online only once its name is typed again. Orders of a shop stay.
 */
export function DeleteSite({
  site,
  selling,
  button,
  onDeleted,
}: {
  site: { id: string; name: string; status: string };
  selling: boolean;
  /** A labelled button instead of the small icon. */
  button?: boolean;
  onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const online = site.status === "PUBLISHED";
  const ready = !online || typed.trim() === site.name.trim();

  const remove = () =>
    start(async () => {
      const result = await deleteStoreAction(site.id, typed);
      if (!result.ok) {
        toast.error(t(result.error ?? "common.error"));
        return;
      }
      setOpen(false);
      toast.success(t("sites.deleted"));
      if (onDeleted) onDeleted();
      else router.refresh();
    });

  return (
    <>
      {button ? (
        <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" /> {t("common.delete")}
        </Button>
      ) : (
        <Button type="button" variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label={t("common.delete")} title={t("common.delete")} onClick={() => setOpen(true)}>
          <Trash2 className="size-4" />
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setTyped("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(selling ? "store.deleteAsk" : "sites.deleteAsk")}</DialogTitle>
            <DialogDescription className="font-medium text-foreground">{site.name}</DialogDescription>
          </DialogHeader>
          {online && (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{t("sites.confirmName")}</span>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={site.name} autoComplete="off" />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={pending || !ready} onClick={remove}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
