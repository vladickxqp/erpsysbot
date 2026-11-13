"use client";

import { ArrowDown, ArrowUp, FileText, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { MAX_PAGES, slugifyPage, type SiteKind, type SitePage } from "@/lib/site";
import { cn } from "@/lib/utils";
import { saveSitePagesAction } from "../actions";
import { useSave, type Images } from "./editor-ui";
import { SectionsEditor } from "./sections-tab";

type Props = {
  storeId: string;
  kind: SiteKind;
  slug: string;
  pages: SitePage[];
  links: { value: string; label: string }[];
  images: Images;
  categories: { id: string; name: string }[];
  products: { id: string; name: string }[];
  ai: boolean;
};

type Row = { id?: string; key: string; title: string; slug: string; inMenu: boolean };

/** The site's own pages: the list (titles, addresses, menu) and, for the chosen one, its sections. */
export function PagesTab({ storeId, kind, slug, pages, links, images, categories, products, ai }: Props) {
  const { t } = useI18n();
  const { pending, run } = useSave();
  const [rows, setRows] = useState<Row[]>(pages.map((p) => ({ id: p.id, key: p.id, title: p.title, slug: p.slug, inMenu: p.inMenu })));
  const [saved, setSaved] = useState<SitePage[]>(pages);
  const [chosen, setChosen] = useState<string | null>(pages[0]?.id ?? null);
  const [title, setTitle] = useState("");
  // The page as the server last sent it (props follow every save), or as just created.
  const page = pages.find((p) => p.id === chosen) ?? saved.find((p) => p.id === chosen) ?? null;

  const setRow = (key: string, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (index: number, by: number) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    setRows(next);
  };
  const save = (list: Row[]) =>
    run(
      () => saveSitePagesAction(storeId, list.map((r) => ({ id: r.id, title: r.title, slug: r.slug, inMenu: r.inMenu }))),
      (result) => {
        toast.success(t("common.saved"));
        const next = result.pages ?? [];
        setSaved(next);
        setRows(next.map((p) => ({ id: p.id, key: p.id, title: p.title, slug: p.slug, inMenu: p.inMenu })));
        if (!next.some((p) => p.id === chosen)) setChosen(next[next.length - 1]?.id ?? null);
      },
    );
  const add = () => {
    const name = title.trim();
    if (!name) return;
    const taken = new Set(rows.map((r) => r.slug));
    const row = { key: `new-${Date.now()}`, title: name, slug: slugifyPage(name, taken), inMenu: true };
    setTitle("");
    const list = [...rows, row];
    setRows(list);
    save(list);
  };

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-3 pt-6">
          {rows.map((r, i) => (
            <div key={r.key} className={cn("grid items-end gap-2 rounded-lg border p-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto_auto]", r.id && r.id === chosen && "border-primary/50 bg-primary/5")}>
              <Button type="button" variant={r.id && r.id === chosen ? "secondary" : "ghost"} size="icon" aria-label={t("sites.editPage")} disabled={!r.id} onClick={() => r.id && setChosen(r.id)}>
                <FileText className="size-4" />
              </Button>
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("sites.pageTitle")}</span>
                <Input value={r.title} onChange={(e) => setRow(r.key, { title: e.target.value })} maxLength={80} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("store.slug")}</span>
                <div className="flex items-center gap-1">
                  <span className="shrink-0 text-xs text-muted-foreground">/{slug}/</span>
                  <Input value={r.slug} onChange={(e) => setRow(r.key, { slug: e.target.value.toLowerCase() })} maxLength={40} />
                </div>
              </label>
              <label className="flex h-9 items-center gap-2 text-sm">
                <Checkbox checked={r.inMenu} onCheckedChange={(c) => setRow(r.key, { inMenu: c === true })} /> {t("sites.inMenu")}
              </label>
              <div className="flex">
                <Button type="button" variant="ghost" size="icon" aria-label={t("catalog.moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label={t("catalog.moveDown")} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("common.delete")}
                  onClick={() => {
                    if (r.id && !window.confirm(t("sites.deletePageAsk"))) return;
                    setRows(rows.filter((x) => x.key !== r.key));
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("sites.pageTitle")} aria-label={t("sites.pageTitle")} maxLength={80} className="w-full sm:w-72" />
            <Button type="submit" variant="outline" disabled={pending || !title.trim() || rows.length >= MAX_PAGES}>
              <Plus className="size-4" /> {t("sites.addPage")}
            </Button>
            {rows.length > 0 && (
              <Button type="button" className="ml-auto" disabled={pending} onClick={() => save(rows)}>
                {t("common.save")}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      {page && (
        <SectionsEditor
          key={page.id}
          storeId={storeId}
          kind={kind}
          page={page.id}
          initial={page.sections}
          previewSrc={`/shop/${slug}/${page.slug}`}
          links={links}
          images={images}
          categories={categories}
          products={products}
          ai={ai}
        />
      )}
    </div>
  );
}
