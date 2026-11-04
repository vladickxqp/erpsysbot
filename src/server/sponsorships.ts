/**
 * Sponsoring for creators: which brand pays what for which piece of content,
 * from the first contact to the invoice. Part of Creator Studio.
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, contentItems, sponsorships } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { SPONSOR_STATUSES } from "@/lib/content";
import { allowedRates } from "@/lib/countries";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { createInvoiceDraft, type Invoice } from "./invoices";
import { requirePermission } from "./permissions";

export type Sponsorship = typeof sponsorships.$inferSelect;

export class SponsorError extends Error {
  constructor(public readonly code: "NO_CLIENT" | "NO_AMOUNT" | "BILLED") {
    super(code);
  }
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const optionalId = z.string().uuid().nullish().transform((v) => v || null);

export const sponsorInput = z.object({
  brand: z.string().trim().min(1).max(160),
  title: optional(300),
  status: z.enum(SPONSOR_STATUSES).default("LEAD"),
  amountCents: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform((v) => v || null),
  clientId: optionalId,
  contentId: optionalId,
  notes: optional(5000),
});
export type SponsorInput = z.input<typeof sponsorInput>;

export async function saveSponsorship(ctx: Context, id: string | null, raw: SponsorInput): Promise<Sponsorship> {
  requirePermission(ctx.permissions, "content.manage");
  const input = sponsorInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    // Links must point into this company (RLS hides others, so "not found" is enough).
    if (input.clientId && !(await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, input.clientId))).length) throw new NotFoundError();
    if (input.contentId && !(await tx.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, input.contentId))).length) throw new NotFoundError();
    if (id) {
      const [row] = await tx.update(sponsorships).set(input).where(eq(sponsorships.id, id)).returning();
      if (!row) throw new NotFoundError();
      return row;
    }
    const [row] = await tx
      .insert(sponsorships)
      .values({ ...input, organizationId: ctx.organization.id, createdBy: ctx.user.userId })
      .returning();
    await audit(tx, ctx, "sponsor.create", "sponsorship", row.id, { name: row.brand });
    return row;
  });
}

export async function deleteSponsorship(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "content.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(sponsorships).where(eq(sponsorships.id, id)).returning({ brand: sponsorships.brand });
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "sponsor.delete", "sponsorship", id, { name: row.brand });
  });
}

/** Amounts are money: for those who work on the deals, not for everyone who may read content. */
export async function listSponsorships(ctx: Context) {
  requirePermission(ctx.permissions, "content.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ s: sponsorships, content: contentItems.title })
      .from(sponsorships)
      .leftJoin(contentItems, eq(contentItems.id, sponsorships.contentId))
      .orderBy(asc(sql`coalesce(${sponsorships.dueDate}, '9999-12-31')`), desc(sponsorships.createdAt))
      .limit(500);
    return rows.map((r) => ({ ...r.s, contentTitle: r.content }));
  });
}

/** The agreed amount as an invoice draft for the linked client, once. */
export async function invoiceSponsorship(ctx: Context, id: string): Promise<Invoice> {
  requirePermission(ctx.permissions, "content.manage");
  const [deal] = await withTenant(ctx.organization.id, (tx) => tx.select().from(sponsorships).where(eq(sponsorships.id, id)));
  if (!deal) throw new NotFoundError();
  if (deal.invoiceId) throw new SponsorError("BILLED");
  if (!deal.clientId) throw new SponsorError("NO_CLIENT");
  if (deal.amountCents <= 0) throw new SponsorError("NO_AMOUNT");
  const invoice = await createInvoiceDraft(ctx, {
    clientId: deal.clientId,
    items: [
      {
        description: [deal.brand, deal.title].filter(Boolean).join(" – ").slice(0, 500),
        quantity: 1,
        unit: "x",
        unitPriceCents: deal.amountCents,
        discountPercent: 0,
        vatRate: ctx.organization.smallBusiness ? 0 : allowedRates(ctx.organization.taxRates, ctx.organization.country)[0],
      },
    ],
  });
  await withTenant(ctx.organization.id, (tx) => tx.update(sponsorships).set({ invoiceId: invoice.id }).where(eq(sponsorships.id, id)));
  return invoice;
}
