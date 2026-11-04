/**
 * A link for the client: one quote or invoice without an account, 30 days.
 * Whoever has the link can read that one document and, for a quote, accept or
 * decline it. Only the hash of the link is stored.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { auditLog, invoiceItems, invoices, organizations, quoteItems, quotes, shareLinks } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { today } from "./money";
import { requirePermission } from "./permissions";
import { isSuspended } from "./platform";

export type ShareKind = "quote" | "invoice";

const DAYS = 30;
const sha = (token: string) => createHash("sha256").update(token).digest("hex");

export class ShareError extends Error {
  constructor(public readonly code: "DRAFT" | "CLOSED") {
    super(code);
  }
}

/** A new link to a sent quote or an issued invoice. */
export async function createShareLink(ctx: Context, kind: ShareKind, entityId: string): Promise<string> {
  requirePermission(ctx.permissions, kind === "quote" ? "orders.create" : "invoices.create");
  await withTenant(ctx.organization.id, async (tx) => {
    if (kind === "quote") {
      const [row] = await tx.select({ status: quotes.status }).from(quotes).where(eq(quotes.id, entityId));
      if (!row) throw new NotFoundError();
      if (row.status === "DRAFT") throw new ShareError("DRAFT");
    } else {
      const [row] = await tx.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, entityId));
      if (!row) throw new NotFoundError();
      if (row.status === "DRAFT") throw new ShareError("DRAFT");
    }
    await audit(tx, ctx, "share.create", kind, entityId);
  });
  const token = randomBytes(24).toString("base64url");
  await getDb()
    .insert(shareLinks)
    .values({ organizationId: ctx.organization.id, kind, entityId, tokenHash: sha(token), expiresAt: new Date(Date.now() + DAYS * 86_400_000) });
  return token;
}

/** Ends every link to this document. */
export async function revokeShareLinks(ctx: Context, kind: ShareKind, entityId: string): Promise<void> {
  requirePermission(ctx.permissions, kind === "quote" ? "orders.create" : "invoices.create");
  await getDb()
    .delete(shareLinks)
    .where(and(eq(shareLinks.organizationId, ctx.organization.id), eq(shareLinks.kind, kind), eq(shareLinks.entityId, entityId)));
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "share.delete", kind, entityId));
}

async function linkOf(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [row] = await getDb()
    .select({ link: shareLinks, org: organizations })
    .from(shareLinks)
    .innerJoin(organizations, eq(organizations.id, shareLinks.organizationId))
    .where(and(eq(shareLinks.tokenHash, sha(token)), gt(shareLinks.expiresAt, new Date())))
    .limit(1);
  if (!row || (await isSuspended(row.org.id))) return null;
  return row;
}

export type SharedDocument = {
  kind: ShareKind;
  company: string;
  locale: string;
  country: string;
  currency: string;
  number: string | null;
  title: string | null;
  status: string;
  date: string | null;
  netCents: number;
  grossCents: number;
  lines: { description: string; quantity: number; unit: string; netCents: number }[];
};

/** What the link shows; null when unknown or expired. */
export async function sharedDocument(token: string): Promise<SharedDocument | null> {
  const row = await linkOf(token);
  if (!row) return null;
  const { link, org } = row;
  const common = { kind: link.kind as ShareKind, company: org.legalName || org.name, locale: org.locale, country: org.country };
  return withTenant(org.id, async (tx) => {
    if (link.kind === "quote") {
      const [q] = await tx.select().from(quotes).where(eq(quotes.id, link.entityId));
      if (!q) return null;
      const items = await tx.select().from(quoteItems).where(eq(quoteItems.quoteId, q.id));
      return { ...common, currency: org.currency, number: q.number, title: q.title, status: q.status, date: q.issueDate, netCents: q.netCents, grossCents: q.grossCents, lines: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unit: i.unit, netCents: i.netCents })) };
    }
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, link.entityId));
    if (!inv) return null;
    const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
    return { ...common, currency: inv.currency ?? org.currency, number: inv.number, title: null, status: inv.status, date: inv.issueDate, netCents: inv.netCents, grossCents: inv.grossCents, lines: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unit: i.unit, netCents: i.netCents })) };
  });
}

/** The client's answer to a quote; once. */
export async function answerSharedQuote(token: string, accept: boolean): Promise<void> {
  const row = await linkOf(token);
  if (!row || row.link.kind !== "quote") throw new NotFoundError();
  await withTenant(row.org.id, async (tx) => {
    const [quote] = await tx.select({ validUntil: quotes.validUntil }).from(quotes).where(eq(quotes.id, row.link.entityId));
    if (quote?.validUntil && quote.validUntil < today(row.org.timezone)) throw new ShareError("CLOSED");
    const [updated] = await tx
      .update(quotes)
      .set({ status: accept ? "ACCEPTED" : "DECLINED" })
      .where(and(eq(quotes.id, row.link.entityId), eq(quotes.status, "SENT")))
      .returning({ id: quotes.id });
    if (!updated) throw new ShareError("CLOSED");
    await tx.insert(auditLog).values({ organizationId: row.org.id, action: "quote.status", entity: "quote", entityId: row.link.entityId, data: { to: accept ? "ACCEPTED" : "DECLINED", by: "client link" } });
  });
}
