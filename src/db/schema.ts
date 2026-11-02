/**
 * The database, table by table.
 *
 * Two kinds of tables:
 *
 * - **Platform tables** (users, sessions, organizations, memberships) are
 *   read by the server on behalf of the platform: who is logged in, which
 *   companies they belong to. Code reaches them only through src/server.
 * - **Tenant tables** carry `organization_id` and are protected by Row Level
 *   Security (db/rls.sql): every query runs inside `withTenant()`, which
 *   switches to the `app_tenant` role and names the company, and Postgres
 *   itself refuses rows of any other company. A bug in a query cannot leak
 *   another company's data.
 *
 * Money is stored in cents (integer), never as floating point.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const orgId = () => uuid("organization_id").notNull();

// --- Platform -----------------------------------------------------------------------------
export const roleEnum = pgEnum("member_role", [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "EMPLOYEE",
  "ACCOUNTANT",
  "CUSTOM",
]);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    locale: text("locale").notNull().default("de"),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the cookie token: a leaked table holds no usable session. */
    tokenHash: text("token_hash").notNull(),
    activeOrganizationId: uuid("active_organization_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_key").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  vatId: text("vat_id"),
  street: text("street"),
  postalCode: text("postal_code"),
  city: text("city"),
  country: text("country").notNull().default("DE"),
  email: text("email"),
  phone: text("phone"),
  iban: text("iban"),
  bic: text("bic"),
  bankName: text("bank_name"),
  /** Steuernummer — an invoice names it or the VAT ID. */
  taxNumber: text("tax_number"),
  website: text("website"),
  /** Kleinunternehmer (§ 19 UStG): invoices without VAT, with the note. */
  smallBusiness: boolean("small_business").notNull().default(false),
  paymentTermsDays: integer("payment_terms_days").notNull().default(14),
  /** {YYYY} year, {NNNN} running number (zero-padded to the N count). */
  invoiceNumberFormat: text("invoice_number_format").notNull().default("RE-{YYYY}-{NNNN}"),
  creditNoteNumberFormat: text("credit_note_number_format").notNull().default("GS-{YYYY}-{NNNN}"),
  invoiceFooter: text("invoice_footer"),
  currency: text("currency").notNull().default("EUR"),
  locale: text("locale").notNull().default("de"),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("EMPLOYEE"),
    /** For CUSTOM: exactly these permissions. For the others: added on top. */
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_key").on(t.organizationId, t.userId)],
);

/** An invitation into a company (one-time link, 7 days). Only the hash is stored. */
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: roleEnum("role").notNull().default("EMPLOYEE"),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invitations_token_key").on(t.tokenHash), index("invitations_org_idx").on(t.organizationId)],
);

/** "Forgot password" links: one hour, one use. Only the hash is stored. */
export const passwordResets = pgTable(
  "password_resets",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("password_resets_user_idx").on(t.userId)],
);

/** A Telegram account linked to a user: one each way. The bot works for the
 *  company stored here (switchable in the chat). */
export const telegramLinks = pgTable(
  "telegram_links",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    telegramUserId: text("telegram_user_id").notNull(),
    chatId: text("chat_id").notNull(),
    username: text("username"),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("telegram_links_user_key").on(t.userId), uniqueIndex("telegram_links_tg_key").on(t.telegramUserId)],
);

/** One-time codes behind the "connect Telegram" link (SHA-256, short-lived). */
export const telegramLinkTokens = pgTable(
  "telegram_link_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("telegram_link_tokens_user_idx").on(t.userId)],
);

