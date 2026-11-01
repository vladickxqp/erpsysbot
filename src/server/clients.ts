/**
 * Clients (CRM).
 *
 * Every function takes the request's context, checks the permission it needs
 * and works inside withTenant(): the company comes from the verified
 * membership, Row Level Security does the rest. Each change is audited.
 */
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/tenant";
import { clients } from "@/db/schema";
import { audit, type Via } from "./audit";
import type { Context } from "./context";
import { nextNumber } from "./numbers";
import { requirePermission } from "./permissions";

export type Client = typeof clients.$inferSelect;

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const clientInput = z
  .object({
    type: z.enum(["PERSON", "COMPANY"]).default("PERSON"),
    status: z.enum(["LEAD", "ACTIVE", "INACTIVE"]).default("ACTIVE"),
    firstName: optional(100),
    lastName: optional(100),
    companyName: optional(160),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(200)
      .nullish()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || z.string().email().safeParse(v).success, "email"),
    phone: optional(40),
    street: optional(160),
    postalCode: optional(20),
    city: optional(100),
    country: z.string().trim().toUpperCase().length(2).default("DE"),
    vatId: optional(40),
    notes: optional(5000),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    source: optional(80),
  })
  .refine((c) => c.companyName || c.firstName || c.lastName, { message: "name", path: ["lastName"] });

export type ClientInput = z.input<typeof clientInput>;

export function displayName(c: Pick<Client, "companyName" | "firstName" | "lastName">): string {
  const person = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return c.companyName || person || "—";
}

export class DuplicateClientError extends Error {
  constructor(public readonly candidates: Pick<Client, "id" | "number" | "companyName" | "firstName" | "lastName" | "email" | "phone">[]) {
    super("duplicate");
  }
}

const digits = (phone: string) => phone.replace(/\D/g, "").replace(/^49/, "0");

async function duplicatesOf(tx: Tx, input: z.output<typeof clientInput>, except?: string) {
  const checks: SQL[] = [];
  if (input.email) checks.push(eq(clients.email, input.email));
  if (input.phone && digits(input.phone).length >= 6) {
    checks.push(sql`regexp_replace(regexp_replace(coalesce(${clients.phone}, ''), '\\D', '', 'g'), '^49', '0') = ${digits(input.phone)}`);
  }
  if (input.companyName) checks.push(sql`lower(${clients.companyName}) = lower(${input.companyName})`);
  if (!input.companyName && input.firstName && input.lastName) {
    checks.push(
      and(
        sql`lower(${clients.firstName}) = lower(${input.firstName})`,
        sql`lower(${clients.lastName}) = lower(${input.lastName})`,
      )!,
    );
  }
  if (!checks.length) return [];
  const rows = await tx
    .select({
      id: clients.id,
      number: clients.number,
      companyName: clients.companyName,
      firstName: clients.firstName,
      lastName: clients.lastName,
      email: clients.email,
      phone: clients.phone,
    })
    .from(clients)
    .where(or(...checks))
    .limit(5);
  return rows.filter((r) => r.id !== except);
}

export async function createClient(
  ctx: Context,
  raw: ClientInput,
  opts: { allowDuplicate?: boolean; via?: Via } = {},
): Promise<Client> {
  requirePermission(ctx.permissions, "clients.create");
  const input = clientInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    if (!opts.allowDuplicate) {
      const dupes = await duplicatesOf(tx, input);
      if (dupes.length) throw new DuplicateClientError(dupes);
    }
    const number = await nextNumber(tx, ctx.organization.id, "client");
    const [row] = await tx
      .insert(clients)
      .values({ ...input, organizationId: ctx.organization.id, number, assignedUserId: ctx.user.userId })
      .returning();
    await audit(tx, ctx, "client.create", "client", row.id, { number }, opts.via);
    return row;
  });
}

export async function updateClient(ctx: Context, id: string, raw: ClientInput, via: Via = "web"): Promise<Client> {
  requirePermission(ctx.permissions, "clients.update");
  const input = clientInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .update(clients)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "client.update", "client", id, undefined, via);
    return row;
  });
}

export async function deleteClient(ctx: Context, id: string, via: Via = "web"): Promise<void> {
  requirePermission(ctx.permissions, "clients.delete");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(clients).where(eq(clients.id, id)).returning({ number: clients.number });
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "client.delete", "client", id, { number: row.number }, via);
  });
}

export class NotFoundError extends Error {
  constructor() {
    super("not found");
  }
}

export async function getClient(ctx: Context, id: string): Promise<Client> {
  requirePermission(ctx.permissions, "clients.read");
  const row = await withTenant(ctx.organization.id, async (tx) => {
    const [found] = await tx.select().from(clients).where(eq(clients.id, id)).limit(1);
    return found;
  });
  if (!row) throw new NotFoundError();
  return row;
}

export const SORTS = ["newest", "oldest", "name", "number"] as const;
export type ClientSort = (typeof SORTS)[number];

export type ClientQuery = {
  q?: string;
  status?: "LEAD" | "ACTIVE" | "INACTIVE";
  sort?: ClientSort;
  page?: number;
  pageSize?: number;
};

export async function listClients(ctx: Context, query: ClientQuery = {}) {
  requirePermission(ctx.permissions, "clients.read");
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const filters: SQL[] = [];
  const q = query.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const asNumber = Number.parseInt(q.replace(/\D/g, ""), 10);
    filters.push(
      or(
        ilike(clients.companyName, like),
        ilike(clients.firstName, like),
        ilike(clients.lastName, like),
        ilike(clients.email, like),
        ilike(clients.phone, like),
        ilike(clients.city, like),
        sql`exists (select 1 from unnest(${clients.tags}) as t(tag) where t.tag ilike ${like})`,
        ...(Number.isFinite(asNumber) ? [eq(clients.number, asNumber)] : []),
      )!,
    );
  }
  if (query.status) filters.push(eq(clients.status, query.status));
  const where = filters.length ? and(...filters) : undefined;
  const order = {
    newest: [desc(clients.createdAt)],
    oldest: [asc(clients.createdAt)],
    name: [asc(sql`lower(coalesce(${clients.companyName}, ${clients.lastName}, ${clients.firstName}))`)],
    number: [asc(clients.number)],
  }[query.sort ?? "newest"];
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select()
      .from(clients)
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(clients).where(where);
    return { rows, total, page, pageSize };
  });
}

const CSV_COLUMNS: [keyof Client, string][] = [
  ["number", "number"],
  ["type", "type"],
  ["status", "status"],
  ["companyName", "company"],
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["email", "email"],
  ["phone", "phone"],
  ["street", "street"],
  ["postalCode", "postal_code"],
  ["city", "city"],
  ["country", "country"],
  ["vatId", "vat_id"],
  ["tags", "tags"],
  ["source", "source"],
  ["createdAt", "created_at"],
];

function csvCell(value: unknown): string {
  const text =
    value == null ? "" : value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join("|") : String(value);
  // A leading = + - @ would be run as a formula by spreadsheet programs.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** All clients as CSV (semicolon separated, as German spreadsheets expect). */
export async function exportClientsCsv(ctx: Context): Promise<string> {
  requirePermission(ctx.permissions, "clients.read");
  const rows = await withTenant(ctx.organization.id, (tx) =>
    tx.select().from(clients).orderBy(asc(clients.number)),
  );
  const head = CSV_COLUMNS.map(([, name]) => name).join(";");
  const body = rows.map((r) => CSV_COLUMNS.map(([key]) => csvCell(r[key])).join(";"));
  return "﻿" + [head, ...body].join("\r\n");
}
