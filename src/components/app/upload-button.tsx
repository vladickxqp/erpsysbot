"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.docx,.xlsx,.pptx,.odt,.ods,.txt,.csv,application/pdf,image/*";
const MEDIA_ACCEPT = `${ACCEPT},.mp4,.mov,.webm,.m4a,.mp3,.wav,.ogg,video/*,audio/*`;
const MAX_BYTES = 15 * 1024 * 1024;

/** Uploads files to the documents store, linked to whatever `meta` names (client, order, invoice). */
export function UploadButton({
  meta = {},
  label,
  variant = "default",
  media,
}: {
  meta?: Record<string, string | null | undefined>;
  label?: string;
  variant?: "default" | "outline";
  /** Videos and audio too, up to this many bytes each. */
  media?: { maxBytes: number };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (files: File[]) => {
    const tooBig = files.find((f) => f.size > (media && /^(video|audio)\//.test(f.type) ? media.maxBytes : MAX_BYTES));
    if (tooBig) {
      toast.error(t("documents.TOO_LARGE"));
      return;
    }
    const form = new FormData();
    for (const f of files.slice(0, 5)) form.append("file", f);
    for (const [k, v] of Object.entries(meta)) if (v) form.append(k, v);
    setBusy(true);
    try {
      const res = await fetch("/app/documents/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (body.ok) {
        toast.success(t("documents.uploaded"));
        router.refresh();
      } else toast.error(t(`documents.${body.error ?? "TYPE"}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={media ? MEDIA_ACCEPT : ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void upload(files);
        }}
      />
      <Button variant={variant} disabled={busy} onClick={() => input.current?.click()}>
        <Upload className="size-4" /> {busy ? t("common.loading") : (label ?? t("documents.upload"))}
      </Button>
    </>
  );
}