// --- Tenant -------------------------------------------------------------------------------
/** Running numbers per company (client numbers, later invoice numbers). */
export const counters = pgTable(
  "counters",
  {
    organizationId: orgId(),
    key: text("key").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);

export const clientTypeEnum = pgEnum("client_type", ["PERSON", "COMPANY"]);
export const clientStatusEnum = pgEnum("client_status", ["LEAD", "ACTIVE", "INACTIVE"]);

export const clients = pgTable(
  "clients",
  {
    id: id(),
    organizationId: orgId(),
    number: integer("number").notNull(),
    type: clientTypeEnum("type").notNull().default("PERSON"),
    status: clientStatusEnum("status").notNull().default("ACTIVE"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    companyName: text("company_name"),
    email: text("email"),
    phone: text("phone"),
    street: text("street"),
    postalCode: text("postal_code"),
    city: text("city"),
    country: text("country").notNull().default("DE"),
    vatId: text("vat_id"),
    notes: text("notes"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    source: text("source"),
    assignedUserId: uuid("assigned_user_id"),
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("clients_org_number_key").on(t.organizationId, t.number),
    index("clients_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

// --- Products and services ------------------------------------------------------------------
export const productKindEnum = pgEnum("product_kind", ["PRODUCT", "SERVICE"]);

export const products = pgTable(
  "products",
  {
    id: id(),
    organizationId: orgId(),
    kind: productKindEnum("kind").notNull().default("SERVICE"),
    name: text("name").notNull(),
    sku: text("sku"),
    description: text("description"),
    unit: text("unit").notNull().default("Stk"),
    /** Net price in cents. */
    priceCents: integer("price_cents").notNull().default(0),
    vatRate: integer("vat_rate").notNull().default(19),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_org_name_idx").on(t.organizationId, t.name)],
);

// --- Orders ------------------------------------------------------------------------------------
export const orderStatusEnum = pgEnum("order_status", [
  "DRAFT",
  "NEW",
  "CONFIRMED",
  "IN_PROGRESS",
  "WAITING",
  "COMPLETED",
  "CANCELLED",
]);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    organizationId: orgId(),
    number: integer("number").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    status: orderStatusEnum("status").notNull().default("NEW"),
    title: text("title"),
    notes: text("notes"),
    dueDate: date("due_date"),
    assignedUserId: uuid("assigned_user_id"),
    netCents: integer("net_cents").notNull().default(0),
    vatCents: integer("vat_cents").notNull().default(0),
    grossCents: integer("gross_cents").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_org_number_key").on(t.organizationId, t.number),
    index("orders_org_status_idx").on(t.organizationId, t.status),
    index("orders_client_idx").on(t.clientId),
  ],
);

/** A line of an order or an invoice: what, how many, at which net price. */
const lineColumns = () => ({
  id: id(),
  organizationId: orgId(),
  position: integer("position").notNull(),
  productId: uuid("product_id"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: text("unit").notNull().default("Stk"),
  unitPriceCents: integer("unit_price_cents").notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  vatRate: integer("vat_rate").notNull(),
  netCents: integer("net_cents").notNull(),
});

export const orderItems = pgTable(
  "order_items",
  {
    ...lineColumns(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

// --- Invoices ----------------------------------------------------------------------------------
export const invoiceKindEnum = pgEnum("invoice_kind", ["INVOICE", "CREDIT_NOTE"]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "DRAFT",
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
]);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    organizationId: orgId(),
    kind: invoiceKindEnum("kind").notNull().default("INVOICE"),
    status: invoiceStatusEnum("status").notNull().default("DRAFT"),
    /** Given when issued, never before: drafts have none, numbers have no gaps. */
    number: text("number"),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    /** The invoice a credit note corrects. */
    correctsId: uuid("corrects_id"),
    issueDate: date("issue_date"),
    serviceDate: date("service_date"),
    dueDate: date("due_date"),
    notes: text("notes"),
    /** Seller and buyer as they were when issued: later edits do not change it. */
    sellerSnapshot: jsonb("seller_snapshot"),
    buyerSnapshot: jsonb("buyer_snapshot"),
    netCents: integer("net_cents").notNull().default(0),
    vatCents: integer("vat_cents").notNull().default(0),
    grossCents: integer("gross_cents").notNull().default(0),
    paidCents: integer("paid_cents").notNull().default(0),
    smallBusiness: boolean("small_business").notNull().default(false),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_org_number_key").on(t.organizationId, t.number),
    index("invoices_org_status_idx").on(t.organizationId, t.status),
    index("invoices_client_idx").on(t.clientId),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    ...lineColumns(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
  },
  (t) => [index("invoice_items_invoice_idx").on(t.invoiceId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    organizationId: orgId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    paidOn: date("paid_on").notNull(),
    method: text("method").notNull().default("TRANSFER"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)],
);

// --- Finance -----------------------------------------------------------------------------------
export const transactionTypeEnum = pgEnum("transaction_type", ["INCOME", "EXPENSE", "REFUND", "ADJUSTMENT"]);

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    organizationId: orgId(),
    type: transactionTypeEnum("type").notNull(),
    /** Always positive; the type says which way the money went. */
    amountCents: integer("amount_cents").notNull(),
    bookedOn: date("booked_on").notNull(),
    category: text("category"),
    description: text("description"),
    method: text("method"),
    invoiceId: uuid("invoice_id"),
    paymentId: uuid("payment_id"),
    clientId: uuid("client_id"),
    createdAt: createdAt(),
  },
  (t) => [index("transactions_org_date_idx").on(t.organizationId, t.bookedOn)],
);

// --- Assistant ---------------------------------------------------------------------------------
export const assistantChannelEnum = pgEnum("assistant_channel", ["web", "telegram"]);
export const assistantRoleEnum = pgEnum("assistant_role", ["user", "assistant"]);

/** The assistant conversation per person and channel (text only, no tool details). */
export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: assistantChannelEnum("channel").notNull(),
    role: assistantRoleEnum("role").notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("assistant_messages_conv_idx").on(t.organizationId, t.userId, t.channel, t.createdAt)],
);

/** Who did what, from where (web, telegram, ai). Append-only. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    via: text("via").notNull().default("web"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_created_idx").on(t.organizationId, t.createdAt)],
);

/** Every table guarded by Row Level Security (db/rls.sql keeps the same list). */
export const TENANT_TABLES = [
  "counters",
  "clients",
  "audit_log",
  "products",
  "orders",
  "order_items",
  "invoices",
  "invoice_items",
  "payments",
  "transactions",
  "assistant_messages",
] as const;
