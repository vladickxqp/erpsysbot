"use client";

import { MoreHorizontal, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/client";
import { deleteRecurringAction, runRecurringNowAction, toggleRecurringAction, type RecurringResult } from "./actions";

export function RecurringRowActions({ id, active }: { id: string; active: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [pending, start] = useTransition();
  const run = (work: () => Promise<RecurringResult>) =>
    start(async () => {
      const res = await work();
      if (res.error) toast.error(t(res.error));
      router.refresh();
    });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" disabled={pending} aria-label={t("common.edit")}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => run(() => toggleRecurringAction(id, !active))}>
            {active ? <Pause className="size-4" /> : <Play className="size-4" />} {t(active ? "recurring.pause" : "recurring.resume")}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={() => setRemoving(true)}>
            <Trash2 className="size-4" /> {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("common.delete")}
        text={t("recurring.deleteText")}
        confirm={t("common.delete")}
        destructive
        onConfirm={() => {
          setRemoving(false);
          run(() => deleteRecurringAction(id));
        }}
      />
    </>
  );
}

export function RunNowButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await runRecurringNowAction();
          if (res.error) toast.error(t(res.error));
          else toast.success(t("recurring.ran", { count: String(res.created ?? 0) }));
          router.refresh();
        })
      }
    >
      <RefreshCw className="size-4" /> {t("recurring.runNow")}
    </Button>
  );
}
