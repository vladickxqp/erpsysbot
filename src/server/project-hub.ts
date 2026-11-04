/**
 * One project, everything around it: its client, tasks, time, files, costs
 * and the invoices made from its time — each module's own data, shown
 * together and only as far as the person may see that module.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { clients, documents, invoices, projects, tasks, timeEntries, transactions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { createTransaction } from "./finance";
import { requirePermission } from "./permissions";
import { minutesOf } from "./time";

export async function projectHub(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "tasks.read");
  const can = (p: Parameters<Context["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .select({ project: projects, client: clients })
      .from(projects)
      .leftJoin(clients, eq(clients.id, projects.clientId))
      .where(eq(projects.id, id))
      .limit(1);
    if (!row) throw new NotFoundError();
    const projectTasks = await tx.select().from(tasks).where(eq(tasks.projectId, id)).orderBy(desc(tasks.createdAt)).limit(200);
    const time = can("time.read") ? await tx.select().from(timeEntries).where(and(eq(timeEntries.projectId, id), isNotNull(timeEntries.endedAt))) : [];
    const files = can("documents.read")
      ? await tx.select({ id: documents.id, name: documents.name, createdAt: documents.createdAt }).from(documents).where(eq(documents.projectId, id)).orderBy(desc(documents.createdAt)).limit(100)
      : [];
    const costs = can("finance.read") ? await tx.select().from(transactions).where(and(eq(transactions.projectId, id), eq(transactions.type, "EXPENSE"))).orderBy(desc(transactions.bookedOn)).limit(100) : [];
    const invoiceIds = [...new Set(time.map((e) => e.invoiceId).filter((v): v is string => !!v))];
    const billed = can("invoices.read") && invoiceIds.length ? await tx.select().from(invoices).where(inArray(invoices.id, invoiceIds)) : [];
    return {
      project: row.project,
      clientName: row.client ? displayName(row.client) : null,
      tasks: projectTasks,
      minutes: time.reduce((sum, e) => sum + minutesOf(e), 0),
      unbilledMinutes: time.filter((e) => e.billable && !e.invoiceId).reduce((sum, e) => sum + minutesOf(e), 0),
      files,
      costs,
      costCents: costs.reduce((sum, c) => sum + c.amountCents, 0),
      invoices: billed,
      revenueCents: billed.reduce((sum, i) => sum + i.grossCents, 0),
      shows: { time: can("time.read"), files: can("documents.read"), costs: can("finance.read"), invoices: can("invoices.read") },
    };
  });
}

/** A cost of the project: an expense in finance, linked to it. */
export async function addProjectCost(ctx: Context, projectId: string, amountCents: number, bookedOn: string, description: string): Promise<void> {
  const [found] = await withTenant(ctx.organization.id, (tx) => tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)));
  if (!found) throw new NotFoundError();
  await createTransaction(ctx, { type: "EXPENSE", amountCents, bookedOn, description, category: "other", projectId });
}
