/**
 * One search over the modules: clients, invoices, orders, quotes, tasks,
 * projects, content and files — each only for those who may see it and while
 * its module is on.
 */
import { desc, eq, ilike, isNull, or, and } from "drizzle-orm";
import { clients, contentItems, documents, invoices, orders, projects, quotes, tasks } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { displayName } from "./clients";
import type { Context } from "./context";

export type SearchHit = { kind: string; id: string; title: string; hint: string | null; href: string };

const LIMIT = 8;

export async function searchAll(ctx: Context, query: string): Promise<SearchHit[]> {
  const text = query.trim().slice(0, 100);
  if (text.length < 2) return [];
  const like = `%${text.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const can = (p: Parameters<Context["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  return withTenant(ctx.organization.id, async (tx) => {
    const hits: SearchHit[] = [];
    if (can("clients.read")) {
      const rows = await tx
        .select()
        .from(clients)
        .where(and(isNull(clients.archivedAt), or(ilike(clients.companyName, like), ilike(clients.firstName, like), ilike(clients.lastName, like), ilike(clients.email, like), ilike(clients.phone, like), ilike(clients.city, like))))
        .limit(LIMIT);
      for (const c of rows) hits.push({ kind: "client", id: c.id, title: displayName(c), hint: c.email ?? c.city, href: `/app/clients/${c.id}` });
    }
    if (can("invoices.read")) {
      const rows = await tx
        .select({ invoice: invoices, client: clients })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(or(ilike(invoices.number, like), ilike(clients.companyName, like), ilike(clients.lastName, like)))
        .orderBy(desc(invoices.createdAt))
        .limit(LIMIT);
      for (const r of rows) hits.push({ kind: "invoice", id: r.invoice.id, title: r.invoice.number ?? displayName(r.client), hint: displayName(r.client), href: `/app/invoices/${r.invoice.id}` });
    }
    if (can("orders.read") && !ctx.disabledModules.has("orders")) {
      const rows = await tx.select().from(orders).where(ilike(orders.title, like)).orderBy(desc(orders.createdAt)).limit(LIMIT);
      for (const o of rows) hits.push({ kind: "order", id: o.id, title: o.title ?? String(o.number), hint: null, href: `/app/orders/${o.id}` });
    }
    if (can("orders.read") && !ctx.disabledModules.has("quotes")) {
      const rows = await tx.select().from(quotes).where(or(ilike(quotes.number, like), ilike(quotes.title, like))).orderBy(desc(quotes.createdAt)).limit(LIMIT);
      for (const q of rows) hits.push({ kind: "quote", id: q.id, title: q.number ?? q.title ?? "—", hint: q.title, href: `/app/quotes/${q.id}` });
    }
    if (can("tasks.read")) {
      const found = await tx.select().from(tasks).where(ilike(tasks.title, like)).orderBy(desc(tasks.createdAt)).limit(LIMIT);
      for (const t of found) hits.push({ kind: "task", id: t.id, title: t.title, hint: null, href: `/app/tasks/${t.id}` });
      const list = await tx.select().from(projects).where(ilike(projects.name, like)).limit(LIMIT);
      for (const p of list) hits.push({ kind: "project", id: p.id, title: p.name, hint: null, href: `/app/tasks/projects/${p.id}` });
    }
    if (can("content.read") && !ctx.disabledModules.has("content")) {
      const rows = await tx.select().from(contentItems).where(or(ilike(contentItems.title, like), ilike(contentItems.body, like))).orderBy(desc(contentItems.updatedAt)).limit(LIMIT);
      for (const c of rows) hits.push({ kind: "content", id: c.id, title: c.title, hint: null, href: `/app/content/${c.id}` });
    }
    if (can("documents.read")) {
      const rows = await tx.select().from(documents).where(ilike(documents.name, like)).orderBy(desc(documents.createdAt)).limit(LIMIT);
      for (const d of rows) hits.push({ kind: "document", id: d.id, title: d.name, hint: null, href: `/app/documents/${d.id}/file` });
    }
    return hits;
  });
}
