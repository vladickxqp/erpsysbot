"use client";

import { AlertTriangle, ChevronDown, Eye, FileCheck2, Pencil, Plus, Save, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { InvoicePaper, type PaperData, type PaperLine, type PaperSeller } from "@/components/app/invoice-paper";
import { blankLine, LineEditor, serialize, type EditableLine, type ProductOption } from "@/components/app/line-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { LOCALES, formatMoney, type Locale } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cityLine } from "@/lib/countries";
import { DEFAULT_STYLE, styleOf, taxFree, treatmentProblems, type InvoiceLayout, type TaxTreatment } from "@/lib/invoicing";
import { cn } from "@/lib/utils";
import { addDays, discountCents, lineList, parseMoney, totals } from "@/server/money";
import { quickClientAction, saveInvoiceAction, type InvoiceResult } from "./actions";

export type ClientOption = {
  id: string;
  name: string;
  number: number;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  vatId: string | null;
};

export type TemplateOption = {
  id: string;
  name: string;
  layout: InvoiceLayout;
  accentColor: string;
  language: string;
  footer: string | null;
  paymentInstructions: string | null;
  isDefault: boolean;
};

export type InvoiceFormValues = {
  id?: string;
  clientId: string;
  title: string;
  invoiceDate: string;
  serviceDate: string;
  serviceEndDate: string;
  dueDate: string;
  notes: string;
  lines: EditableLine[];
  currency?: string;
  exchangeRate?: string;
  taxTreatment: TaxTreatment;
  exemptionReason: string;
  language: string;
  templateId: string;
};

const num = (text: string) => Number(text.replace(/\s/g, "").replace(",", ".")) || 0;
const requestId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{n}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

/** Finds a customer by name, number or e-mail, from the keyboard too. */
function ClientPicker({ clients, onPick, onNew }: { clients: ClientOption[]; onPick: (id: string) => void; onNew?: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const found = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return clients.filter((c) => words.every((w) => `${c.name} ${c.email ?? ""} ${c.number} ${c.city ?? ""}`.toLowerCase().includes(w))).slice(0, 8);
  }, [clients, q]);
  return (
    <div className="flex gap-2">
      <div className="relative min-w-0 flex-1">
        <Input
          value={q}
          placeholder={t("invoicing.searchClient")}
          aria-label={t("invoicing.searchClient")}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, found.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter") {
              e.preventDefault();
              if (found[active]) onPick(found[active].id);
            } else return;
            e.preventDefault();
          }}
        />
        {open && found.length > 0 && (
          <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
            {found.map((c, index) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={cn("flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm", index === active && "bg-accent")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(c.id)}
                >
                  <span className="min-w-0 truncate">{c.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{c.city ?? `#${c.number}`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {onNew && (
        <Button type="button" variant="outline" onClick={onNew}>
          <Plus className="size-4" /> {t("invoicing.newClient")}
        </Button>
      )}
    </div>
  );
}

type ClientDraft = { firstName: string; lastName: string; companyName: string; email: string; street: string; postalCode: string; city: string; country: string; vatId: string };

/** A customer made or completed without leaving the invoice. */
function ClientDialog({
  client,
  country,
  onClose,
  onSaved,
}: {
  client: ClientOption | null;
  country: string;
  onClose: () => void;
  onSaved: (client: ClientOption) => void;
}) {
  const { t, locale } = useI18n();
  const [v, setV] = useState<ClientDraft>({
    firstName: client?.firstName ?? "",
    lastName: client?.lastName ?? "",
    companyName: client?.companyName ?? "",
    email: client?.email ?? "",
    street: client?.street ?? "",
    postalCode: client?.postalCode ?? "",
    city: client?.city ?? "",
    country: client?.country ?? country,
    vatId: client?.vatId ?? "",
  });
  const [pending, start] = useTransition();
  const regions = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const field = (name: keyof ClientDraft, span: string, props: React.ComponentProps<typeof Input> = {}) => (
    <Field label={t(`clients.${name === "companyName" ? "companyName" : name}`)} className={span}>
      <Input value={v[name]} onChange={(e) => setV({ ...v, [name]: e.target.value })} {...props} />
    </Field>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{client ? t("invoicing.editClient") : t("invoicing.newClient")}</DialogTitle>
          <DialogDescription className="sr-only">{t("invoicing.newClient")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            start(async () => {
              const result = await quickClientAction(client?.id ?? null, v);
              if (result.client) {
                if (result.existing) toast.message(t("invoicing.clientExists"));
                onSaved(result.client);
              } else toast.error(t(result.error === "forbidden" ? "common.forbidden" : "auth.check"));
            });
          }}
        >
          {field("companyName", "sm:col-span-6")}
          {field("firstName", "sm:col-span-3")}
          {field("lastName", "sm:col-span-3")}
          {field("street", "sm:col-span-6")}
          {field("postalCode", "sm:col-span-2")}
          {field("city", "sm:col-span-2")}
          <Field label={t("clients.country")} className="sm:col-span-2">
            <Input value={v.country} maxLength={2} onChange={(e) => setV({ ...v, country: e.target.value.toUpperCase() })} title={regions.of(v.country.length === 2 ? v.country : country)} />
          </Field>
          {field("email", "sm:col-span-3", { type: "email" })}
          {field("vatId", "sm:col-span-3")}
          <DialogFooter className="sm:col-span-6">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.loading") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InvoiceForm({
  initial,
  clients: knownClients,
  products,
  treatments,
  templates,
  seller,
  logoId,
  paymentTermsDays,
  today,
  canIssue,
  canCreateClient,
  canUpdateClient,
  defaultLanguage,
}: {
  initial?: Partial<InvoiceFormValues>;
  clients: ClientOption[];
  products: ProductOption[];
  treatments: TaxTreatment[];
  templates: TemplateOption[];
  seller: PaperSeller;
  logoId: string | null;
  paymentTermsDays: number;
  today: string;
  canIssue: boolean;
  canCreateClient: boolean;
  canUpdateClient: boolean;
  defaultLanguage: string;
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const standard = templates.find((x) => x.isDefault);
  const [v, setV] = useState<InvoiceFormValues>(() => ({
    clientId: "",
    title: "",
    invoiceDate: today,
    serviceDate: "",
    serviceEndDate: "",
    dueDate: "",
    notes: "",
    taxTreatment: treatments[0],
    exemptionReason: "",
    language: standard?.language ?? defaultLanguage,
    templateId: standard?.id ?? "",
    ...initial,
    lines: initial?.lines?.length ? initial.lines : [blankLine(region, locale)],
  }));
  const set = (patch: Partial<InvoiceFormValues>) => setV((old) => ({ ...old, ...patch }));
  const [clients, setClients] = useState(knownClients);
  const [dialog, setDialog] = useState<"new" | "edit" | null>(null);
  const [more, setMore] = useState(Boolean(initial?.serviceDate || initial?.notes || (initial?.currency && initial.currency !== region.currency)));
  const [showPaper, setShowPaper] = useState(false);
  const [pending, start] = useTransition();
  // One id per form: pressed twice, or sent again after a lost answer, it stays one invoice.
  const request = useRef(requestId());
  const draftId = useRef(initial?.id ?? null);

  const client = clients.find((c) => c.id === v.clientId) ?? null;
  const noTax = v.taxTreatment === "SMALL_BUSINESS" || taxFree(v.taxTreatment);
  const dueDate = v.dueDate || addDays(v.invoiceDate || today, paymentTermsDays);
  const currency = v.currency || region.currency;
  const money = (cents: number) => formatMoney(cents, locale, { ...region, currency });

  // Unfinished lines count as far as they go: the figures follow every key press.
  const paperLines: PaperLine[] = v.lines.map((l) => ({
    description: l.description,
    quantity: num(l.quantity),
    unit: l.unit,
    unitPriceCents: parseMoney(l.price) ?? 0,
    discountPercent: Math.min(Math.max(num(l.discountPercent), 0), 100),
    vatRate: taxFree(v.taxTreatment) ? 0 : l.vatRate,
  }));
  const sum = totals(paperLines, v.taxTreatment === "SMALL_BUSINESS");
  const discounts = discountCents(paperLines);
  const template = templates.find((x) => x.id === v.templateId);
  const paper: PaperData = {
    kind: "INVOICE",
    number: null,
    title: v.title || null,
    issueDate: v.invoiceDate || today,
    serviceDate: v.serviceDate || v.invoiceDate || today,
    serviceEndDate: v.serviceEndDate || null,
    dueDate,
    notes: v.notes || null,
    language: v.language,
    treatment: v.taxTreatment,
    reason: v.exemptionReason || null,
    currency,
    seller,
    buyer: client && { name: [client.companyName, [client.firstName, client.lastName].filter(Boolean).join(" ")].filter(Boolean).join("\n"), street: client.street, postalCode: client.postalCode, city: client.city, country: client.country },
    lines: paperLines,
    style: template ? styleOf(template) : DEFAULT_STYLE,
    logoId,
  };
  const problems = client ? treatmentProblems(v.taxTreatment, v.exemptionReason, { seller, buyer: client }) : [];

  const explain = (r: InvoiceResult) => {
    if (r.error === "forbidden") return t("common.forbidden");
    const fields = (prefix: string) => (r.missing ?? []).map((f) => t(`${prefix}${f}`)).join(", ");
    if (r.code === "COMPANY_INCOMPLETE") return t("invoices.companyIncomplete", { fields: fields("invoices.field_") });
    if (r.code === "CLIENT_INCOMPLETE") return t("invoicing.clientIncomplete", { fields: fields("invoices.field_") });
    if (r.code === "TAX_TREATMENT") return fields("invoicing.problem_");
    return t(r.error === "check" ? "auth.check" : "common.error");
  };

  const submit = (issue: boolean) =>
    start(async () => {
      const items = serialize(v.lines);
      if (!v.clientId || !items) {
        toast.error(t(!v.clientId ? "orders.chooseClient" : "lines.invalid"));
        return;
      }
      const result = await saveInvoiceAction(
        draftId.current,
        {
          clientId: v.clientId,
          title: v.title,
          invoiceDate: v.invoiceDate || null,
          serviceDate: v.serviceDate || null,
          serviceEndDate: v.serviceEndDate || null,
          dueDate: v.dueDate || null,
          notes: v.notes,
          items,
          currency: v.currency && v.currency !== region.currency ? v.currency : null,
          exchangeRate: v.exchangeRate ? Number(v.exchangeRate.replace(",", ".")) : null,
          taxTreatment: v.taxTreatment,
          exemptionReason: v.exemptionReason,
          language: v.language as Locale,
          templateId: v.templateId || null,
          requestId: request.current,
        },
        issue,
      );
      // Saved even if issuing failed: the next try works on the same draft.
      if (result.id) draftId.current = result.id;
      if (result.ok && result.id) {
        toast.success(t(issue ? "invoicing.generated" : "common.saved"));
        router.push(`/app/invoices/${result.id}`);
      } else toast.error(explain(result));
    });

  const taxLabel = (x: TaxTreatment) => t(`invoicing.treatment_${x}`);
  const summary = (
    <dl className="grid gap-1 text-sm">
      {discounts !== 0 && (
        <>
          <Sum label={t("invoicing.subtotal")} value={money(paperLines.reduce((all, l) => all + lineList(l), 0))} />
          <Sum label={t("invoicing.discounts")} value={money(-discounts)} />
        </>
      )}
      <Sum label={t("invoicing.net")} value={money(sum.netCents)} />
      {!noTax && sum.byRate.map((g) => <Sum key={g.rate} label={t("lines.vatOn", { rate: g.rate })} value={money(g.vatCents)} />)}
      {noTax && <Sum label={t("invoicing.vatTotal")} value={money(0)} />}
      <div className="mt-1 flex justify-between gap-6 border-t pt-2 text-base font-semibold">
        <dt>{t("invoicing.amountDue")}</dt>
        <dd className="tabular-nums" data-testid="invoice-total">
          {money(sum.grossCents)}
        </dd>
      </div>
    </dl>
  );
  const actions = (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => submit(false)}>
        <Save className="size-4" /> {t("invoicing.saveDraft")}
      </Button>
      {canIssue && (
        <Button type="button" disabled={pending} onClick={() => submit(true)}>
          <FileCheck2 className="size-4" /> {pending ? t("common.loading") : t("invoicing.generate")}
        </Button>
      )}
    </div>
  );

  return (
    <form
      className="grid items-start gap-4 pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)] lg:pb-0"
      onSubmit={(e) => {
        e.preventDefault();
        submit(canIssue);
      }}
    >
      <div className="grid min-w-0 gap-4">
        <Step n={1} title={t("invoicing.stepClient")}>
          {clients.length === 0 && !canCreateClient ? (
            <Link href="/app/clients?new=1" className="text-sm text-primary hover:underline">
              {t("orders.noClients")}
            </Link>
          ) : client ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{client.name}</div>
                <div className="truncate text-muted-foreground">{[client.street, cityLine(client)].filter(Boolean).join(", ") || t("invoicing.noAddress")}</div>
                <div className="truncate text-muted-foreground">{client.email ?? t("invoicing.noEmail")}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                {canUpdateClient && (
                  <Button type="button" variant="ghost" size="icon" aria-label={t("invoicing.editClient")} onClick={() => setDialog("edit")}>
                    <Pencil className="size-4" />
                  </Button>
                )}
                <Button type="button" variant="ghost" size="icon" aria-label={t("invoicing.changeClient")} onClick={() => set({ clientId: "" })}>
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <ClientPicker clients={clients} onPick={(clientId) => set({ clientId })} onNew={canCreateClient ? () => setDialog("new") : undefined} />
          )}
        </Step>

        <Step n={2} title={t("invoicing.stepItems")}>
          <div className="grid gap-3">
            <Field label={t("invoicing.invoiceTitle")}>
              <Input value={v.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <LineEditor lines={v.lines} onChange={(lines) => set({ lines })} products={products} smallBusiness={noTax} hideTotals />
          </div>
        </Step>

        <Step n={3} title={t("invoicing.stepTax")}>
          <div className="grid gap-3 sm:grid-cols-2">
            {treatments.length > 1 ? (
              <Field label={t("invoicing.treatment")} className={v.taxTreatment === "EXEMPT" || v.taxTreatment === "NOT_TAXABLE" ? "" : "sm:col-span-2"}>
                <Select value={v.taxTreatment} onValueChange={(value) => set({ taxTreatment: value as TaxTreatment })}>
                  <SelectTrigger className="w-full" aria-label={t("invoicing.treatment")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {treatments.map((x) => (
                      <SelectItem key={x} value={x}>
                        {taxLabel(x)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <div className="rounded-lg border bg-background p-3 text-sm sm:col-span-2">{taxLabel(treatments[0])}</div>
            )}
            {(v.taxTreatment === "EXEMPT" || v.taxTreatment === "NOT_TAXABLE") && (
              <Field label={t("invoicing.treatmentReason")}>
                <Input value={v.exemptionReason} maxLength={300} placeholder={v.taxTreatment === "EXEMPT" ? "§ 4 Nr. 14 UStG" : "§ 3a Abs. 2 UStG"} onChange={(e) => set({ exemptionReason: e.target.value })} />
              </Field>
            )}
            {problems.length > 0 && (
              <p role="alert" className="flex items-center gap-2 text-sm text-warning sm:col-span-2">
                <AlertTriangle className="size-4 shrink-0" /> {problems.map((p) => t(`invoicing.problem_${p}`)).join(" · ")}
              </p>
            )}
          </div>
        </Step>

        <Step n={4} title={t("invoicing.stepDetails")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("invoicing.invoiceDate")}>
              <Input type="date" value={v.invoiceDate} onChange={(e) => set({ invoiceDate: e.target.value })} required />
            </Field>
            <Field label={t("invoices.dueDate")}>
              <Input type="date" value={dueDate} min={v.invoiceDate} onChange={(e) => set({ dueDate: e.target.value })} />
            </Field>
            {templates.length > 0 && (
              <Field label={t("invoicing.template")}>
                <Select
                  value={v.templateId || "none"}
                  onValueChange={(id) => {
                    const chosen = templates.find((x) => x.id === id);
                    set({ templateId: chosen?.id ?? "", ...(chosen ? { language: chosen.language } : {}) });
                  }}
                >
                  <SelectTrigger className="w-full" aria-label={t("invoicing.template")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* With a default template there is no going without one: it is what "none" gets. */}
                    {!standard && <SelectItem value="none">{t("invoicing.builtIn")}</SelectItem>}
                    {templates.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label={t("invoicing.language")}>
              <Select value={v.language} onValueChange={(language) => set({ language })}>
                <SelectTrigger className="w-full" aria-label={t("invoicing.language")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {new Intl.DisplayNames([l], { type: "language" }).of(l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Button type="button" variant="ghost" size="sm" className="mt-3 -ml-2" aria-expanded={more} onClick={() => setMore(!more)}>
            <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} /> {t("invoicing.more")}
          </Button>
          {more && (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label={t("invoices.serviceDate")}>
                <Input type="date" value={v.serviceDate} onChange={(e) => set({ serviceDate: e.target.value })} />
              </Field>
              <Field label={t("invoicing.serviceEnd")}>
                <Input type="date" value={v.serviceEndDate} min={v.serviceDate || undefined} onChange={(e) => set({ serviceEndDate: e.target.value })} />
              </Field>
              <Field label={t("company.currency")}>
                <Input value={v.currency ?? region.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase().slice(0, 3) })} />
              </Field>
              {currency !== region.currency && (
                <Field label={t("invoices.rate", { from: currency, to: region.currency })}>
                  <Input inputMode="decimal" value={v.exchangeRate ?? ""} onChange={(e) => set({ exchangeRate: e.target.value })} required />
                </Field>
              )}
              <Field label={t("invoices.notes")} className="sm:col-span-2">
                <Textarea rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </div>
          )}
        </Step>
      </div>

      <aside className="hidden gap-4 lg:sticky lg:top-4 lg:grid">
        <InvoicePaper data={paper} />
        <Card>
          <CardContent className="grid gap-4 pt-6">
            {summary}
            {actions}
          </CardContent>
        </Card>
      </aside>

      {/* Sits on top of the app's tab bar. */}
      <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 border-t bg-background/95 p-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{t("invoicing.amountDue")}</div>
            <div className="truncate font-semibold tabular-nums">{money(sum.grossCents)}</div>
          </div>
          <Button type="button" variant="outline" onClick={() => setShowPaper(true)}>
            <Eye className="size-4" /> {t("invoicing.preview")}
          </Button>
        </div>
      </div>
      <Sheet open={showPaper} onOpenChange={setShowPaper}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("invoicing.preview")}</SheetTitle>
            <SheetDescription className="sr-only">{t("invoicing.preview")}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-4 pb-4">
            <InvoicePaper data={paper} />
            {summary}
            {actions}
          </div>
        </SheetContent>
      </Sheet>

      {dialog && (
        <ClientDialog
          client={dialog === "edit" ? client : null}
          country={region.country}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setClients((all) => [...all.filter((c) => c.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
            set({ clientId: saved.id });
            setDialog(null);
          }}
        />
      )}
    </form>
  );
}

function Sum({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
