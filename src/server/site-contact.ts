/**
 * What a website's visitors send: the contact form and the newsletter
 * sign-up. Each becomes a client of the company (found by e-mail, or a new
 * lead) with a note of what was written, and the company's leads hear of it.
 * Nothing is mailed to the visitor. A field people never see and a limit per
 * visitor keep machines out; an unpublished site takes nothing.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { clientActivities, clients } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "./audit";
import { companyContext } from "./automations";
import { companyLeads, notify } from "./notifications";
import { nextNumber } from "./numbers";
import { StorefrontError, type PublicStore } from "./storefront";

export const contactInput = z
  .object({
    kind: z.enum(["contact", "newsletter"]).default("contact"),
    name: z.string().trim().max(120).default(""),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: z.string().trim().max(40).default(""),
    message: z.string().trim().max(4000).default(""),
    consent: z.literal(true),
    /** Left empty by people: the field is hidden from them, machines fill in everything. */
    website: z.string().max(200).default(""),
  })
  .refine((v) => v.kind === "newsletter" || (v.name.length > 0 && v.message.length > 0), "message");
export type ContactInput = z.input<typeof contactInput>;

/** Messages per visitor and site and hour, held in memory. */
const recent = new Map<string, number[]>();
function takeSlot(key: string, perHour = 5): boolean {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (list.length >= perHour) return false;
  list.push(now);
  recent.set(key, list);
  if (recent.size > 5000) for (const k of [...recent.keys()].slice(0, 1000)) recent.delete(k);
  return true;
}

function splitName(name: string): { firstName: string | null; lastName: string | null } {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: null, lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** A visitor's message or sign-up, kept as a lead with a note; returns nothing a visitor could learn from. */
export async function sendContact(store: PublicStore, raw: ContactInput, visitor = "anonymous"): Promise<void> {
  if (store.preview) throw new StorefrontError("CLOSED");
  const input = contactInput.parse(raw);
  // A machine filled the hidden field: answered like everyone, kept nowhere.
  if (input.website) return;
  if (!takeSlot(`${store.id}:${visitor}`)) throw new StorefrontError("BUSY");
  const ctx = await companyContext(store.organizationId);
  if (!ctx) throw new StorefrontError("CLOSED");

  const subject = input.kind === "newsletter" ? `Newsletter: ${store.name}` : `${store.name}: ${input.name}`.slice(0, 200);
  const body = [input.message, input.phone && `☎ ${input.phone}`].filter(Boolean).join("\n\n") || null;
  const crm = !ctx.disabledModules.has("crm");
  const lead = crm
    ? await withTenant(store.organizationId, async (tx) => {
        const now = new Date();
        const [existing] = await tx.select({ id: clients.id }).from(clients).where(sql`lower(${clients.email}) = ${input.email}`).limit(1);
        let id = existing?.id;
        if (!id) {
          const number = await nextNumber(tx, store.organizationId, "client");
          const [client] = await tx
            .insert(clients)
            .values({
              organizationId: store.organizationId,
              number,
              type: "PERSON",
              status: "LEAD",
              ...splitName(input.name),
              email: input.email,
              phone: input.phone || null,
              source: store.name.slice(0, 80),
              assignedUserId: ctx.user.userId,
            })
            .returning();
          id = client.id;
          await audit(tx, ctx, "client.create", "client", client.id, { number, site: store.slug }, "shop");
        }
        await tx.insert(clientActivities).values({ organizationId: store.organizationId, clientId: id, kind: "NOTE", subject, body, userId: null, occurredAt: now });
        await tx.update(clients).set({ lastInteractionAt: now }).where(eq(clients.id, id));
        return { id, created: !existing };
      })
    : null;

  if (lead?.created) {
    const { fireAutomations } = await import("./automations");
    await fireAutomations(ctx, "client.created", lead.id).catch((e) => console.error("site: automations failed", e instanceof Error ? e.message : e));
  }
  await notify(store.organizationId, await companyLeads(store.organizationId), {
    category: "update",
    kind: input.kind === "newsletter" ? "siteSignup" : "siteMessage",
    vars: { site: store.name, name: input.name || input.email },
    href: lead ? `/app/clients/${lead.id}` : null,
    entity: lead ? "client" : null,
    entityId: lead?.id ?? null,
    dedupeKey: `site-${input.kind}:${randomUUID()}`,
  }).catch((e) => console.error("site: notify failed", e instanceof Error ? e.message : e));
}
