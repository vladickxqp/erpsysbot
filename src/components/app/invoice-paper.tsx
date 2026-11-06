"use client";

import { cityLine } from "@/lib/countries";
import { DOCUMENT_LABELS, fill } from "@/lib/document-labels";
import { taxNote, type InvoiceStyle, type TaxTreatment } from "@/lib/invoicing";
import { cn } from "@/lib/utils";
import { discountCents, lineList, lineNet, totals } from "@/server/money";
import type { Locale } from "@/i18n";

export type PaperLine = { description: string; quantity: number; unit: string; unitPriceCents: number; discountPercent: number; vatRate: number };
export type PaperParty = { name: string; street: string | null; postalCode: string | null; city: string | null; country: string | null };
export type PaperSeller = PaperParty & {
  legalName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  vatId: string | null;
  taxNumber: string | null;
  iban: string | null;
  bic: string | null;
  bankName: string | null;
  footer: string | null;
};

export type PaperData = {
  kind: "INVOICE" | "CREDIT_NOTE";
  number: string | null;
  title: string | null;
  issueDate: string | null;
  serviceDate: string | null;
  serviceEndDate: string | null;
  dueDate: string | null;
  notes: string | null;
  language: string;
  treatment: TaxTreatment;
  reason: string | null;
  currency: string;
  seller: PaperSeller;
  buyer: PaperParty | null;
  lines: PaperLine[];
  style: InvoiceStyle;
  logoId: string | null;
};

