/**
 * What the assistant may do: the same server functions the pages use, called
 * with the person's own context — so their role and their company apply
 * exactly as in the app. It reads freely and creates clients, orders and
 * invoice drafts. Issuing, payments, cancelling and deleting stay in the app.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z, ZodError } from "zod";
import { INVOICE_FILTERS, ORDER_STATUSES } from "@/lib/domain";
import { createClient, displayName, DuplicateClientError, getClient, listClients, NotFoundError } from "../clients";
import type { Context } from "../context";
import { clientStats, invoiceStats, openOrderStats } from "../dashboard";
import { financeSummary } from "../finance";
import { createInvoiceDraft, getInvoice, listInvoices } from "../invoices";
import { today } from "../money";
import { createOrder, listOrders } from "../orders";
import { ForbiddenError, type Permission } from "../permissions";
import { listProducts } from "../products";
import type { Via } from "../audit";
import { CalendarError, createAppointment, dayBounds, listAppointments, localParts, zonedTime } from "../calendar";
import { DEAL_STAGES, listDeals, saveDeal } from "../deals";
import { createTask, listTasks } from "../tasks";

const eur = (cents: number) => Math.round(cents) / 100;
const id = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const lineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(20).optional(),
  unit_price_eur: z.number().min(-1_000_000).max(1_000_000),
  vat_rate: z.union([z.literal(19), z.literal(7), z.literal(0)]).optional(),
  discount_percent: z.number().min(0).max(100).optional(),
  product_id: id.optional(),
});

const lineJson = {
  type: "object",
  properties: {
    description: { type: "string" },
    quantity: { type: "number" },
    unit: { type: "string", description: "e.g. Std, Stk, pauschal" },
    unit_price_eur: { type: "number", description: "Net unit price in euros" },
    vat_rate: { type: "integer", enum: [19, 7, 0], description: "Defaults to 19" },
    discount_percent: { type: "number" },
    product_id: { type: "string", description: "From list_products, if the line is a catalogue item" },
  },
  required: ["description", "quantity", "unit_price_eur"],
} as const;

const toLines = (items: z.infer<typeof lineSchema>[]) =>
  items.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unit: l.unit ?? "Stk",
    unitPriceCents: Math.round(l.unit_price_eur * 100),
    vatRate: l.vat_rate ?? 19,
    discountPercent: l.discount_percent ?? 0,
    productId: l.product_id ?? null,
  }));

type Tool = {
  definition: Anthropic.Beta.BetaTool;
  input: z.ZodTypeAny;
  run: (ctx: Context, input: never, via: Via) => Promise<unknown>;
};

function tool<S extends z.ZodTypeAny>(
  definition: Anthropic.Beta.BetaTool,
  input: S,
  run: (ctx: Context, input: z.infer<S>, via: Via) => Promise<unknown>,
): Tool {
  return { definition, input, run: run as Tool["run"] };
}

export const TOOLS: Tool[] = [
  tool(
    {
      name: "business_overview",
      description:
        "Key figures of the company right now: income, expenses and result this month, unpaid and overdue invoices, open orders, client counts. Use for questions like 'how are we doing'.",
      input_schema: { type: "object", properties: {} },
    },
    z.object({}),
    async (ctx) => {
      const has = (p: Permission) => ctx.permissions.has(p);
      const now = today(ctx.organization.timezone);
      const [money, owed, open, clients] = await Promise.all([
        has("finance.read") ? financeSummary(ctx, `${now.slice(0, 7)}-01`, now) : null,
        has("invoices.read") ? invoiceStats(ctx) : null,
        has("orders.read") ? openOrderStats(ctx) : null,
        has("clients.read") ? clientStats(ctx) : null,
      ]);
      return {
        today: now,
        month: money && { income_eur: eur(money.incomeCents - money.refundCents), expenses_eur: eur(money.expenseCents), result_eur: eur(money.resultCents) },
        unpaid_invoices: owed && { count: owed.outstanding, open_eur: eur(owed.outstandingCents), overdue_count: owed.overdue, overdue_eur: eur(owed.overdueCents) },
        open_orders: open && { count: open.count, net_eur: eur(open.netCents) },
        clients: clients && { total: clients.total, active: clients.active, leads: clients.leads, new_this_month: clients.newThisMonth },
      };
    },
  ),
  tool(
    {
      name: "search_clients",
      description: "Find clients by name, email, phone, city, tag or client number. Empty query lists the most recent.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" }, status: { type: "string", enum: ["LEAD", "ACTIVE", "INACTIVE"] } },
      },
    },
    z.object({ query: z.string().max(200).optional(), status: z.enum(["LEAD", "ACTIVE", "INACTIVE"]).optional() }),
    async (ctx, input) => {
      const result = await listClients(ctx, { q: input.query, status: input.status, pageSize: 15 });
      return {
        total: result.total,
        clients: result.rows.map((c) => ({ id: c.id, number: c.number, name: displayName(c), status: c.status, email: c.email, phone: c.phone, city: c.city })),
      };
    },
  ),
  tool(
    {
      name: "get_client",
      description: "All details of one client, including notes.",
      input_schema: { type: "object", properties: { client_id: { type: "string" } }, required: ["client_id"] },
    },
    z.object({ client_id: id }),
    async (ctx, input) => {
      const c = await getClient(ctx, input.client_id);
      return {
        id: c.id,
        number: c.number,
        name: displayName(c),
        type: c.type,
        status: c.status,
        email: c.email,
        phone: c.phone,
        address: [c.street, [c.postalCode, c.city].filter(Boolean).join(" "), c.country].filter(Boolean).join(", "),
        vat_id: c.vatId,
        tags: c.tags,
        notes: c.notes,
        created: c.createdAt.toISOString().slice(0, 10),
      };
    },
  ),
  tool(
    {
      name: "create_client",
      description:
        "Create a client. If a likely duplicate exists the tool returns the candidates instead; ask the user, and only call again with allow_duplicate true when they confirm it is a different client.",
      input_schema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["PERSON", "COMPANY"] },
          company_name: { type: "string" },
          first_name: { type: "string" },
          last_name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          street: { type: "string" },
          postal_code: { type: "string" },
          city: { type: "string" },
          status: { type: "string", enum: ["LEAD", "ACTIVE"] },
          notes: { type: "string" },
          allow_duplicate: { type: "boolean" },
        },
      },
    },
    z.object({
      type: z.enum(["PERSON", "COMPANY"]).optional(),
      company_name: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      street: z.string().optional(),
      postal_code: z.string().optional(),
      city: z.string().optional(),
      status: z.enum(["LEAD", "ACTIVE"]).optional(),
      notes: z.string().optional(),
      allow_duplicate: z.boolean().optional(),
    }),
    async (ctx, input, via) => {
      try {
        const c = await createClient(
          ctx,
          {
            type: input.type ?? (input.company_name ? "COMPANY" : "PERSON"),
            companyName: input.company_name,
            firstName: input.first_name,
            lastName: input.last_name,
            email: input.email,
            phone: input.phone,
            street: input.street,
            postalCode: input.postal_code,
            city: input.city,
            status: input.status,
            notes: input.notes,
            source: via === "telegram" ? "Telegram" : undefined,
          },
          { allowDuplicate: input.allow_duplicate === true, via: "ai" },
        );
        return { created: true, id: c.id, number: c.number, name: displayName(c) };
      } catch (e) {
        if (e instanceof DuplicateClientError) {
          return {
            created: false,
            possible_duplicates: e.candidates.map((c) => ({ id: c.id, number: c.number, name: displayName(c), email: c.email, phone: c.phone })),
          };
        }
        throw e;
      }
    },
  ),
  tool(
    {
      name: "list_invoices",
      description: "Invoices and credit notes, newest first. Filter OPEN = issued and not fully paid, OVERDUE = open and past due.",
      input_schema: {
        type: "object",
        properties: { filter: { type: "string", enum: [...INVOICE_FILTERS] }, query: { type: "string", description: "Invoice number or client name" } },
      },
    },
    z.object({ filter: z.enum(INVOICE_FILTERS).optional(), query: z.string().max(200).optional() }),
    async (ctx, input) => {
      const result = await listInvoices(ctx, { filter: input.filter, q: input.query, pageSize: 20 });
      return {
        total: result.total,
        invoices: result.rows.map((i) => ({
          id: i.id,
          number: i.number ?? "draft",
          kind: i.kind,
          status: i.status,
          overdue: i.overdue,
          client: i.clientName,
          issue_date: i.issueDate,
          due_date: i.dueDate,
          gross_eur: eur(i.grossCents),
          open_eur: eur(i.grossCents - i.paidCents),
        })),
      };
    },
  ),
  tool(
    {
      name: "get_invoice",
      description: "One invoice with its lines and payments.",
      input_schema: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"] },
    },
    z.object({ invoice_id: id }),
    async (ctx, input) => {
      const { invoice: i, items, payments, clientName, related } = await getInvoice(ctx, input.invoice_id);
      return {
        id: i.id,
        number: i.number ?? "draft",
        kind: i.kind,
        status: i.status,
        client: clientName,
        issue_date: i.issueDate,
        due_date: i.dueDate,
        net_eur: eur(i.netCents),
        vat_eur: eur(i.vatCents),
        gross_eur: eur(i.grossCents),
        paid_eur: eur(i.paidCents),
        lines: items.map((l) => ({ description: l.description, quantity: Number(l.quantity), unit: l.unit, unit_price_eur: eur(l.unitPriceCents), vat_rate: l.vatRate, net_eur: eur(l.netCents) })),
        payments: payments.map((p) => ({ date: p.paidOn, amount_eur: eur(p.amountCents), method: p.method })),
        related: related.map((r) => ({ id: r.id, number: r.number, kind: r.kind })),
      };
    },
  ),
  tool(
    {
      name: "create_invoice_draft",
      description:
        "Create an invoice DRAFT for a client. It gets no number and is not sent; the user reviews and issues it in the app. Prices are net.",
      input_schema: {
        type: "object",
        properties: {
          client_id: { type: "string" },
          items: { type: "array", items: lineJson },
          service_date: { type: "string", description: "YYYY-MM-DD" },
          notes: { type: "string" },
        },
        required: ["client_id", "items"],
      },
    },
    z.object({ client_id: id, items: z.array(lineSchema).min(1).max(50), service_date: isoDate.optional(), notes: z.string().max(2000).optional() }),
    async (ctx, input, via) => {
      const draft = await createInvoiceDraft(
        ctx,
        { clientId: input.client_id, serviceDate: input.service_date, notes: input.notes, items: toLines(input.items) },
        via === "telegram" ? "telegram" : "ai",
      );
      return { created: true, id: draft.id, status: "DRAFT", net_eur: eur(draft.netCents), gross_eur: eur(draft.grossCents), link: `/app/invoices/${draft.id}` };
    },
  ),
  tool(
    {
      name: "list_orders",
      description: "Orders, newest first. status OPEN = not yet done or cancelled.",
      input_schema: {
        type: "object",
        properties: { status: { type: "string", enum: ["OPEN", ...ORDER_STATUSES] }, query: { type: "string" } },
      },
    },
    z.object({ status: z.enum(["OPEN", ...ORDER_STATUSES]).optional(), query: z.string().max(200).optional() }),
    async (ctx, input) => {
      const result = await listOrders(ctx, { status: input.status, q: input.query, pageSize: 20 });
      return {
        total: result.total,
        orders: result.rows.map((o) => ({ id: o.id, number: o.number, title: o.title, status: o.status, client: o.clientName, due_date: o.dueDate, net_eur: eur(o.netCents) })),
      };
    },
  ),
  tool(
    {
      name: "create_order",
      description: "Create an order (status NEW) for a client. Prices are net.",
      input_schema: {
        type: "object",
        properties: {
          client_id: { type: "string" },
          title: { type: "string" },
          items: { type: "array", items: lineJson },
          due_date: { type: "string", description: "YYYY-MM-DD" },
          notes: { type: "string" },
        },
        required: ["client_id", "items"],
      },
    },
    z.object({
      client_id: id,
      title: z.string().max(200).optional(),
      items: z.array(lineSchema).min(1).max(50),
      due_date: isoDate.optional(),
      notes: z.string().max(2000).optional(),
    }),
    async (ctx, input, via) => {
      const order = await createOrder(
        ctx,
        { clientId: input.client_id, title: input.title, dueDate: input.due_date, notes: input.notes, items: toLines(input.items) },
        via === "telegram" ? "telegram" : "ai",
      );
      return { created: true, id: order.id, number: order.number, net_eur: eur(order.netCents), link: `/app/orders/${order.id}` };
    },
  ),
  tool(
    {
      name: "finance_summary",
      description: "Income, expenses, refunds and result between two dates (inclusive).",
      input_schema: {
        type: "object",
        properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } },
        required: ["from", "to"],
      },
    },
    z.object({ from: isoDate, to: isoDate }),
    async (ctx, input) => {
      const s = await financeSummary(ctx, input.from, input.to);
      return {
        from: input.from,
        to: input.to,
        income_eur: eur(s.incomeCents),
        refunds_eur: eur(s.refundCents),
        expenses_eur: eur(s.expenseCents),
        adjustments_eur: eur(s.adjustmentCents),
        result_eur: eur(s.resultCents),
      };
    },
  ),
  tool(
    {
      name: "list_products",
      description: "The catalogue of products and services with net prices.",
      input_schema: { type: "object", properties: { query: { type: "string" } } },
    },
    z.object({ query: z.string().max(200).optional() }),
    async (ctx, input) => {
      const rows = await listProducts(ctx, { q: input.query, activeOnly: true });
      return rows.slice(0, 40).map((p) => ({ id: p.id, name: p.name, kind: p.kind, unit: p.unit, price_eur: eur(p.priceCents), vat_rate: p.vatRate }));
    },
  ),
  tool(
    {
      name: "list_appointments",
      description: "Appointments between two dates (inclusive, company time zone). mine=true for only the user's own.",
      input_schema: {
        type: "object",
        properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" }, mine: { type: "boolean" } },
        required: ["from", "to"],
      },
    },
    z.object({ from: isoDate, to: isoDate, mine: z.boolean().optional() }),
    async (ctx, input) => {
      const tz = ctx.organization.timezone;
      const rows = await listAppointments(ctx, {
        from: dayBounds(input.from, tz).from,
        to: dayBounds(input.to, tz).to,
        userId: input.mine ? ctx.user.userId : undefined,
      });
      return rows.slice(0, 60).map((a) => ({
        id: a.id,
        title: a.title,
        date: localParts(a.startsAt, tz).date,
        start: localParts(a.startsAt, tz).time,
        end: localParts(a.endsAt, tz).time,
        client: a.clientName,
        location: a.location,
        status: a.status,
      }));
    },
  ),
  tool(
    {
      name: "create_appointment",
      description: "Book an appointment in the company calendar (local time). Refused if it overlaps another appointment of the same person.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          start: { type: "string", description: "HH:MM, 24h" },
          duration_minutes: { type: "integer", description: "Defaults to 60" },
          client_id: { type: "string" },
          location: { type: "string" },
          notes: { type: "string" },
        },
        required: ["title", "date", "start"],
      },
    },
    z.object({
      title: z.string().trim().min(1).max(200),
      date: isoDate,
      start: z.string().regex(/^\d{2}:\d{2}$/),
      duration_minutes: z.number().int().min(5).max(24 * 60).optional(),
      client_id: id.optional(),
      location: z.string().max(200).optional(),
      notes: z.string().max(2000).optional(),
    }),
    async (ctx, input, via) => {
      const startsAt = zonedTime(input.date, input.start, ctx.organization.timezone);
      try {
        const [row] = await createAppointment(
          ctx,
          {
            title: input.title,
            clientId: input.client_id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + (input.duration_minutes ?? 60) * 60_000),
            location: input.location,
            notes: input.notes,
          },
          via === "telegram" ? "telegram" : "ai",
        );
        return { created: true, id: row.id, link: `/app/calendar?view=day&date=${input.date}` };
      } catch (e) {
        if (e instanceof CalendarError && e.code === "OVERLAP") return { created: false, overlaps_with: e.clash?.title };
        throw e;
      }
    },
  ),
  tool(
    {
      name: "list_tasks",
      description: "Open tasks (not done). mine=true for the user's own; overdue=true for those past their due date.",
      input_schema: { type: "object", properties: { mine: { type: "boolean" }, overdue: { type: "boolean" }, query: { type: "string" } } },
    },
    z.object({ mine: z.boolean().optional(), overdue: z.boolean().optional(), query: z.string().max(200).optional() }),
    async (ctx, input) => {
      const rows = await listTasks(ctx, { open: true, overdue: input.overdue, q: input.query, assignedUserId: input.mine ? ctx.user.userId : undefined });
      return rows.slice(0, 40).map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, due: task.dueDate, project: task.projectName, client: task.clientName }));
    },
  ),
  tool(
    {
      name: "create_task",
      description: "Create a task, by default for the user themselves. Can be linked to a client or an order.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          due_date: { type: "string", description: "YYYY-MM-DD" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
          client_id: { type: "string" },
          order_id: { type: "string" },
        },
        required: ["title"],
      },
    },
    z.object({
      title: z.string().trim().min(1).max(300),
      description: z.string().max(5000).optional(),
      due_date: isoDate.optional(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
      client_id: id.optional(),
      order_id: id.optional(),
    }),
    async (ctx, input, via) => {
      const task = await createTask(
        ctx,
        { title: input.title, description: input.description, dueDate: input.due_date, priority: input.priority, clientId: input.client_id, orderId: input.order_id },
        via === "telegram" ? "telegram" : "ai",
      );
      return { created: true, id: task.id, link: "/app/tasks?mine=1" };
    },
  ),
  tool(
    {
      name: "list_deals",
      description: "The sales pipeline: open opportunities (and those closed in the last 30 days) with stage, value and next follow-up.",
      input_schema: { type: "object", properties: {} },
    },
    z.object({}),
    async (ctx) => {
      const rows = await listDeals(ctx);
      return rows.slice(0, 60).map((d) => ({ id: d.id, title: d.title, client: d.clientName, stage: d.stage, value_eur: eur(d.valueCents), next_follow_up: d.nextFollowUp }));
    },
  ),
  tool(
    {
      name: "create_deal",
      description: "Add a sales opportunity for a client or lead to the pipeline.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          client_id: { type: "string" },
          value_eur: { type: "number" },
          stage: { type: "string", enum: [...DEAL_STAGES] },
          next_follow_up: { type: "string", description: "YYYY-MM-DD" },
          notes: { type: "string" },
        },
        required: ["title", "client_id"],
      },
    },
    z.object({
      title: z.string().trim().min(1).max(200),
      client_id: id,
      value_eur: z.number().min(0).max(100_000_000).optional(),
      stage: z.enum(DEAL_STAGES).optional(),
      next_follow_up: isoDate.optional(),
      notes: z.string().max(5000).optional(),
    }),
    async (ctx, input, via) => {
      const deal = await saveDeal(
        ctx,
        null,
        {
          title: input.title,
          clientId: input.client_id,
          valueCents: Math.round((input.value_eur ?? 0) * 100),
          stage: input.stage,
          nextFollowUp: input.next_follow_up,
          notes: input.notes,
        },
        via === "telegram" ? "telegram" : "ai",
      );
      return { created: true, id: deal.id, link: "/app/pipeline" };
    },
  ),
];

export const TOOL_DEFINITIONS = TOOLS.map((t) => t.definition);

/** Runs one tool call; every failure becomes an error result the model can read. */
export async function runTool(ctx: Context, name: string, raw: unknown, via: Via): Promise<{ content: string; isError: boolean }> {
  const found = TOOLS.find((t) => t.definition.name === name);
  if (!found) return { content: `Unknown tool ${name}`, isError: true };
  const parsed = found.input.safeParse(raw ?? {});
  if (!parsed.success) return { content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, isError: true };
  try {
    const result = await found.run(ctx, parsed.data as never, via);
    return { content: JSON.stringify(result), isError: false };
  } catch (e) {
    if (e instanceof ForbiddenError) return { content: "This user is not allowed to do that.", isError: true };
    if (e instanceof NotFoundError) return { content: "Not found.", isError: true };
    if (e instanceof ZodError) return { content: `Invalid data: ${e.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, isError: true };
    if (e instanceof Error && "code" in e) return { content: `Refused: ${String((e as { code: unknown }).code)}`, isError: true };
    throw e;
  }
}
