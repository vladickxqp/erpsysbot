import { notFound } from "next/navigation";
import { getT } from "@/i18n/server";
import { NotFoundError } from "@/server/clients";
import { countryProfile } from "@/lib/countries";
import type { InvoiceFileKind } from "@/lib/invoicing";
import { einvoiceProblems } from "@/server/einvoice";
import { invoiceHistory } from "@/server/invoice-files";
import { getInvoice, missingCompanyData, pdfData } from "@/server/invoices";
import { totals, today } from "@/server/money";
import { asLines } from "@/server/orders";
import { requirePageContext } from "@/server/request";
import { mailAvailable } from "@/server/mail";
import { listReminders } from "@/server/reminders";
import { assistantAvailable } from "@/server/assistant/run";
import { InvoiceDetail } from "./invoice-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("invoices.read");
  const { t } = await getT();
  const found = await getInvoice(ctx, (await params).id).catch(() => null);
  return { title: found ? (found.invoice.number ?? t("invoices.draftNumber")) : undefined };
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext("invoices.read");
  const { id } = await params;
  const found = await getInvoice(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { invoice, items, payments, client, clientName, related } = found;
  const now = today(ctx.organization.timezone);
  const reminders = await listReminders(ctx, id);
  const { deliveries } = await invoiceHistory(ctx, id);
  const einvoiceMissing = countryProfile(ctx.organization.country).xrechnung && invoice.status !== "DRAFT" ? einvoiceProblems(await pdfData(ctx, id)) : null;
  return (
    <InvoiceDetail
      deliveries={deliveries.map((d) => ({ id: d.id, status: d.status, format: d.format, recipient: d.recipient, error: d.error, createdAt: d.createdAt.toISOString() }))}
      defaultFormat={ctx.organization.einvoiceFormat as InvoiceFileKind}
      einvoiceMissing={einvoiceMissing}
      ai={assistantAvailable() && ctx.permissions.has("ai.use")}
      invoice={{
        id: invoice.id,
        kind: invoice.kind,
        status: invoice.status,
        number: invoice.number,
        clientId: invoice.clientId,
        orderId: invoice.orderId,
        issueDate: invoice.issueDate,
        serviceDate: invoice.serviceDate,
        dueDate: invoice.dueDate,
        notes: invoice.notes,
        grossCents: invoice.grossCents,
        currency: invoice.currency,
        paidCents: invoice.paidCents,
        creditedCents: invoice.creditedCents,
        smallBusiness: invoice.smallBusiness,
        title: invoice.title,
        sent: !!invoice.sentAt,
        taxTreatment: invoice.taxTreatment,
        exemptionReason: invoice.exemptionReason,
        language: invoice.language,
        overdue:
          invoice.kind === "INVOICE" && ["ISSUED", "PARTIALLY_PAID"].includes(invoice.status) && !!invoice.dueDate && invoice.dueDate < now,
      }}
      clientName={clientName}
      items={items.map((i) => ({
        id: i.id,
        position: i.position,
        description: i.description,
        quantity: Number(i.quantity),
        unit: i.unit,
        unitPriceCents: i.unitPriceCents,
        discountPercent: Number(i.discountPercent),
        vatRate: i.vatRate,
        netCents: i.netCents,
      }))}
      totals={totals(asLines(items), invoice.smallBusiness)}
      payments={payments.map((p) => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, method: p.method }))}
      related={related}
      missingCompany={missingCompanyData(ctx.organization)}
      today={now}
      clientEmail={client?.email ?? null}
      mail={mailAvailable()}
      reminders={reminders.map((r) => ({
        id: r.id,
        level: r.level,
        issueDate: r.issueDate,
        dueDate: r.dueDate,
        openCents: r.openCents,
        sentAt: r.sentAt?.toISOString() ?? null,
      }))}
      can={{
        edit: ctx.permissions.has("invoices.create"),
        issue: ctx.permissions.has("invoices.issue"),
        cancel: ctx.permissions.has("invoices.cancel"),
        pay: ctx.permissions.has("finance.create"),
        settings: ctx.permissions.has("settings.manage"),
      }}
    />
  );
}
