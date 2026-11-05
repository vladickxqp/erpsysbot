/**
 * One search over the modules: clients, invoices, orders, quotes, tasks,
 * projects, content, files and people — each only for those who may see it and
 * while its module is on. Exact names come first, then names that start with
 * the words, then the rest by how recent they are. Sentences such as "overdue
 * invoices" become filters (src/lib/smart-search.ts).
 */
import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { clients, contentItems, documents, invoices, orders, projects, quotes, tasks } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { readIntent, type SearchIntent } from "@/lib/smart-search";
import { displayName } from "./clients";
import type { Context } from "./context";
import { listInvoices } from "./invoices";
import { addDays, today } from "./money";
import { moduleOn } from "./modules";
import { overdueInvoices } from "./reminders";
import { listProjects, listTasks } from "./tasks";
import { memberOptions } from "./team";

export const SEARCH_KINDS = ["client", "project", "task", "invoice", "quote", "order", "content", "document", "person"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export type SearchHit = { kind: SearchKind; id: string; title: string; hint: string | null; href: string };
export type SearchPage = { hits: SearchHit[]; more: SearchKind[]; intent: SearchIntent | null };

const PER_KIND = 8;

/** Exact match, then starts with it, then anything else: a plain rule, no made-up scores. */
const rank = (column: Parameters<typeof ilike>[0], text: string): SQL => sql`case when lower(${column}) = lower(${text}) then 0 when lower(${column}) like lower(${`${text.replace(/[%_\\]/g, (m) => `\\${m}`)}%`}) then 1 else 2 end`;

function ways(ctx: Context) {
  const can = (p: Parameters<Context["permissions"]["has"]>[0], module?: Parameters<typeof moduleOn>[1]) => ctx.permissions.has(p) && (!module || !ctx.disabledModules.has(module));
  return {
    client: can("clients.read", "crm"),
    project: can("tasks.read", "tasks"),
    task: can("tasks.read", "tasks"),
    invoice: can("invoices.read", "invoices"),
    quote: can("orders.read", "quotes"),
    order: can("orders.read", "orders"),
    content: can("content.read", "content"),
    document: can("documents.read"),
    person: can("employees.read", "team"),
  } satisfies Record<SearchKind, boolean>;
}

/** Up to `limit` hits of the wanted kinds, each kind one more to learn whether there are further ones. */
export async function searchAll(ctx: Context, query: string, options: { kinds?: readonly SearchKind[]; offset?: number; limit?: number } = {}): Promise<SearchPage> {
  const text = query.trim().slice(0, 100);
  if (text.length < 2) return { hits: [], more: [], intent: null };
  const limit = Math.min(options.limit ?? PER_KIND, 50);
  const offset = Math.max(options.offset ?? 0, 0);
  const take = limit + 1;
  const like = `%${text.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const allowed = ways(ctx);
  const want = (kind: SearchKind) => allowed[kind] && (!options.kinds || options.kinds.includes(kind));

  const groups = await withTenant(ctx.organization.id, async (tx) => {
    const out: Partial<Record<SearchKind, SearchHit[]>> = {};
    if (want("client")) {
      const rows = await tx
        .select()
        .from(clients)
        .where(and(isNull(clients.archivedAt), or(ilike(clients.companyName, like), ilike(clients.firstName, like), ilike(clients.lastName, like), ilike(clients.email, like), ilike(clients.phone, like), ilike(clients.city, like))))
        .orderBy(rank(sql`coalesce(${clients.companyName}, ${clients.lastName})`, text), desc(clients.updatedAt))
        .limit(take)
        .offset(offset);
      out.client = rows.map((c) => ({ kind: "client", id: c.id, title: displayName(c), hint: c.email ?? c.city, href: `/app/clients/${c.id}` }));
    }
    if (want("project")) {
      const rows = await tx
        .select({ project: projects, client: clients })
        .from(projects)
        .leftJoin(clients, eq(clients.id, projects.clientId))
        .where(or(ilike(projects.name, like), ilike(clients.companyName, like), ilike(clients.lastName, like)))
        .orderBy(rank(projects.name, text), desc(projects.createdAt))
        .limit(take)
        .offset(offset);
      out.project = rows.map((r) => ({ kind: "project", id: r.project.id, title: r.project.name, hint: r.client ? displayName(r.client) : null, href: `/app/tasks/projects/${r.project.id}` }));
    }
    if (want("task")) {
      const rows = await tx.select().from(tasks).where(or(ilike(tasks.title, like), ilike(tasks.description, like))).orderBy(rank(tasks.title, text), desc(tasks.updatedAt)).limit(take).offset(offset);
      out.task = rows.map((t) => ({ kind: "task", id: t.id, title: t.title, hint: t.dueDate, href: `/app/tasks/${t.id}` }));
    }
    if (want("invoice")) {
      const rows = await tx
        .select({ invoice: invoices, client: clients })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(or(ilike(invoices.number, like), ilike(clients.companyName, like), ilike(clients.lastName, like)))
        .orderBy(rank(invoices.number, text), desc(invoices.createdAt))
        .limit(take)
        .offset(offset);
      out.invoice = rows.map((r) => ({ kind: "invoice", id: r.invoice.id, title: r.invoice.number ?? displayName(r.client), hint: displayName(r.client), href: `/app/invoices/${r.invoice.id}` }));
    }
    if (want("quote")) {
      const rows = await tx.select().from(quotes).where(or(ilike(quotes.number, like), ilike(quotes.title, like))).orderBy(rank(quotes.number, text), desc(quotes.createdAt)).limit(take).offset(offset);
      out.quote = rows.map((q) => ({ kind: "quote", id: q.id, title: q.number ?? q.title ?? "—", hint: q.title, href: `/app/quotes/${q.id}` }));
    }
    if (want("order")) {
      const rows = await tx.select().from(orders).where(ilike(orders.title, like)).orderBy(rank(orders.title, text), desc(orders.createdAt)).limit(take).offset(offset);
      out.order = rows.map((o) => ({ kind: "order", id: o.id, title: o.title ?? String(o.number), hint: null, href: `/app/orders/${o.id}` }));
    }
    if (want("content")) {
      const rows = await tx.select().from(contentItems).where(or(ilike(contentItems.title, like), ilike(contentItems.body, like))).orderBy(rank(contentItems.title, text), desc(contentItems.updatedAt)).limit(take).offset(offset);
      out.content = rows.map((c) => ({ kind: "content", id: c.id, title: c.title, hint: null, href: `/app/content/${c.id}` }));
    }
    if (want("document")) {
      const rows = await tx.select().from(documents).where(ilike(documents.name, like)).orderBy(rank(documents.name, text), desc(documents.createdAt)).limit(take).offset(offset);
      out.document = rows.map((d) => ({ kind: "document", id: d.id, title: d.name, hint: null, href: `/app/documents/${d.id}/file` }));
    }
    return out;
  });
  if (want("person")) {
    const found = (await memberOptions(ctx)).filter((m) => m.name.toLowerCase().includes(text.toLowerCase()));
    groups.person = found.slice(offset, offset + take).map((m) => ({ kind: "person", id: m.id, title: m.name, hint: null, href: "/app/team" }));
  }

  const hits: SearchHit[] = [];
  const more: SearchKind[] = [];
  for (const kind of SEARCH_KINDS) {
    const list = groups[kind] ?? [];
    if (list.length > limit) more.push(kind);
    hits.push(...list.slice(0, limit));
  }
  return { hits, more, intent: null };
}

/** The records a sentence asks for, through the modules' own lists. */
async function byIntent(ctx: Context, intent: SearchIntent): Promise<SearchHit[]> {
  const allowed = ways(ctx);
  const now = today(ctx.organization.timezone);
  if (intent.kind === "invoice" && allowed.invoice) {
    if (intent.overdue) return (await overdueInvoices(ctx)).slice(0, 30).map((i) => ({ kind: "invoice", id: i.id, title: i.number ?? i.clientName, hint: i.clientName, href: `/app/invoices/${i.id}` }));
    const list = await listInvoices(ctx, { filter: "OPEN", pageSize: 30, q: intent.name });
    return list.rows.map((i) => ({ kind: "invoice", id: i.id, title: i.number ?? i.clientName, hint: i.clientName, href: `/app/invoices/${i.id}` }));
  }
  if (intent.kind === "task" && allowed.task) {
    const rows = await listTasks(ctx, { open: intent.open || !!intent.period, overdue: intent.overdue, assignedUserId: intent.mine ? ctx.user.userId : undefined, q: intent.name });
    const until = intent.period === "today" ? now : intent.period === "week" ? addDays(now, 7 - ((new Date(`${now}T12:00:00Z`).getUTCDay() + 6) % 7) - 1) : null;
    return rows
      .filter((t) => !until || (!!t.dueDate && t.dueDate <= until))
      .slice(0, 30)
      .map((t) => ({ kind: "task", id: t.id, title: t.title, hint: t.dueDate, href: `/app/tasks/${t.id}` }));
  }
  if (intent.kind === "project" && allowed.project) {
    if (intent.name) return (await searchAll(ctx, intent.name, { kinds: ["project"], limit: 30 })).hits;
    return (await listProjects(ctx)).slice(0, 30).map((p) => ({ kind: "project", id: p.id, title: p.name, hint: p.dueDate, href: `/app/tasks/projects/${p.id}` }));
  }
  if (intent.kind === "client" && intent.unpaid && allowed.client && allowed.invoice) {
    const open = await withTenant(ctx.organization.id, (tx) =>
      tx
        .selectDistinct({ client: clients })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(and(eq(invoices.kind, "INVOICE"), inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID"])))
        .limit(30),
    );
    return open.map(({ client }) => ({ kind: "client", id: client.id, title: displayName(client), hint: client.email, href: `/app/clients/${client.id}` }));
  }
  return [];
}

/** A search box entry: a sentence becomes a filter, anything else the plain search. */
export async function searchSmart(ctx: Context, query: string, options: { kinds?: readonly SearchKind[]; offset?: number; limit?: number } = {}): Promise<SearchPage> {
  const intent = options.kinds || options.offset ? null : readIntent(query);
  if (intent) {
    const hits = await byIntent(ctx, intent);
    if (hits.length) return { hits, more: [], intent };
  }
  return searchAll(ctx, query, options);
}
