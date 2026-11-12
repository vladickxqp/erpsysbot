"use client";

import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Monitor, Plus, Smartphone, Tablet, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, LOCALES } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { BLOCK_TYPES, CHECKS, STORE_PAGES, TEMPLATES, type Block, type BlockType, type Check as CheckName, type Design, type Pages, type Payments, type ShippingOption } from "@/lib/store";
import { parseMoney } from "@/server/money";
import {
  deleteStoreAction,
  saveBasicsAction,
  saveBlocksAction,
  saveDesignAction,
  savePagesAction,
  savePaymentsAction,
  saveShippingAction,
  setStoreStatusAction,
  type StoreResult,
} from "../actions";

export type EditorStore = {
  id: string;
  name: string;
  slug: string;
  status: string;
  locale: string;
  contactEmail: string | null;
  categoryIds: string[];
  shipCountries: string[];
  design: Design;
  blocks: Block[];
  pages: Pages;
  shipping: ShippingOption[];
  payments: Payments;
  stripe: { key: boolean; webhook: boolean; hint: string | null };
};

type Props = {
  store: EditorStore;
  checks: { passed: Record<CheckName, boolean>; missingPages: string[]; ready: boolean };
  images: { id: string; name: string }[];
  categories: { id: string; name: string; parentId: string | null }[];
  products: { id: string; name: string }[];
  webhookUrl: string | null;
  company: { iban: boolean; country: string };
  can: { settings: boolean };
};

function useSave() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (work: () => Promise<StoreResult>, then?: (r: StoreResult) => void) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        if (then) then(result);
        else toast.success(t("common.saved"));
        router.refresh();
      } else toast.error([t(result.error ?? "common.error"), ...(result.failed ?? []).map((c) => t(`store.check.${c}`))].join(" · "));
    });
  return { pending, run };
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

const thumb = (id: string) => `/app/documents/${id}/file`;
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `b${Date.now()}${Math.random().toString(36).slice(2)}`);

