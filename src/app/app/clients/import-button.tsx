"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/client";
import type { ImportResult } from "@/server/import";
import { importClientsAction } from "./actions";

const MAX_BYTES = 1_500_000;

export function ImportButton() {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const read = (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error(t("import.tooBig"));
      return;
    }
    start(async () => {
      // Excel saves CSV as Windows-1252 unless told otherwise; UTF-8 first, then that.
      const bytes = await file.arrayBuffer();
      let text = new TextDecoder("utf-8").decode(bytes);
      if (text.includes("�")) text = new TextDecoder("windows-1252").decode(bytes);
      const outcome = await importClientsAction(text);
      if ("error" in outcome) toast.error(t(outcome.error));
      else {
        setResult(outcome);
        router.refresh();
      }
    });
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) read(file);
        }}
      />
      <Button variant="outline" disabled={pending} onClick={() => input.current?.click()} aria-label={t("import.button")}>
        <Upload className="size-4" /> <span className="hidden sm:inline">{pending ? t("common.loading") : t("import.button")}</span>
      </Button>
      <Dialog open={result !== null} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("import.done")}</DialogTitle>
            <DialogDescription className="sr-only">{t("import.done")}</DialogDescription>
          </DialogHeader>
          {result && (
            <div className="grid gap-2 text-sm">
              <div>{t("import.created", { count: result.created })}</div>
              {result.skipped > 0 && <div className="text-muted-foreground">{t("import.skipped", { count: result.skipped })}</div>}
              {result.failed.length > 0 && (
                <div className="text-destructive">
                  {t("import.failed", { count: result.failed.length })}: {result.failed.slice(0, 10).map((f) => f.line).join(", ")}
                </div>
              )}
              {result.unknownColumns.length > 0 && (
                <div className="text-muted-foreground">
                  {t("import.ignored")}: {result.unknownColumns.join(", ")}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