/** The invoice as paper: the words, figures and look of the PDF, live while it is written. */
export function InvoicePaper({ data }: { data: PaperData }) {
  const { seller, buyer, lines, style } = data;
  const language = (data.language in DOCUMENT_LABELS ? data.language : "de") as Locale;
  const L = DOCUMENT_LABELS[language];
  const tag = `${language}-${seller.country ?? "DE"}`;
  const money = (cents: number) => new Intl.NumberFormat(tag, { style: "currency", currency: data.currency }).format(cents / 100);
  const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat(tag).format(new Date(`${iso}T12:00:00Z`)) : "—");
  const qty = (n: number) => new Intl.NumberFormat(tag, { maximumFractionDigits: 3 }).format(n);
  const smallBusiness = data.treatment === "SMALL_BUSINESS";
  const sum = totals(lines, smallBusiness);
  const discounts = discountCents(lines);
  const modern = style.layout === "MODERN";
  const compact = style.layout === "COMPACT";
  const credit = data.kind === "CREDIT_NOTE";
  const note = data.treatment === "STANDARD" ? null : taxNote(data.treatment, language, data.reason || "…");
  const period = data.serviceEndDate && data.serviceEndDate !== data.serviceDate;
  const meta: [string, string][] = [
    [credit ? L.noteNumber : L.number, data.number ?? "—"],
    [L.date, date(data.issueDate)],
    period ? [L.servicePeriod, `${date(data.serviceDate)} – ${date(data.serviceEndDate)}`] : [L.serviceDate, date(data.serviceDate ?? data.issueDate)],
    ...(credit ? [] : ([[L.due, date(data.dueDate)]] as [string, string][])),
  ];
  const payment = fill(style.paymentInstructions ?? L.pay, { amount: money(sum.grossCents), due: date(data.dueDate), number: data.number ?? "" });
  const bank = seller.iban ? [seller.bankName, `IBAN ${seller.iban.replace(/(.{4})/g, "$1 ").trim()}`, seller.bic ? `BIC ${seller.bic}` : null].filter(Boolean).join(" · ") : null;
  const sellerName = seller.legalName || seller.name;

  return (
    <div className="overflow-hidden rounded-lg border bg-white text-[11px] leading-snug text-slate-900 shadow-sm" data-testid="invoice-paper">
      {!compact && !modern && <div className="h-1" style={{ background: style.accentColor }} />}
      <div className={cn("flex items-start justify-between gap-4 px-6 pb-2 pt-5", modern && "pb-4")} style={modern ? { background: style.accentColor, color: inkOn(style.accentColor) } : undefined}>
        {data.logoId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/app/documents/${data.logoId}/file`} alt="" className={cn("max-h-10 max-w-40 object-contain", modern && "rounded bg-white p-1")} />
        ) : (
          <div className={cn("font-bold", compact ? "text-sm" : "text-base")}>{sellerName}</div>
        )}
        <div className={cn("text-right text-[10px]", !modern && "text-slate-500")}>
          {[seller.street, cityLine(seller), seller.phone, seller.email].filter(Boolean).map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 px-6 py-3">
        <div>
          <div className="mb-1 truncate text-[8px] text-slate-500">{[sellerName, seller.street, cityLine(seller)].filter(Boolean).join(" · ")}</div>
          {buyer ? (
            [...buyer.name.split("\n"), buyer.street, cityLine(buyer)].filter(Boolean).map((line) => <div key={line}>{line}</div>)
          ) : (
            <div className="h-10 rounded bg-slate-100" />
          )}
        </div>
        <dl className="grid h-fit grid-cols-[1fr_auto] gap-x-2 text-[10px]">
          {meta.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-right font-semibold whitespace-nowrap">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="px-6 pt-2">
        <div className={cn("font-bold", compact ? "text-sm" : "text-lg")} style={modern ? { color: style.accentColor } : undefined}>
          {credit ? L.creditNote : L.invoice} {data.number ?? ""}
        </div>
        {data.title && <div className="mt-0.5 font-semibold">{data.title}</div>}
      </div>
      <div className="px-6 pt-3">
        <table className="w-full border-collapse">
          <thead>
            <tr
              className={cn("text-[9px]", compact ? "border-b border-slate-900" : modern ? "" : "bg-slate-50", !modern && "text-slate-500")}
              style={modern ? { background: style.accentColor, color: inkOn(style.accentColor) } : undefined}
            >
              <th className="px-1 py-1 text-left font-semibold">{L.description}</th>
              <th className="px-1 py-1 text-right font-semibold">{L.qty}</th>
              <th className="px-1 py-1 text-right font-semibold">{L.unitPrice}</th>
              {!smallBusiness && <th className="px-1 py-1 text-right font-semibold">{L.vat}</th>}
              <th className="px-1 py-1 text-right font-semibold">{L.amount}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-slate-200 align-top">
                <td className={cn("whitespace-pre-wrap px-1", compact ? "py-0.5" : "py-1")}>
                  {line.description || "—"}
                  {line.discountPercent > 0 && (
                    <div className="text-[9px] text-slate-500">
                      {L.discount} {qty(line.discountPercent)} %
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-1 py-1 text-right">
                  {qty(line.quantity)} {line.unit}
                </td>
                <td className="whitespace-nowrap px-1 py-1 text-right">{money(line.unitPriceCents)}</td>
                {!smallBusiness && <td className="whitespace-nowrap px-1 py-1 text-right text-slate-500">{qty(line.vatRate)} %</td>}
                <td className="whitespace-nowrap px-1 py-1 text-right">{money(lineNet(line))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto grid w-3/5 gap-0.5 px-6 pt-3">
        {discounts !== 0 && (
          <>
            <Row label={L.listTotal} value={money(lines.reduce((all, line) => all + lineList(line), 0))} />
            <Row label={L.discounts} value={money(-discounts)} />
          </>
        )}
        <Row label={L.net} value={money(sum.netCents)} />
        {!smallBusiness &&
          sum.byRate.map((group) => <Row key={group.rate} label={fill(L.vatOn, { rate: qty(group.rate), net: money(group.netCents) })} value={money(group.vatCents)} />)}
        <div className="mt-1 flex justify-between gap-3 border-t border-slate-900 pt-1 text-xs font-bold">
          <dt>{L.total}</dt>
          <dd className="tabular-nums">{money(sum.grossCents)}</dd>
        </div>
      </dl>
      <div className="grid gap-1 px-6 py-4">
        {note && <p>{note}</p>}
        {!credit && <p>{payment}</p>}
        {!credit && bank && (
          <p>
            {L.bankDetails}: {bank}
          </p>
        )}
        {data.notes && <p className="whitespace-pre-wrap">{data.notes}</p>}
      </div>
      <div className="border-t px-6 py-2 text-[8px] text-slate-500">
        <div>{[seller.taxNumber ? `${L.taxNumber} ${seller.taxNumber}` : null, seller.vatId ? `${L.vatId} ${seller.vatId}` : null].filter(Boolean).join(" · ")}</div>
        {(style.footer ?? seller.footer) && <div>{style.footer ?? seller.footer}</div>}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="whitespace-nowrap tabular-nums">{value}</dd>
    </div>
  );
}

/** The ink that reads on a colour: the same rule as on the PDF. */
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? "#0f172a" : "#ffffff";
}
