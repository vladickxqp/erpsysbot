/**
 * The files of an issued invoice, kept as they left the company.
 *
 * The PDF is made and stored when the invoice is issued, the e-invoices the
 * first time they are asked for. From then on the same bytes come back: a
 * later change of logo, template or address does not reach them. The bytes lie
 * in UPLOAD_DIR/<company>/invoices, outside anything served publicly, and are
 * read through routes that check the company (RLS) and the permission; their
 * hash is compared on every read.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { invoiceDeliveries, invoiceFiles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isLocale } from "@/i18n";
import type { InvoiceFileKind } from "@/lib/invoicing";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { companyLogo, uploadDir } from "./documents";
import { einvoiceProblems, xrechnungXml, zugferdPdf, type InvoiceData } from "./einvoice";
import { pdfData } from "./invoices";
import { invoicePdf } from "./pdf";
import { requirePermission } from "./permissions";

export class InvoiceFileError extends Error {
  constructor(
    public readonly code: "DRAFT" | "NOT_READY" | "DAMAGED",
    public readonly missing: string[] = [],
  ) {
    super(code);
  }
}

export type StoredFile = { name: string; mimeType: string; bytes: Uint8Array; sha256: string };

const SHAPE: Record<InvoiceFileKind, { suffix: string; mimeType: string }> = {
  PDF: { suffix: ".pdf", mimeType: "application/pdf" },
  ZUGFERD: { suffix: "_zugferd.pdf", mimeType: "application/pdf" },
  XRECHNUNG: { suffix: "_xrechnung.xml", mimeType: "application/xml" },
};

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const locate = (storageKey: string) => {
  const file = path.resolve(uploadDir(), storageKey);
  if (!file.startsWith(path.resolve(uploadDir()) + path.sep)) throw new NotFoundError();
  return file;
};

/** The invoice as a PDF in its own language and look: also how a draft is seen before issuing. */
export async function renderPdf(ctx: Context, data: InvoiceData): Promise<Uint8Array> {
  const locale = isLocale(data.invoice.language) ? data.invoice.language : "de";
  return invoicePdf({ ...data, locale, logo: await companyLogo(ctx) });
}

async function stored(ctx: Context, id: string, kind: InvoiceFileKind): Promise<StoredFile | null> {
  const [row] = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(invoiceFiles)
      .where(and(eq(invoiceFiles.invoiceId, id), eq(invoiceFiles.kind, kind)))
      .limit(1),
  );
  if (!row) return null;
  const bytes = await readFile(locate(row.storageKey)).catch(() => {
    throw new InvoiceFileError("DAMAGED");
  });
  if (hash(bytes) !== row.sha256) throw new InvoiceFileError("DAMAGED");
  return { name: row.name, mimeType: row.mimeType, bytes, sha256: row.sha256 };
}

async function render(ctx: Context, data: InvoiceData, kind: InvoiceFileKind): Promise<Uint8Array> {
  if (kind === "PDF") return renderPdf(ctx, data);
  const problems = einvoiceProblems(data);
  if (problems.length) throw new InvoiceFileError("NOT_READY", problems);
  if (kind === "XRECHNUNG") return new TextEncoder().encode(await xrechnungXml(data));
  const pdf = await keepInvoiceFile(ctx, data.invoice.id, "PDF");
  return zugferdPdf(data, pdf.bytes);
}

/** The file of an issued invoice: the stored one, or made and stored now. */
export async function keepInvoiceFile(ctx: Context, id: string, kind: InvoiceFileKind): Promise<StoredFile> {
  const data = await pdfData(ctx, id);
  if (data.invoice.status === "DRAFT" || !data.invoice.number) throw new InvoiceFileError("DRAFT");
  const known = await stored(ctx, id, kind);
  if (known) return known;

  const bytes = await render(ctx, data, kind);
  const shape = SHAPE[kind];
  const name = `${data.invoice.number.replace(/[^\w.-]+/g, "_")}${shape.suffix}`;
  const storageKey = `${ctx.organization.id}/invoices/${randomUUID()}`;
  const target = locate(storageKey);
  const sha256 = hash(bytes);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
  const kept = await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .insert(invoiceFiles)
      .values({ organizationId: ctx.organization.id, invoiceId: id, kind, name, mimeType: shape.mimeType, sizeBytes: bytes.length, sha256, storageKey, createdBy: ctx.user.userId })
      .onConflictDoNothing({ target: [invoiceFiles.invoiceId, invoiceFiles.kind] })
      .returning({ id: invoiceFiles.id });
    if (row) await audit(tx, ctx, "invoice.file", "invoice", id, { kind, sha256 });
    return !!row;
  });
  if (kept) return { name, mimeType: shape.mimeType, bytes, sha256 };
  // Someone else was first: theirs is the file.
  await rm(target, { force: true });
  return (await stored(ctx, id, kind))!;
}

/** Stored files and every attempt at sending, newest first. */
export async function invoiceHistory(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "invoices.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const deliveries = await tx.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.invoiceId, id)).orderBy(desc(invoiceDeliveries.createdAt));
    const files = await tx
      .select({ kind: invoiceFiles.kind, name: invoiceFiles.name, sizeBytes: invoiceFiles.sizeBytes, sha256: invoiceFiles.sha256, createdAt: invoiceFiles.createdAt })
      .from(invoiceFiles)
      .where(eq(invoiceFiles.invoiceId, id));
    return { deliveries, files };
  });
}
