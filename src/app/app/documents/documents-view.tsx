"use client";

import { Archive, ArchiveRestore, Download, FileImage, FileSpreadsheet, FileText, FolderOpen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SearchBox } from "@/components/app/list-controls";
import { EmptyState } from "@/components/app/page";
import { UploadButton } from "@/components/app/upload-button";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { archiveDocumentAction, deleteDocumentAction } from "./actions";

type Doc = { id: string; name: string; mimeType: string; sizeBytes: number; category: string | null; clientId: string | null; clientName: string | null; createdAt: string };

export const fileSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export function FileIcon({ mimeType }: { mimeType: string }) {
  const Icon = mimeType.startsWith("image/") ? FileImage : mimeType.includes("sheet") || mimeType === "text/csv" ? FileSpreadsheet : FileText;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

export function DocumentsView({
  docs,
  archived,
  canManage,
  clients,
  client,
}: {
  docs: Doc[];
  archived: boolean;
  canManage: boolean;
  clients: { id: string; name: string }[];
  client: string | null;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [removing, setRemoving] = useState<Doc | null>(null);
  const [pending, start] = useTransition();

  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.push(`/app/documents${q.size ? `?${q}` : ""}`);
  };
  const run = (work: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      const result = await work();
      if (result.error) toast.error(t(result.error));
      router.refresh();
    });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <SearchBox placeholder={t("documents.search")} />
        </div>
        {clients.length > 0 && (
          <Select value={client ?? "-"} onValueChange={(v) => go({ client: v === "-" ? null : v })}>
            <SelectTrigger className="w-48" aria-label={t("orders.client")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="-">{t("common.all")}</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button variant={archived ? "default" : "outline"} onClick={() => go({ archived: archived ? null : "1" })}>
          <Archive className="size-4" /> {t("documents.archive")}
        </Button>
        {canManage && !archived && <UploadButton meta={{ clientId: client }} />}
      </div>

      {docs.length === 0 ? (
        <EmptyState icon={FolderOpen} title={t("documents.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("documents.name")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("orders.client")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("documents.size")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("invoices.issueDate")}</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <a href={`/app/documents/${d.id}/file`} target="_blank" rel="noopener" className="flex items-center gap-2 font-medium hover:underline">
                      <FileIcon mimeType={d.mimeType} />
                      <span className="truncate">{d.name}</span>
                    </a>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {d.clientId ? (
                      <Link href={`/app/clients/${d.clientId}`} className="hover:underline">
                        {d.clientName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="hidden tabular-nums text-muted-foreground sm:table-cell">{fileSize(d.sizeBytes)}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(d.createdAt, locale)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button variant="ghost" size="icon" asChild aria-label={t("documents.download")}>
                        <a href={`/app/documents/${d.id}/file?download`}>
                          <Download className="size-4" />
                        </a>
                      </Button>
                      {canManage && (
                        <>
                          <Button variant="ghost" size="icon" disabled={pending} aria-label={t("documents.archive")} onClick={() => run(() => archiveDocumentAction(d.id, !archived))}>
                            {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => setRemoving(d)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("documents.deleteTitle")}
        text={removing?.name ?? ""}
        confirm={t("common.delete")}
        destructive
        onConfirm={() => {
          const d = removing;
          setRemoving(null);
          if (d) run(() => deleteDocumentAction(d.id));
        }}
      />
    </div>
  );
}
