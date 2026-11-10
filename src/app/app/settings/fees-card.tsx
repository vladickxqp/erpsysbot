"use client";

import { CreditCard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { parseMoney } from "@/server/money";
import { saveFeesAction } from "../products/catalog-actions";

/** What a payment costs the company: a share of the gross amount plus a fixed part. Margins count it. */
export function FeesCard({ percent, fixedCents }: { percent: number; fixedCents: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [p, setP] = useState(String(percent).replace(".", ","));
  const [fixed, setFixed] = useState((fixedCents / 100).toFixed(2).replace(".", ","));
  return (
    <Card id="fees" className="h-fit scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-4" /> {t("catalog.fees")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const value = Number(p.trim().replace(",", ".") || "0");
            const cents = fixed.trim() ? parseMoney(fixed) : 0;
            if (!Number.isFinite(value) || value < 0 || value > 30 || cents === null || cents < 0) return toast.error(t("auth.check"));
            start(async () => {
              const result = await saveFeesAction(value, cents);
              if (result.ok) {
                toast.success(t("common.saved"));
                router.refresh();
              } else toast.error(t(result.error ?? "common.error"));
            });
          }}
        >
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("catalog.feePercent")}</span>
            <Input inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("catalog.feeFixed")}</span>
            <Input inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} />
          </label>
          <Button type="submit" size="sm" className="col-span-2 w-fit" disabled={pending}>
            {t("common.save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
