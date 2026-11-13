"use client";

import { Check, Copy, ExternalLink, Plus, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { CHECKS_OF, REQUIRED_LEGAL_OF, type Section, type SiteKind, type SitePage, type Theme } from "@/lib/site";
import { STORE_PAGES, type Check as CheckName, type Design, type Pages, type Payments, type ShippingOption, type StorePage } from "@/lib/store";
import { parseMoney } from "@/server/money";
import {
  discardChangesAction,
  publishChangesAction,
  saveBasicsAction,
  savePagesAction,
  savePaymentsAction,
  saveShippingAction,
  setStoreStatusAction,
} from "../actions";
import { DeleteSite } from "../../sites/delete-site";
import { AiDialog } from "./ai-dialog";
import { Field, newId, Preview, useSave } from "./editor-ui";
import { PagesTab } from "./pages-tab";
import { SectionsEditor } from "./sections-tab";
import { ThemeTab } from "./theme-tab";

export type EditorStore = {
  id: string;
  kind: SiteKind;
  name: string;
  slug: string;
  status: string;
  /** Published, with edits visitors do not see yet. */
  changed: boolean;
  locale: string;
  contactEmail: string | null;
  categoryIds: string[];
  shipCountries: string[];
  design: Design;
  theme: Theme;
  blocks: Section[];
  customPages: SitePage[];
  pages: Pages;
  shipping: ShippingOption[];
  payments: Payments;
  stripe: { key: boolean; webhook: boolean; hint: string | null };
};

export type EditorProps = {
  store: EditorStore;
  checks: { passed: Record<CheckName, boolean>; missingPages: string[]; ready: boolean };
  images: { id: string; name: string }[];
  categories: { id: string; name: string; parentId: string | null }[];
  products: { id: string; name: string }[];
  webhookUrl: string | null;
  company: { iban: boolean; country: string };
  can: { settings: boolean; ai: boolean };
};

const TABS = {
  store: ["general", "design", "home", "pages", "legal", "shipping", "payment", "publish"],
  site: ["general", "design", "home", "pages", "legal", "publish"],
} as const;

export function StoreEditor(props: EditorProps & { openAi?: boolean }) {
  const { t } = useI18n();
  const { store, can } = props;
  const selling = store.kind === "store";
  const [tab, setTab] = useState<string>("general");
  const [ai, setAi] = useState(!!props.openAi && can.ai);
  const base = `/shop/${store.slug}`;
  // Where buttons and links of the site may lead: its own pages, the catalogue, the contact form.
  const links = [
    { value: "/", label: t("store.tab.home") },
    ...store.customPages.map((p) => ({ value: `/${p.slug}`, label: p.title })),
    ...(selling ? [{ value: "/products", label: t("store.shop.allProducts") }] : []),
    { value: "#contactForm", label: t("sites.type.contactForm") },
    { value: "#pricing", label: t("sites.type.pricing") },
  ];
  const common = { images: props.images, categories: props.categories, products: props.products, ai: can.ai, links };

  return (
    <>
      <PageHeader
        title={store.name}
        actions={
          <>
            <Badge variant={store.status === "PUBLISHED" ? "secondary" : "outline"} className={store.status === "PUBLISHED" ? "border-success/20 bg-success/10 text-success" : undefined}>
              {t(`store.status.${store.status}`)}
            </Badge>
            {store.changed && <ChangesBar storeId={store.id} canPublish={can.settings} />}
            {can.ai && (
              <Button size="sm" onClick={() => setAi(true)}>
                <Sparkles className="size-4" /> {t("sites.ai.open")}
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <a href={base} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> {t(selling ? "store.open" : "sites.open")}
              </a>
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="grid gap-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          {TABS[selling ? "store" : "site"].map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(key === "legal" ? "sites.tab.legal" : `store.tab.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* The editing tabs stay mounted while hidden: switching tabs keeps what is not saved yet. */}
        <TabsContent value="general" forceMount className="data-[state=inactive]:hidden">
          <General {...props} />
        </TabsContent>
        <TabsContent value="design" forceMount className="data-[state=inactive]:hidden">
          <ThemeTab storeId={store.id} name={store.name} theme={store.theme} logoId={store.design.logoId} tagline={store.design.tagline} images={props.images} />
        </TabsContent>
        <TabsContent value="home" forceMount className="data-[state=inactive]:hidden">
          <SectionsEditor storeId={store.id} kind={store.kind} page="home" initial={store.blocks} previewSrc={base} {...common} />
        </TabsContent>
        <TabsContent value="pages" forceMount className="data-[state=inactive]:hidden">
          <PagesTab storeId={store.id} kind={store.kind} slug={store.slug} pages={store.customPages} {...common} />
        </TabsContent>
        <TabsContent value="legal" forceMount className="data-[state=inactive]:hidden">
          <LegalTab {...props} />
        </TabsContent>
        {selling && (
          <>
            <TabsContent value="shipping" forceMount className="data-[state=inactive]:hidden">
              <ShippingTab {...props} />
            </TabsContent>
            <TabsContent value="payment" forceMount className="data-[state=inactive]:hidden">
              <PaymentTab {...props} />
            </TabsContent>
          </>
        )}
        <TabsContent value="publish">
          <PublishTab {...props} />
        </TabsContent>
      </Tabs>
      {can.ai && <AiDialog open={ai} onOpenChange={setAi} storeId={store.id} kind={store.kind} name={store.name} />}
    </>
  );
}

/** Edits of a published site wait here until they go online or are dropped. */
function ChangesBar({ storeId, canPublish }: { storeId: string; canPublish: boolean }) {
  const { t } = useI18n();
  const { pending, run } = useSave();
  return (
    <>
      <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
        {t("sites.changed")}
      </Badge>
      {canPublish && (
        <Button size="sm" disabled={pending} onClick={() => run(() => publishChangesAction(storeId))}>
          {t("sites.publishChanges")}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(t("sites.discardAsk"))) return;
          run(() => discardChangesAction(storeId), () => window.location.reload());
        }}
      >
        {t("sites.discard")}
      </Button>
    </>
  );
}

// --- General ------------------------------------------------------------------------------------

function General({ store, categories }: EditorProps) {
  const { t } = useI18n();
  const { pending, run } = useSave();
  const selling = store.kind === "store";
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
          {selling && (
            <Field label={t("store.shipCountries")} className="sm:col-span-2">
              <Input value={v.shipCountries} onChange={(e) => setV({ ...v, shipCountries: e.target.value.toUpperCase() })} placeholder="DE, AT" maxLength={300} />
            </Field>
          )}
          {selling && roots.length > 0 && (
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

// --- Legal pages and texts ------------------------------------------------------------------------

/** Pages a website shows (no shop terms beyond what the company wants to show). */
const SITE_PAGES: readonly StorePage[] = ["about", "contact", "imprint", "privacy", "terms"];

function LegalTab({ store, checks }: EditorProps) {
  const { t } = useI18n();
  const { pending, run } = useSave();
  const [pages, setPages] = useState<Pages>(store.pages);
  const required = new Set<string>(REQUIRED_LEGAL_OF[store.kind]);
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        {(store.kind === "store" ? STORE_PAGES : SITE_PAGES).map((p) => (
          <Field key={p} label={`${t(`store.page.${p}`)}${required.has(p) && checks.missingPages.includes(p) ? " *" : ""}`}>
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

function ShippingTab({ store }: EditorProps) {
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

function PaymentTab({ store, webhookUrl, company, can }: EditorProps) {
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

function PublishTab({ store, checks, can }: EditorProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useSave();
  const published = store.status === "PUBLISHED";
  const selling = store.kind === "store";
  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <div className="grid content-start gap-4">
        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm">
            {CHECKS_OF[store.kind].map((c) => (
              <div key={c} className="flex items-center gap-2">
                {checks.passed[c] ? <Check className="size-4 shrink-0 text-success" /> : <X className="size-4 shrink-0 text-destructive" />}
                <span>{t(c === "legal" && !selling ? "sites.check.legal" : `store.check.${c}`)}</span>
              </div>
            ))}
            {checks.missingPages.length > 0 && <span className="pl-6 text-xs text-muted-foreground">{checks.missingPages.map((p) => t(`store.page.${p}`)).join(", ")}</span>}
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
            <DeleteSite site={store} selling={selling} button onDeleted={() => router.push(selling ? "/app/store" : "/app/sites")} />
          </div>
        )}
      </div>
      <Preview src={`/shop/${store.slug}`} />
    </div>
  );
}
