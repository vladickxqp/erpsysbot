"use client";

import { ArrowLeft, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatCard } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { saveSupplierDetailsAction } from "../../../products/catalog-actions";

type Form = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  notes: string;
  website: string;
  currency: string;
  paymentTermsDays: string;
  shippingTerms: string;
  deliveryDays: string;
  returnConditions: string;
  status: "ACTIVE" | "INACTIVE";
};

const days = (text: string) => {
  if (!text.trim()) return null;
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
};

export function SupplierView({
  id,
  canManage,
  initial,
  offers,
  performance,
}: {
  id: string;
  canManage: boolean;
  initial: Form;
  offers: { id: string; productId: string; productName: string; sku: string | null; variant: string | null; purchasePriceCents: number; currency: string; leadTimeDays: number | null; preferred: boolean }[];
  performance: { orders: number; received: number; spentCents: number; averageDays: number | null; onTimePercent: number | null; limited: boolean };
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  const field = (key: keyof Form, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Input value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} disabled={!canManage} {...props} />
    </label>
  );
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const save = () => {
    const paymentTermsDays = days(v.paymentTermsDays);
    const deliveryDays = days(v.deliveryDays);
    if (Number.isNaN(paymentTermsDays) || Number.isNaN(deliveryDays) || (v.currency.trim() && v.currency.trim().length !== 3)) return toast.error(t("auth.check"));
    start(async () => {
      const result = await saveSupplierDetailsAction(id, {
        name: v.name,
        contactName: v.contactName,
        email: v.email,
        phone: v.phone,
        street: v.street,
        postalCode: v.postalCode,
        city: v.city,
        country: v.country || undefined,
        notes: v.notes,
        website: v.website || null,
        currency: v.currency.trim() || null,
        paymentTermsDays,
        shippingTerms: v.shippingTerms || null,
        deliveryDays,
        returnConditions: v.returnConditions || null,
        status: v.status,
      });
      if (result.ok) {
        toast.success(t("common.saved"));
        router.refresh();
      } else toast.error(t(result.error ?? "common.error"));
    });
  };
  return (
    <>
      <Link href="/app/purchasing?tab=suppliers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("inventory.suppliers")}
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{initial.name}</h1>
        {initial.status === "INACTIVE" && <Badge variant="outline">{t("products.inactive")}</Badge>}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t("inventory.orders")} value={String(performance.orders)} />
        <StatCard label={t("catalog.spent")} value={formatMoney(performance.spentCents, locale, region)} />
        <StatCard label={t("catalog.averageDays")} value={performance.averageDays === null ? "—" : t("catalog.days", { count: number.format(performance.averageDays) })} hint={performance.limited ? t("catalog.limitedData") : undefined} />
        <StatCard label={t("catalog.onTime")} value={performance.onTimePercent === null ? "—" : `${performance.onTimePercent} %`} hint={performance.limited ? t("catalog.limitedData") : undefined} />
      </div>
      <form
        className="grid gap-4 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Card className="lg:col-span-2">
          <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
            <div className="sm:col-span-2">{field("name", t("inventory.supplier"), { required: true, maxLength: 200 })}</div>
            {field("contactName", t("inventory.contact"), { maxLength: 120 })}
            {field("email", t("company.email"), { type: "email", maxLength: 200 })}
            {field("phone", t("company.phone"), { maxLength: 40 })}
            {field("website", t("company.website"), { maxLength: 200 })}
            {field("street", t("company.street"), { maxLength: 160 })}
            <div className="grid grid-cols-[7rem_1fr] gap-3">
              {field("postalCode", t("company.postalCode"), { maxLength: 20 })}
              {field("city", t("company.city"), { maxLength: 100 })}
            </div>
            {field("country", t("company.country"), { maxLength: 2 })}
            {field("currency", t("company.currency"), { maxLength: 3 })}
            <label className="grid gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium">{t("inventory.note")}</span>
              <Textarea rows={3} value={v.notes} maxLength={5000} disabled={!canManage} onChange={(e) => setV({ ...v, notes: e.target.value })} />
            </label>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">{t("catalog.terms")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              {field("paymentTermsDays", t("catalog.paymentTerms"), { inputMode: "numeric" })}
              {field("deliveryDays", t("catalog.leadTime"), { inputMode: "numeric" })}
            </div>
            {field("shippingTerms", t("catalog.shippingTerms"), { maxLength: 500 })}
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{t("catalog.returnConditions")}</span>
              <Textarea rows={3} value={v.returnConditions} maxLength={1000} disabled={!canManage} onChange={(e) => setV({ ...v, returnConditions: e.target.value })} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={v.status === "ACTIVE"} disabled={!canManage} onCheckedChange={(c) => setV({ ...v, status: c === true ? "ACTIVE" : "INACTIVE" })} /> {t("products.active")}
            </label>
          </CardContent>
        </Card>
        {canManage && (
          <div className="flex justify-end lg:col-span-3">
            <Button type="submit" disabled={pending}>
              {t("common.save")}
            </Button>
          </div>
        )}
      </form>
      {offers.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">{t("catalog.offers")}</h2>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("products.name")}</TableHead>
                  <TableHead>{t("catalog.supplierSku")}</TableHead>
                  <TableHead className="text-right">{t("inventory.purchasePrice")}</TableHead>
                  <TableHead className="text-right">{t("catalog.leadTime")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">
                      <Link href={`/app/products/${o.productId}`} className="hover:underline">
                        {o.productName}
                      </Link>
                      {o.variant && <span className="ml-1 text-muted-foreground">· {o.variant}</span>}
                      {o.preferred && <Star className="ml-1 inline size-3.5 fill-current text-warning" aria-label={t("catalog.preferred")} />}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{o.sku ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(o.purchasePriceCents, locale, { ...region, currency: o.currency })}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.leadTimeDays === null ? "—" : t("catalog.days", { count: o.leadTimeDays })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </>
  );
}
