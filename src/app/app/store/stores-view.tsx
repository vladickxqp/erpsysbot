"use client";

import { ExternalLink, Plus, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { DeleteSite } from "../sites/delete-site";
import { createStoreAction } from "./actions";

type Row = { id: string; name: string; slug: string; status: string };

export function StoresView({ stores, canDelete = false }: { stores: Row[]; canDelete?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      const result = await createStoreAction(name);
      if (result.ok && result.id) router.push(`/app/store/${result.id}`);
      else toast.error(t(result.error ?? "common.error"));
    });

  return (
    <div className="grid gap-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("store.name")} aria-label={t("store.name")} maxLength={120} className="w-full sm:w-72" />
        <Button type="submit" disabled={pending || !name.trim()}>
          <Plus className="size-4" /> {t("store.new")}
        </Button>
      </form>
      {stores.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((s) => (
            <Card key={s.id}>
              <CardContent className="grid gap-3 pt-6">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/app/store/${s.id}`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                    <Store className="size-4 shrink-0" />
                    <span className="truncate">{s.name}</span>
                  </Link>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={s.status === "PUBLISHED" ? "secondary" : "outline"} className={s.status === "PUBLISHED" ? "border-success/20 bg-success/10 text-success" : undefined}>
                      {t(`store.status.${s.status}`)}
                    </Badge>
                    {canDelete && <DeleteSite site={s} selling />}
                  </div>
                </div>
                <a href={`/shop/${s.slug}`} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
                  /shop/{s.slug} <ExternalLink className="size-3.5" />
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
