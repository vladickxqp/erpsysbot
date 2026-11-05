"use client";

import { Lock, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { addMoneyAction, deleteMoneyAction } from "./actions";

type Row = { id: string; kind: string; amountCents: number; bookedOn: string; description: string | null };

/** One person's own money for the month: clearly apart from the company's books. */
export function PersonalMoney({ today, inCents, outCents, rows }: { today: string; inCents: number; outCents: number; rows: Row[] }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [kind, setKind] = useState<"IN" | "OUT">("OUT");
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [pending, start] = useTransition();
  const money = (cents: number) => formatMoney(cents, locale, region);
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="size-4 text-muted-foreground" aria-hidden /> {t("hub.money.title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("hub.money.private")}</p>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex flex-wrap gap-6">
          <span>
            {t("hub.money.in")}: <strong className="tabular-nums">{money(inCents)}</strong>
          </span>
          <span>
            {t("hub.money.out")}: <strong className="tabular-nums">{money(outCents)}</strong>
          </span>
          <span>
            {t("hub.money.left")}: <strong className="tabular-nums">{money(inCents - outCents)}</strong>
          </span>
        </div>
        <form
          className="grid gap-2 sm:grid-cols-[120px_140px_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = Math.round(Number(amount.replace(",", ".")) * 100);
            start(async () => {
              const result = await addMoneyAction({ kind, amountCents: cents, bookedOn: today, description: what });
              if (result.error) toast.error(t(result.error));
              else {
                setAmount("");
                setWhat("");
              }
              router.refresh();
            });
          }}
        >
          <Select value={kind} onValueChange={(v) => setKind(v as "IN")}>
            <SelectTrigger className="w-full" aria-label={t("hub.money.title")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OUT">{t("hub.money.out")}</SelectItem>
              <SelectItem value="IN">{t("hub.money.in")}</SelectItem>
            </SelectContent>
          </Select>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("hub.money.amount")} aria-label={t("hub.money.amount")} required />
          <Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder={t("hub.money.what")} aria-label={t("hub.money.what")} maxLength={200} />
          <Button type="submit" disabled={pending}>
            {t("common.save")}
          </Button>
        </form>
        <div className="grid divide-y">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1.5">
              <span className="text-xs tabular-nums text-muted-foreground">{formatDate(r.bookedOn, locale, region)}</span>
              <span className="min-w-0 flex-1 truncate">{r.description ?? "—"}</span>
              <span className="tabular-nums">
                {r.kind === "OUT" ? "−" : "+"}
                {money(r.amountCents)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                disabled={pending}
                aria-label={t("common.delete")}
                onClick={() =>
                  start(async () => {
                    await deleteMoneyAction(r.id);
                    router.refresh();
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
