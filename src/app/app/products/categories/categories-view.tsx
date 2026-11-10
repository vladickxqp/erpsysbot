"use client";

import { ArrowLeft, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";
import { deleteCategoryAction, saveCategoryAction, type CatalogResult } from "../catalog-actions";

type Category = { id: string; name: string; parentId: string | null; products: number };

export function CategoriesView({ categories }: { categories: Category[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<{ id: string | null; name: string; parentId: string | null } | null>(null);
  const [removing, setRemoving] = useState<Category | null>(null);
  const run = (work: () => Promise<CatalogResult>, done: () => void) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(t("common.saved"));
        done();
        router.refresh();
      } else toast.error(t(result.error ?? "common.error"));
    });
  const roots = categories.filter((c) => !c.parentId);
  const children = (id: string) => categories.filter((c) => c.parentId === id);
  // A category can sit below another top-level one, never below itself or its own children.
  const parents = editing ? roots.filter((c) => c.id !== editing.id && !(editing.id && children(editing.id).length)) : [];

  const row = (c: Category, child = false) => (
    <li key={c.id} className={child ? "ml-6" : undefined}>
      <div className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
        <Link href={`/app/products?category=${c.id}`} className="min-w-0 truncate font-medium hover:underline">
          {c.name}
        </Link>
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground tabular-nums">{t("catalog.count", { count: c.products })}</span>
          <Button variant="ghost" size="icon" aria-label={t("common.edit")} onClick={() => setEditing({ id: c.id, name: c.name, parentId: c.parentId })}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => setRemoving(c)}>
            <Trash2 className="size-4" />
          </Button>
        </span>
      </div>
    </li>
  );

  return (
    <>
      <Link href="/app/products" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("products.title")}
      </Link>
      <PageHeader
        title={t("catalog.categories")}
        actions={
          <Button onClick={() => setEditing({ id: null, name: "", parentId: null })}>
            <Plus className="size-4" /> {t("catalog.newCategory")}
          </Button>
        }
      />
      {categories.length === 0 ? (
        <EmptyState icon={FolderTree} title={t("catalog.noCategories")} />
      ) : (
        <ul className="grid max-w-2xl gap-2">
          {roots.map((c) => [row(c), ...children(c.id).map((x) => row(x, true))])}
        </ul>
      )}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing?.id ? editing.name || t("catalog.category") : t("catalog.newCategory")}</DialogTitle>
            <DialogDescription className="sr-only">{t("catalog.categories")}</DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => saveCategoryAction(editing.id, editing.name, editing.parentId), () => setEditing(null));
              }}
            >
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("products.name")}</span>
                <Input value={editing.name} maxLength={80} required autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </label>
              {parents.length > 0 && (
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("catalog.parent")}</span>
                  <Select value={editing.parentId ?? "none"} onValueChange={(v) => setEditing({ ...editing, parentId: v === "none" ? null : v })}>
                    <SelectTrigger className="w-full" aria-label={t("catalog.parent")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {parents.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("catalog.deleteCategory")}
        text={removing ? `${removing.name} · ${t("catalog.count", { count: removing.products })}` : ""}
        confirm={t("common.delete")}
        destructive
        onConfirm={() => removing && run(() => deleteCategoryAction(removing.id), () => setRemoving(null))}
      />
    </>
  );
}
