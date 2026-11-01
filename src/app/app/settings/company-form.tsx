"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { saveCompanyAction } from "./actions";

export type CompanyValues = {
  name: string;
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  vatId: string;
  taxNumber: string;
  email: string;
  phone: string;
  website: string;
  iban: string;
  bic: string;
  bankName: string;
  smallBusiness: boolean;
  paymentTermsDays: number;
  invoiceNumberFormat: string;
  invoiceFooter: string;
};

export function CompanyForm({ initial, canEdit }: { initial: CompanyValues; canEdit: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [bad, setBad] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const field = (name: keyof CompanyValues, span = "", extra: React.ComponentProps<typeof Input> = {}) => (
    <label className={`grid gap-1.5 ${span}`}>
      <span className="text-sm font-medium">{t(`company.${name}`)}</span>
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
        toast.error(t(result.error === "forbidden" ? "common.forbidden" : (result.fields ?? []).includes("iban") ? "company.ibanInvalid" : "auth.check"));
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
          {field("city", "sm:col-span-3")}
          {field("country", "sm:col-span-1", { maxLength: 2 })}
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
          {field("iban", "sm:col-span-3")}
          {field("bic", "sm:col-span-1")}
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
          <label className="flex items-center gap-2 text-sm sm:col-span-6">
            <Checkbox checked={v.smallBusiness} onCheckedChange={(c) => setV({ ...v, smallBusiness: c === true })} disabled={!canEdit} />
            {t("company.smallBusiness")}
          </label>
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
