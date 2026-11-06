import { notFound } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatMoney, isLocale, MESSAGES, translator } from "@/i18n";
import { sharedDocument } from "@/server/share";
import { QuoteAnswer } from "./quote-answer";

export const metadata = { robots: { index: false } };

/** What a client sees behind a link: no account, this one document. */
export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await sharedDocument(token);
  if (!doc) notFound();
  const locale = isLocale(doc.locale) ? doc.locale : "de";
  const t = translator(MESSAGES[locale]);
  const region = { country: doc.country, currency: doc.currency };
  const money = (c: number) => formatMoney(c, locale, region);
  return (
    <div className="min-h-dvh bg-background px-4 py-8">
      <div className="mx-auto grid max-w-2xl gap-4">
        <Logo />
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
              <span>
                {t(doc.kind === "quote" ? "nav.quotes" : "nav.invoices")} {doc.number}
              </span>
              <Badge variant="secondary">{t(doc.kind === "quote" ? `quotes.${doc.status}` : doc.status === "CREDITED" ? "invoicing.status_CREDITED" : `invoices.${doc.status}`)}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {doc.company}
              {doc.date && ` · ${formatDate(doc.date, locale, region)}`}
              {doc.title && ` · ${doc.title}`}
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="divide-y rounded-lg border">
              {doc.lines.map((l, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">{l.description}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {l.quantity} {l.unit}
                  </span>
                  <span className="w-24 text-right tabular-nums">{money(l.netCents)}</span>
                </div>
              ))}
            </div>
            <div className="grid justify-end gap-1 text-right">
              <div className="text-muted-foreground">
                {t("share.net")}: <span className="tabular-nums">{money(doc.netCents)}</span>
              </div>
              <div className="text-base font-semibold">
                {t("share.total")}: <span className="tabular-nums">{money(doc.grossCents)}</span>
              </div>
            </div>
            {doc.kind === "quote" && doc.status === "SENT" && <QuoteAnswer token={token} labels={{ accept: t("share.accept"), decline: t("share.decline"), done: t("share.thanks"), failed: t("common.error") }} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
