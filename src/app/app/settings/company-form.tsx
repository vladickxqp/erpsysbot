"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { US_STATE_TAX } from "@/lib/us-tax";
import { countryProfile } from "@/lib/countries";
import { INVOICE_FILE_KINDS, type InvoiceFileKind } from "@/lib/invoicing";
import { saveCompanyAction } from "./actions";

export type CompanyValues = {
  name: string;
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  vatId: string;
  taxNumber: string;
  email: string;
  phone: string;
  website: string;
  iban: string;
  bic: string;
  bankName: string;
  currency: string;
  taxRates: string;
  smallBusiness: boolean;
  paymentTermsDays: number;
  invoiceNumberFormat: string;
  creditNoteNumberFormat: string;
  quoteNumberFormat: string;
  invoiceFooter: string;
  einvoiceFormat: InvoiceFileKind;
};

export function CompanyForm({
  initial,
  country,
  countryName,
  currencyLocked,
  canEdit,
}: {
  initial: CompanyValues;
  country: string;
  countryName: string;
  currencyLocked: boolean;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const profile = countryProfile(country);
  const currencies = useMemo(() => Intl.supportedValuesOf("currency"), []);
  // The country's own names for its numbers (EIN, ЄДРПОУ …), else the general ones.
  const label: Partial<Record<keyof CompanyValues, string>> = {
    vatId: profile.vatIdLabel ?? t("company.vatIdGeneral"),
    taxNumber: profile.taxNumberLabel ?? t("company.taxNumberGeneral"),
    ...(profile.iban ? {} : { iban: t("company.accountNumber"), bic: profile.bankCodeLabel ?? t("company.bankCode") }),
  };
  if (country === "DE") Object.assign(label, { vatId: t("company.vatId"), taxNumber: t("company.taxNumber") });
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [bad, setBad] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const field = (name: keyof CompanyValues, span = "", extra: React.ComponentProps<typeof Input> = {}) => (
    <label className={`grid gap-1.5 ${span}`}>
      <span className="text-sm font-medium">{label[name] ?? t(`company.${name}`)}</span>
      <Input
        value={String(v[name] ?? "")}
        onChange={(e) => setV({ ...v, [name]: e.target.value })}
        disabled={!canEdit}
        aria-invalid={bad.includes(name) || undefined}
        {...extra}
      />
    </label>
  );

  const save = () =>
    start(async () => {
      const result = await saveCompanyAction({ ...v, paymentTermsDays: Number(v.paymentTermsDays) });
      if (result.ok) {
        setBad([]);
        toast.success(t("common.saved"));
        router.refresh();
      } else {
        setBad(result.fields ?? []);
        const fields = result.fields ?? [];
        toast.error(
          t(
            result.error === "forbidden"
              ? "common.forbidden"
              : fields.includes("iban")
                ? "company.ibanInvalid"
                : fields.includes("currency")
                  ? "company.currencyLocked"
                  : fields.includes("vatId") || fields.includes("taxNumber")
                    ? "company.taxIdInvalid"
                    : "auth.check",
          ),
        );
      }
    });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("company.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-6">
          {field("name", "sm:col-span-3", { required: true, minLength: 2 })}
          {field("legalName", "sm:col-span-3")}
          {field("street", "sm:col-span-6")}
          {field("postalCode", "sm:col-span-2")}
          {field("city", "sm:col-span-2")}
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">{t("company.country")}</span>
            <div className="flex h-9 items-center truncate rounded-md border bg-muted/40 px-3 text-sm" title={countryName}>
              {countryName}
            </div>
          </div>
          {field("taxNumber", "sm:col-span-3")}
          {field("vatId", "sm:col-span-3")}
          {field("email", "sm:col-span-2", { type: "email" })}
          {field("phone", "sm:col-span-2")}
          {field("website", "sm:col-span-2")}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("company.bank")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-6">
          {field("iban", "sm:col-span-2")}
          {field("bic", "sm:col-span-2", { maxLength: 30 })}
          {field("bankName", "sm:col-span-2")}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("company.invoicing")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-6">
          <label className="grid gap-1.5 sm:col-span-3">
            <span className="text-sm font-medium">{t("company.invoiceNumberFormat")}</span>
            <Input
              value={v.invoiceNumberFormat}
              onChange={(e) => setV({ ...v, invoiceNumberFormat: e.target.value })}
              disabled={!canEdit}
              aria-invalid={bad.includes("invoiceNumberFormat") || undefined}
            />
            <span className="text-xs text-muted-foreground">{t("company.invoiceNumberHint")}</span>
          </label>
          {field("paymentTermsDays", "sm:col-span-2", { type: "number", min: 0, max: 120 })}
          <label className="grid gap-1.5 sm:col-span-3">
            <span className="text-sm font-medium">{t("invoicing.creditNumberFormat")}</span>
            <Input value={v.creditNoteNumberFormat} onChange={(e) => setV({ ...v, creditNoteNumberFormat: e.target.value })} disabled={!canEdit} aria-invalid={bad.includes("creditNoteNumberFormat") || undefined} />
          </label>
          {field("quoteNumberFormat", "sm:col-span-3")}
          {profile.xrechnung && (
            <label className="grid gap-1.5 sm:col-span-3">
              <span className="text-sm font-medium">{t("invoicing.defaultFormat")}</span>
              <Select value={v.einvoiceFormat} onValueChange={(f) => setV({ ...v, einvoiceFormat: f as InvoiceFileKind })} disabled={!canEdit}>
                <SelectTrigger className="w-full" aria-label={t("invoicing.defaultFormat")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVOICE_FILE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`invoicing.format_${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          <label className="grid gap-1.5 sm:col-span-1">
            <span className="text-sm font-medium">{t("company.currency")}</span>
            <Select value={v.currency} onValueChange={(c) => setV({ ...v, currency: c })} disabled={!canEdit || currencyLocked}>
              <SelectTrigger className="w-full" aria-invalid={bad.includes("currency") || undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {currencies.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {country === "US" && (
            <label className="grid gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium">{t("company.usState")}</span>
              <select
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                disabled={!canEdit}
                defaultValue=""
                onChange={(e) => e.target.value && setV({ ...v, taxRates: String(US_STATE_TAX[e.target.value]) })}
              >
                <option value="">—</option>
                {Object.entries(US_STATE_TAX).map(([state, rate]) => (
                  <option key={state} value={state}>
                    {state} · {rate} %
                  </option>
                ))}
              </select>
            </label>
          )}
          {field("taxRates", "sm:col-span-2", { placeholder: profile.taxRates.join("; ") || "0", inputMode: "decimal" })}
          {profile.smallBusiness && (
            <label className="flex items-center gap-2 text-sm sm:col-span-6">
              <Checkbox checked={v.smallBusiness} onCheckedChange={(c) => setV({ ...v, smallBusiness: c === true })} disabled={!canEdit} />
              {t(profile.smallBusiness === "GENERAL" ? "company.noVat" : profile.smallBusiness === "AT" ? "company.smallBusinessAT" : "company.smallBusiness")}
            </label>
          )}
          <label className="grid gap-1.5 sm:col-span-6">
            <span className="text-sm font-medium">{t("company.invoiceFooter")}</span>
            <Textarea rows={2} value={v.invoiceFooter} onChange={(e) => setV({ ...v, invoiceFooter: e.target.value })} disabled={!canEdit} />
          </label>
        </CardContent>
      </Card>
      {canEdit && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? t("common.loading") : t("common.save")}
          </Button>
        </div>
      )}
    </form>
  );
}
