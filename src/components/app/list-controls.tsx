"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";

/** Change the list's URL parameters (search, filter, page) without a reload. */
export function useListParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in changes)) next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`));
  };
  return { params, go, pending };
}

export function SearchBox({ placeholder }: { placeholder: string }) {
  const { t } = useI18n();
  const { params, go } = useListParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const timer = setTimeout(() => go({ q: q.trim() || null }), 300);
    return () => clearTimeout(timer);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={t("common.search")} className="pl-8" />
    </div>
  );
}

/** A row of filter chips bound to one URL parameter. */
export function FilterChips({ name, options }: { name: string; options: { value: string | null; label: string }[] }) {
  const { params, go } = useListParams();
  const current = params.get(name);
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist">
      {options.map((o) => {
        const active = current === o.value || (!current && o.value === null);
        return (
          <Button
            key={o.value ?? "all"}
            type="button"
            role="tab"
            aria-selected={active}
            size="sm"
            variant={active ? "default" : "outline"}
            className="rounded-full"
            onClick={() => go({ [name]: o.value })}
          >
            {o.label}
          </Button>
        );
      })}
    </div>
  );
}

/** A column heading that sorts the list by this column, and the other way round on the next click. */
export function SortHead({ name, label, align }: { name: string; label: string; align?: "right" }) {
  const { params, go } = useListParams();
  const active = params.get("sort") === name;
  const asc = active && params.get("dir") === "asc";
  const Icon = !active ? ArrowUpDown : asc ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""}`}
      onClick={() => go({ sort: name, dir: active && !asc ? "asc" : "desc" })}
    >
      {label} <Icon className={`size-3 ${active ? "" : "opacity-40"}`} aria-hidden />
    </button>
  );
}

export function Pager({ page, pages, label }: { page: number; pages: number; label: string }) {
  const { t } = useI18n();
  const { go } = useListParams();
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>{label}</span>
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
  );
}
