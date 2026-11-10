"use client";

import { FileSpreadsheet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

export function ImportUpload() {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const send = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/app/products/import/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (body.id) router.push(`/app/products/import/${body.id}`);
      else toast.error(t(body.error === "forbidden" ? "common.forbidden" : `catalog.import.error.${body.error ?? "TYPE"}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void send(e.dataTransfer.files[0]);
      }}
      className={cn("grid place-items-center gap-3 rounded-xl border border-dashed bg-card/50 px-6 py-12 text-center", over && "border-primary bg-primary/5")}
    >
      <FileSpreadsheet className="size-8 text-primary" aria-hidden />
      <span className="text-sm text-muted-foreground">CSV · XLSX · XLS · ODS</span>
      <input
        ref={input}
        type="file"
        accept=".csv,.txt,.xlsx,.xls,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet"
        className="hidden"
        onChange={(e) => {
          void send(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Button disabled={busy} onClick={() => input.current?.click()}>
        {busy ? t("common.loading") : t("catalog.import.choose")}
      </Button>
    </div>
  );
}