export function StoreEditor(props: Props) {
  const { t } = useI18n();
  const { store } = props;
  return (
    <>
      <PageHeader
        title={store.name}
        actions={
          <>
            <Badge variant={store.status === "PUBLISHED" ? "secondary" : "outline"} className={store.status === "PUBLISHED" ? "border-success/20 bg-success/10 text-success" : undefined}>
              {t(`store.status.${store.status}`)}
            </Badge>
            <Button variant="outline" size="sm" asChild>
              <a href={`/shop/${store.slug}`} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> {t("store.open")}
              </a>
            </Button>
          </>
        }
      />
      <Tabs defaultValue="general" className="grid gap-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          {(["general", "design", "home", "pages", "shipping", "payment", "publish"] as const).map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`store.tab.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          <General {...props} />
        </TabsContent>
        <TabsContent value="design">
          <DesignTab {...props} />
        </TabsContent>
        <TabsContent value="home">
          <HomeTab {...props} />
        </TabsContent>
        <TabsContent value="pages">
          <PagesTab {...props} />
        </TabsContent>
        <TabsContent value="shipping">
          <ShippingTab {...props} />
        </TabsContent>
        <TabsContent value="payment">
          <PaymentTab {...props} />
        </TabsContent>
        <TabsContent value="publish">
          <PublishTab {...props} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// --- General ------------------------------------------------------------------------------------

function General({ store, categories }: Props) {
  const { t } = useI18n();
  const { pending, run } = useSave();
  const [v, setV] = useState({
    name: store.name,
    slug: store.slug,
    locale: store.locale,
    contactEmail: store.contactEmail ?? "",
    categoryIds: store.categoryIds,
    shipCountries: store.shipCountries.join(", "),
  });
  const toggle = (id: string) => setV({ ...v, categoryIds: v.categoryIds.includes(id) ? v.categoryIds.filter((c) => c !== id) : [...v.categoryIds, id] });
  const roots = categories.filter((c) => !c.parentId);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          saveBasicsAction(store.id, {
            name: v.name,
            slug: v.slug,
            locale: v.locale,
            contactEmail: v.contactEmail || null,
            categoryIds: v.categoryIds,
            shipCountries: v.shipCountries
              .split(/[\s,;]+/)
              .map((c) => c.trim())
              .filter(Boolean),
          }),
        );
      }}
    >
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <Field label={t("store.name")}>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required maxLength={120} />
          </Field>
          <Field label={t("store.slug")}>
            <div className="flex items-center gap-1">
              <span className="shrink-0 text-sm text-muted-foreground">/shop/</span>
              <Input value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase() })} required maxLength={40} pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" />
            </div>
          </Field>
          <Field label={t("store.language")}>
            <Select value={v.locale} onValueChange={(locale) => setV({ ...v, locale })}>
              <SelectTrigger className="w-full" aria-label={t("store.language")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("store.contactEmail")}>
            <Input type="email" value={v.contactEmail} onChange={(e) => setV({ ...v, contactEmail: e.target.value })} maxLength={200} />
          </Field>
          <Field label={t("store.shipCountries")} className="sm:col-span-2">
            <Input value={v.shipCountries} onChange={(e) => setV({ ...v, shipCountries: e.target.value.toUpperCase() })} placeholder="DE, AT" maxLength={300} />
          </Field>
          {roots.length > 0 && (
            <fieldset className="grid gap-2 sm:col-span-2">
              <legend className="mb-1 text-sm font-medium">{t("store.categories")}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {roots.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={v.categoryIds.includes(c.id)} onCheckedChange={() => toggle(c.id)} /> {c.name}
                  </label>
                ))}
              </div>
              {!v.categoryIds.length && <span className="text-xs text-muted-foreground">{t("store.allCategories")}</span>}
            </fieldset>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {t("common.save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

// --- Design -------------------------------------------------------------------------------------

function ImagePick({ value, onChange, images, label }: { value: string | null; onChange: (id: string | null) => void; images: Props["images"]; label: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb(value)} alt="" className="size-14 rounded-md border object-cover" />
      ) : (
        <div className="size-14 rounded-md border bg-muted" />
      )}
      <Select value={value ?? "none"} onValueChange={(id) => onChange(id === "none" ? null : id)}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("store.noImage")}</SelectItem>
          {images.map((img) => (
            <SelectItem key={img.id} value={img.id}>
              {img.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DesignTab({ store, images }: Props) {
  const { t } = useI18n();
  const { pending, run } = useSave();
  const [d, setD] = useState<Design>(store.design);
  return (
    <Card>
      <CardContent className="grid gap-5 pt-6">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t("store.template")}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl}
                type="button"
                aria-pressed={d.template === tpl}
                onClick={() => setD({ ...d, template: tpl })}
                className={cn("grid gap-2 rounded-lg border p-3 text-left text-sm", d.template === tpl && "border-primary ring-2 ring-primary/30")}
              >
                <span
                  className={cn("h-16 w-full border", tpl === "bold" ? "rounded-none" : tpl === "soft" ? "rounded-2xl bg-stone-50" : "rounded-md bg-white")}
                  style={tpl === "bold" ? { background: d.primary } : undefined}
                />
                {t(`store.templates.${tpl}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("store.primary")}>
            <div className="flex items-center gap-2">
              <input type="color" value={d.primary} onChange={(e) => setD({ ...d, primary: e.target.value })} className="h-9 w-12 cursor-pointer rounded border" aria-label={t("store.primary")} />
              <Input value={d.primary} onChange={(e) => setD({ ...d, primary: e.target.value })} maxLength={7} className="w-28 font-mono" />
            </div>
          </Field>
          <Field label={t("store.accent")}>
            <div className="flex items-center gap-2">
              <input type="color" value={d.accent} onChange={(e) => setD({ ...d, accent: e.target.value })} className="h-9 w-12 cursor-pointer rounded border" aria-label={t("store.accent")} />
              <Input value={d.accent} onChange={(e) => setD({ ...d, accent: e.target.value })} maxLength={7} className="w-28 font-mono" />
            </div>
          </Field>
          <Field label={t("store.logo")}>
            <ImagePick value={d.logoId} onChange={(logoId) => setD({ ...d, logoId })} images={images} label={t("store.logo")} />
          </Field>
          <Field label={t("store.tagline")}>
            <Input value={d.tagline} onChange={(e) => setD({ ...d, tagline: e.target.value })} maxLength={160} />
          </Field>
        </div>
        <div>
          <Button type="button" disabled={pending} onClick={() => run(() => saveDesignAction(store.id, d))}>
            {t("common.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Home page ----------------------------------------------------------------------------------

function HomeTab({ store, images, categories, products }: Props) {
  const { t } = useI18n();
  const { pending, run } = useSave();
  const [blocks, setBlocks] = useState<Block[]>(store.blocks);
  const [adding, setAdding] = useState<BlockType>("text");
  const set = (id: string, patch: Partial<Block>) => setBlocks(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (index: number, by: number) => {
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setBlocks(next);
  };
  return (
    <div className="grid gap-3">
      {blocks.map((b, i) => (
        <Card key={b.id}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm">{t(`store.block.${b.type}`)}</CardTitle>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="icon" aria-label={t("catalog.moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t("catalog.moveDown")} disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => setBlocks(blocks.filter((x) => x.id !== b.id))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label={t("store.blockTitle")} className={b.type === "categories" || b.type === "contact" ? "sm:col-span-2" : undefined}>
              <Input value={b.title ?? ""} onChange={(e) => set(b.id, { title: e.target.value })} maxLength={160} />
            </Field>
            {b.type === "hero" && (
              <Field label={t("store.buttonLabel")}>
                <Input value={b.buttonLabel ?? ""} onChange={(e) => set(b.id, { buttonLabel: e.target.value })} maxLength={40} />
              </Field>
            )}
            {(b.type === "hero" || b.type === "text" || b.type === "imageText" || b.type === "contact") && (
              <Field label={t("store.blockText")} className="sm:col-span-2">
                <Textarea rows={4} value={b.text ?? ""} onChange={(e) => set(b.id, { text: e.target.value })} maxLength={4000} />
              </Field>
            )}
            {(b.type === "hero" || b.type === "imageText") && (
              <Field label={t("store.image")} className="sm:col-span-2">
                <ImagePick value={b.imageId ?? null} onChange={(imageId) => set(b.id, { imageId })} images={images} label={t("store.image")} />
              </Field>
            )}
            {b.type === "products" && (
              <>
                <Field label={t("store.category")}>
                  <Select value={b.categoryId ?? "all"} onValueChange={(c) => set(b.id, { categoryId: c === "all" ? null : c })}>
                    <SelectTrigger className="w-full" aria-label={t("store.category")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("store.newest")}</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("store.limit")}>
                  <Input type="number" min={1} max={24} value={b.limit ?? 8} onChange={(e) => set(b.id, { limit: Number(e.target.value) || 8 })} />
                </Field>
                <div className="grid gap-2 sm:col-span-2">
                  <span className="text-sm font-medium">{t("store.chosenProducts")}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(b.productIds ?? []).map((pid) => (
                      <Badge key={pid} variant="secondary" className="gap-1">
                        {products.find((p) => p.id === pid)?.name ?? "?"}
                        <button type="button" aria-label={t("common.delete")} onClick={() => set(b.id, { productIds: (b.productIds ?? []).filter((x) => x !== pid) })}>
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <Select value="" onValueChange={(pid) => set(b.id, { productIds: [...new Set([...(b.productIds ?? []), pid])].slice(0, 24) })}>
                    <SelectTrigger className="w-full sm:w-80" aria-label={t("store.addProduct")}>
                      <SelectValue placeholder={t("store.addProduct")} />
                    </SelectTrigger>
                    <SelectContent>
                      {products
                        .filter((p) => !(b.productIds ?? []).includes(p.id))
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={adding} onValueChange={(v) => setAdding(v as BlockType)}>
          <SelectTrigger className="w-56" aria-label={t("store.blockType")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BLOCK_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`store.block.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          disabled={blocks.length >= 20}
          onClick={() => setBlocks([...blocks, { id: newId(), type: adding, title: "", text: "", productIds: [], categoryId: null, limit: 8, imageId: null, buttonLabel: "" }])}
        >
          <Plus className="size-4" /> {t("store.addBlock")}
        </Button>
        <Button type="button" className="ml-auto" disabled={pending} onClick={() => run(() => saveBlocksAction(store.id, blocks))}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

// --- Pages --------------------------------------------------------------------------------------

function PagesTab({ store, checks }: Props) {
  const { t } = useI18n();
  const { pending, run } = useSave();
  const [pages, setPages] = useState<Pages>(store.pages);
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        {STORE_PAGES.map((p) => (
          <Field key={p} label={`${t(`store.page.${p}`)}${checks.missingPages.includes(p) ? " *" : ""}`}>
            <Textarea rows={p === "about" || p === "contact" || p === "shipping" ? 4 : 8} value={pages[p]} onChange={(e) => setPages({ ...pages, [p]: e.target.value })} maxLength={30000} />
          </Field>
        ))}
        <div>
          <Button type="button" disabled={pending} onClick={() => run(() => savePagesAction(store.id, pages))}>
            {t("common.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Shipping -----------------------------------------------------------------------------------

function ShippingTab({ store }: Props) {
  const { t, locale, region } = useI18n();
  const { pending, run } = useSave();
  const cents = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2).replace(".", locale === "en" ? "." : ","));
  const [rows, setRows] = useState(store.shipping.map((o) => ({ id: o.id, name: o.name, price: cents(o.priceCents), freeFrom: cents(o.freeFromCents) })));
  const save = () => {
    const options = rows.map((r) => ({ id: r.id, name: r.name, priceCents: parseMoney(r.price || "0") ?? -1, freeFromCents: r.freeFrom.trim() ? (parseMoney(r.freeFrom) ?? -1) : null }));
    if (options.some((o) => o.priceCents < 0 || (o.freeFromCents !== null && o.freeFromCents < 0) || !o.name.trim())) return toast.error(t("auth.check"));
    run(() => saveShippingAction(store.id, options));
  };
  return (
    <Card>
      <CardContent className="grid gap-3 pt-6">
        {rows.map((r, i) => (
          <div key={r.id} className="grid items-end gap-2 sm:grid-cols-[1fr_140px_160px_auto]">
            <Field label={t("store.shippingName")}>
              <Input value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} maxLength={80} />
            </Field>
            <Field label={t("store.shippingPrice")}>
              <Input inputMode="decimal" value={r.price} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} placeholder={formatMoney(0, locale, region)} />
            </Field>
            <Field label={t("store.freeFrom")}>
              <Input inputMode="decimal" value={r.freeFrom} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, freeFrom: e.target.value } : x)))} />
            </Field>
            <Button type="button" variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={rows.length >= 10} onClick={() => setRows([...rows, { id: newId(), name: "", price: "", freeFrom: "" }])}>
            <Plus className="size-4" /> {t("store.addShipping")}
          </Button>
          <Button type="button" disabled={pending} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Payment ------------------------------------------------------------------------------------

function PaymentTab({ store, webhookUrl, company, can }: Props) {
  const { t } = useI18n();
  const { pending, run } = useSave();
  const [bank, setBank] = useState(store.payments.bank);
  const [stripe, setStripe] = useState(store.payments.stripe || (store.stripe.key && store.stripe.webhook));
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const disabled = !can.settings;
  const save = (removeStripe = false) =>
    run(
      () => savePaymentsAction(store.id, { bank, stripe: removeStripe ? false : stripe, secretKey: secretKey || undefined, webhookSecret: webhookSecret || undefined, removeStripe }),
      () => {
        setSecretKey("");
        setWebhookSecret("");
        toast.success(t("common.saved"));
      },
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("store.method.bank")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox checked={bank} onCheckedChange={(c) => setBank(c === true)} disabled={disabled} /> {t("store.offer")}
          </label>
          {!company.iban && (
            <Link href="/app/settings" className="w-fit text-destructive hover:underline">
              {t("store.ibanMissing")}
            </Link>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t("store.method.stripe")}</CardTitle>
          {store.stripe.hint && <Badge variant="outline">{store.stripe.hint}</Badge>}
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox checked={stripe} onCheckedChange={(c) => setStripe(c === true)} disabled={disabled} /> {t("store.offer")}
          </label>
          <Field label={`${t("store.secretKey")}${store.stripe.key ? ` · ${t("store.isSet")}` : ""}`}>
            <Input type="password" autoComplete="off" value={secretKey} onChange={(e) => setSecretKey(e.target.value.trim())} placeholder="sk_…" disabled={disabled} />
          </Field>
          <Field label={`${t("store.webhookSecret")}${store.stripe.webhook ? ` · ${t("store.isSet")}` : ""}`}>
            <Input type="password" autoComplete="off" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value.trim())} placeholder="whsec_…" disabled={disabled} />
          </Field>
          {webhookUrl && (
            <div className="grid gap-1">
              <span className="font-medium">{t("store.webhookUrl")}</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{webhookUrl}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("store.copy")}
                  onClick={() => {
                    void navigator.clipboard.writeText(webhookUrl).then(() => toast.success(t("store.copied")));
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">checkout.session.completed · checkout.session.async_payment_succeeded · checkout.session.async_payment_failed · checkout.session.expired · charge.refunded</span>
            </div>
          )}
          {(store.stripe.key || store.stripe.webhook) && (
            <Button type="button" variant="ghost" className="w-fit text-destructive hover:text-destructive" disabled={disabled || pending} onClick={() => save(true)}>
              {t("store.removeStripe")}
            </Button>
          )}
        </CardContent>
      </Card>
      <div className="lg:col-span-2">
        <Button type="button" disabled={disabled || pending} onClick={() => save()}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

// --- Publish ------------------------------------------------------------------------------------

const DEVICES = [
  { key: "desktop", width: "100%", icon: Monitor },
  { key: "tablet", width: "768px", icon: Tablet },
  { key: "mobile", width: "390px", icon: Smartphone },
] as const;

function PublishTab({ store, checks, can }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useSave();
  const [device, setDevice] = useState<(typeof DEVICES)[number]["key"]>("desktop");
  const published = store.status === "PUBLISHED";
  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <div className="grid content-start gap-4">
        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm">
            {CHECKS.map((c) => (
              <div key={c} className="flex items-center gap-2">
                {checks.passed[c] ? <Check className="size-4 text-success" /> : <X className="size-4 text-destructive" />}
                <span>{t(`store.check.${c}`)}</span>
              </div>
            ))}
            {checks.missingPages.length > 0 && (
              <span className="pl-6 text-xs text-muted-foreground">{checks.missingPages.map((p) => t(`store.page.${p}`)).join(", ")}</span>
            )}
          </CardContent>
        </Card>
        {can.settings && (
          <div className="flex flex-wrap gap-2">
            {published ? (
              <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => setStoreStatusAction(store.id, "UNPUBLISHED"))}>
                {t("store.unpublish")}
              </Button>
            ) : (
              <Button type="button" disabled={pending || !checks.ready} onClick={() => run(() => setStoreStatusAction(store.id, "PUBLISHED"))}>
                {t("store.publish")}
              </Button>
            )}
            {!published && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(t("store.deleteAsk"))) return;
                  run(() => deleteStoreAction(store.id), () => router.push("/app/store"));
                }}
              >
                <Trash2 className="size-4" /> {t("common.delete")}
              </Button>
            )}
          </div>
        )}
      </div>
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t("store.preview")}</CardTitle>
          <div className="flex gap-1" role="radiogroup" aria-label={t("store.preview")}>
            {DEVICES.map((d) => (
              <Button key={d.key} type="button" variant={device === d.key ? "secondary" : "ghost"} size="icon" role="radio" aria-checked={device === d.key} aria-label={t(`store.device.${d.key}`)} onClick={() => setDevice(d.key)}>
                <d.icon className="size-4" />
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex justify-center bg-muted/40 p-3">
          <iframe
            key={device}
            title={t("store.preview")}
            src={`/shop/${store.slug}`}
            className="h-[70vh] rounded-md border bg-white"
            style={{ width: DEVICES.find((d) => d.key === device)!.width, maxWidth: "100%" }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
