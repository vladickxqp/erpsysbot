"use client";

import { Download, Plus, Search, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { EmptyState } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/client";
import { formatDate } from "@/i18n";
import { ClientDialog } from "./client-form";

export type ClientRow = {
  id: string;
  number: number;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  status: "LEAD" | "ACTIVE" | "INACTIVE";
  tags: string[];
  createdAt: string;
};

const STATUS_STYLE: Record<ClientRow["status"], string> = {
  ACTIVE: "bg-success/10 text-success border-success/20",
  LEAD: "bg-primary/10 text-primary border-primary/20",
  INACTIVE: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: ClientRow["status"] }) {
  const { t } = useI18n();
  return (
    <Badge variant="outline" className={STATUS_STYLE[status]}>
      {t(`clients.${status}`)}
    </Badge>
  );
}

export function ClientsView({
  rows,
  total,
  page,
  pages,
  canCreate,
}: {
  rows: ClientRow[];
  total: number;
  page: number;
  pages: number;
  canCreate: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [pending, start] = useTransition();

  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in changes)) next.delete("page");
    next.delete("new");
    start(() => router.replace(`${pathname}?${next.toString()}`));
  };

  // Search as one types, after a short pause.
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const timer = setTimeout(() => go({ q: q.trim() || null }), 300);
    return () => clearTimeout(timer);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = Boolean(params.get("q") || params.get("status"));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("clients.searchPlaceholder")}
            aria-label={t("common.search")}
            className="pl-8"
          />
        </div>
        <Select value={params.get("status") ?? "all"} onValueChange={(v) => go({ status: v === "all" ? null : v })}>
          <SelectTrigger className="w-[150px]" aria-label={t("clients.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            {(["ACTIVE", "LEAD", "INACTIVE"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {t(`clients.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.get("sort") ?? "newest"} onValueChange={(v) => go({ sort: v === "newest" ? null : v })}>
          <SelectTrigger className="w-[140px]" aria-label={t("common.sort")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t("clients.sortNewest")}</SelectItem>
            <SelectItem value="oldest">{t("clients.sortOldest")}</SelectItem>
            <SelectItem value="name">{t("clients.sortName")}</SelectItem>
            <SelectItem value="number">{t("clients.sortNumber")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" asChild>
            <a href="/app/clients/export" download>
              <Download className="size-4" /> <span className="hidden sm:inline">{t("common.export")}</span>
            </a>
          </Button>
          {canCreate && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> {t("clients.new")}
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? t("clients.noMatch") : t("clients.emptyTitle")}
          action={
            !filtered && canCreate ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" /> {t("clients.new")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">{t("clients.number")}</TableHead>
                  <TableHead>{t("clients.name")}</TableHead>
                  <TableHead>{t("clients.contact")}</TableHead>
                  <TableHead>{t("clients.city")}</TableHead>
                  <TableHead>{t("clients.status")}</TableHead>
                  <TableHead className="text-right">{t("clients.created")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/app/clients/${r.id}`)}>
                    <TableCell className="tabular-nums text-muted-foreground">{r.number}</TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/app/clients/${r.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                        {r.name}
                      </Link>
                      {r.tags.length > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">{r.tags.slice(0, 3).join(" · ")}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.email ?? r.phone ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.city ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatDate(r.createdAt, locale)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Mobile: cards */}
          <ul className="grid gap-2 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/app/clients/${r.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="truncate text-sm text-muted-foreground">{r.email ?? r.phone ?? r.city ?? `#${r.number}`}</div>
                  </div>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("clients.count", { count: total })}</span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>
                  {t("common.previous")}
                </Button>
                <span>{t("common.page", { page, pages })}</span>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => go({ page: String(page + 1) })}>
                  {t("common.next")}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {creating && <ClientDialog open onOpenChange={setCreating} />}
    </>
  );
}
