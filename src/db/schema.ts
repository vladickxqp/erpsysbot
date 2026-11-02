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
  quoteNumberFormat: text("quote_number_format").notNull().default("AN-{YYYY}-{NNNN}"),
  creditNoteNumberFormat: text("credit_note_number_format").notNull().default("GS-{YYYY}-{NNNN}"),
  invoiceFooter: text("invoice_footer"),
  currency: text("currency").notNull().default("EUR"),
  /** The tax rates its lines may carry; null: the country's (src/lib/countries.ts). */
  taxRates: numeric("tax_rates", { precision: 6, scale: 3, mode: "number" }).array(),
  locale: text("locale").notNull().default("de"),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  /** Where the sign-up came from (Cloudflare's IP country), for the platform admin. */
  signupIpCountry: text("signup_ip_country"),
  /** Modules switched off for the whole company (src/lib/modules.ts). */
  disabledModules: text("disabled_modules").array().notNull().default(sql`'{}'::text[]`),
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
    /** Modules this person keeps out of their own menu. */
    hiddenModules: text("hidden_modules").array().notNull().default(sql`'{}'::text[]`),
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

/** Invitations to create a new company, from the platform admin (sign-up is invite-only). */
export const platformInvites = pgTable(
  "platform_invites",
  {
    id: id(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("platform_invites_token_key").on(t.tokenHash)],
);

/** Plans and their limits, editable by the platform admin without code changes. */
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  maxUsers: integer("max_users").notNull().default(1),
  aiPerDay: integer("ai_per_day").notNull().default(0),
  /** Module keys this plan includes (e.g. "invoices", "finance", "automation"). */
  modules: text("modules").array().notNull().default(sql`'{}'::text[]`),
  stripePriceId: text("stripe_price_id"),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

export const subscriptionStatusEnum = pgEnum("subscription_status", ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "NONE"]);

/** One per company: the plan it is on and the state of its payment. Written by the server only. */
export const subscriptions = pgTable("subscriptions", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  planId: text("plan_id").references(() => plans.id),
  status: subscriptionStatusEnum("status").notNull().default("TRIALING"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  updatedAt: updatedAt(),
});

/** Stripe events already handled (webhooks arrive more than once). */
export const billingEvents = pgTable("billing_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  organizationId: uuid("organization_id"),
  amountCents: integer("amount_cents"),
  createdAt: createdAt(),
});

/** Organizations the platform admin has suspended, or that wait for review (nobody can work in them). */
export const suspensions = pgTable("suspensions", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** SUSPENDED by the admin, or REVIEW: the sign-up's country did not match where it came from. */
  kind: text("kind").notNull().default("SUSPENDED"),
  reason: text("reason"),
  createdAt: createdAt(),
});

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
    /** Morning summary in the chat. */
    notify: boolean("notify").notNull().default(true),
    lastDigestOn: date("last_digest_on"),
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
    /** Leitweg-ID or other buyer reference for e-invoices (XRechnung BT-10). */
    buyerReference: text("buyer_reference"),
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
    /** Percent, up to three decimals (US sales tax: 8.875). */
    vatRate: numeric("vat_rate", { precision: 6, scale: 3, mode: "number" }).notNull().default(19),
    active: boolean("active").notNull().default(true),
    category: text("category"),
    barcode: text("barcode"),
    /** Net purchase price in cents (for margins and purchase orders). */
    purchasePriceCents: integer("purchase_price_cents"),
    /** Stock is kept only for tracked products; it changes only through stock movements. */
    trackStock: boolean("track_stock").notNull().default(false),
    stockQuantity: numeric("stock_quantity", { precision: 12, scale: 3 }).notNull().default("0"),
    minStock: numeric("min_stock", { precision: 12, scale: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_org_name_idx").on(t.organizationId, t.name)],
);

export const stockMovementTypeEnum = pgEnum("stock_movement_type", ["PURCHASE", "SALE", "RETURN", "ADJUSTMENT", "TRANSFER"]);

/**
 * Every change of a product's stock. `dedupeKey` makes a booking idempotent:
 * completing the same order twice deducts once.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    organizationId: orgId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    type: stockMovementTypeEnum("type").notNull(),
    /** Signed: + in, - out. */
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    dedupeKey: text("dedupe_key"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_movements_product_idx").on(t.productId, t.createdAt),
    uniqueIndex("stock_movements_dedupe_key").on(t.organizationId, t.dedupeKey),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    street: text("street"),
    postalCode: text("postal_code"),
    city: text("city"),
    country: text("country").notNull().default("DE"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("suppliers_org_name_idx").on(t.organizationId, t.name)],
);

export const purchaseStatusEnum = pgEnum("purchase_status", ["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"]);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    organizationId: orgId(),
    number: integer("number").notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    status: purchaseStatusEnum("status").notNull().default("DRAFT"),
    notes: text("notes"),
    expectedOn: date("expected_on"),
    orderedAt: timestamp("ordered_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    totalCents: integer("total_cents").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("purchase_orders_org_number_key").on(t.organizationId, t.number)],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: id(),
    organizationId: orgId(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
  },
  (t) => [index("purchase_order_items_po_idx").on(t.purchaseOrderId)],
);

// --- Documents ---------------------------------------------------------------------------------
/** Files people upload. The bytes live in UPLOAD_DIR under `storageKey`, never in a public folder. */
export const documents = pgTable(
  "documents",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    category: text("category"),
    /** Media library: THUMBNAIL or BRAND; null for everything else. */
    collection: text("collection"),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    orderId: uuid("order_id"),
    invoiceId: uuid("invoice_id"),
    archived: boolean("archived").notNull().default(false),
    uploadedBy: uuid("uploaded_by"),
    createdAt: createdAt(),
  },
  (t) => [index("documents_org_created_idx").on(t.organizationId, t.createdAt), index("documents_client_idx").on(t.clientId)],
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
  vatRate: numeric("vat_rate", { precision: 6, scale: 3, mode: "number" }).notNull(),
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

// --- Quotes ------------------------------------------------------------------------------------
export const quoteStatusEnum = pgEnum("quote_status", ["DRAFT", "SENT", "ACCEPTED", "DECLINED"]);

/** An offer to a client (Angebot). Numbered when created; becomes an order or invoice draft. */
export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    organizationId: orgId(),
    number: text("number").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    status: quoteStatusEnum("status").notNull().default("DRAFT"),
    title: text("title"),
    notes: text("notes"),
    issueDate: date("issue_date").notNull(),
    validUntil: date("valid_until"),
    netCents: integer("net_cents").notNull().default(0),
    vatCents: integer("vat_cents").notNull().default(0),
    grossCents: integer("gross_cents").notNull().default(0),
    smallBusiness: boolean("small_business").notNull().default(false),
    orderId: uuid("order_id"),
    invoiceId: uuid("invoice_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("quotes_org_number_key").on(t.organizationId, t.number), index("quotes_client_idx").on(t.clientId)],
);

export const quoteItems = pgTable(
  "quote_items",
  {
    ...lineColumns(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
  },
  (t) => [index("quote_items_quote_idx").on(t.quoteId)],
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

/** Payment reminders (Zahlungserinnerung / Mahnung) for an overdue invoice, level 1, 2, 3 … */
export const paymentReminders = pgTable(
  "payment_reminders",
  {
    id: id(),
    organizationId: orgId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    openCents: integer("open_cents").notNull(),
    feeCents: integer("fee_cents").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payment_reminders_invoice_level_key").on(t.invoiceId, t.level)],
);

// --- Calendar ----------------------------------------------------------------------------------
export const appointmentStatusEnum = pgEnum("appointment_status", ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]);

/** An appointment: with a client or internal, assigned to one person. */
export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    organizationId: orgId(),
    title: text("title").notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    assignedUserId: uuid("assigned_user_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    location: text("location"),
    status: appointmentStatusEnum("status").notNull().default("CONFIRMED"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("appointments_org_start_idx").on(t.organizationId, t.startsAt), index("appointments_client_idx").on(t.clientId)],
);

// --- Projects and tasks --------------------------------------------------------------------------
export const projectStatusEnum = pgEnum("project_status", ["ACTIVE", "DONE", "ARCHIVED"]);
export const taskStatusEnum = pgEnum("task_status", ["TODO", "IN_PROGRESS", "REVIEW", "DONE"]);
export const taskPriorityEnum = pgEnum("task_priority", ["LOW", "MEDIUM", "HIGH"]);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    status: projectStatusEnum("status").notNull().default("ACTIVE"),
    dueDate: date("due_date"),
    createdAt: createdAt(),
  },
  (t) => [index("projects_org_idx").on(t.organizationId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    organizationId: orgId(),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("TODO"),
    priority: taskPriorityEnum("priority").notNull().default("MEDIUM"),
    dueDate: date("due_date"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    parentId: uuid("parent_id"),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    assignedUserId: uuid("assigned_user_id"),
    createdBy: uuid("created_by"),
    position: integer("position").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_org_status_idx").on(t.organizationId, t.status), index("tasks_assigned_idx").on(t.assignedUserId)],
);

// --- Sales pipeline ------------------------------------------------------------------------------
export const dealStageEnum = pgEnum("deal_stage", ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]);

/** A sales opportunity with a client or lead, moving through the pipeline. */
export const deals = pgTable(
  "deals",
  {
    id: id(),
    organizationId: orgId(),
    title: text("title").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    stage: dealStageEnum("stage").notNull().default("NEW"),
    valueCents: integer("value_cents").notNull().default(0),
    source: text("source"),
    assignedUserId: uuid("assigned_user_id"),
    nextFollowUp: date("next_follow_up"),
    notes: text("notes"),
    quoteId: uuid("quote_id"),
    position: integer("position").notNull().default(0),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("deals_org_stage_idx").on(t.organizationId, t.stage), index("deals_client_idx").on(t.clientId)],
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
    /** On answers: tokens used and tools run, for usage and cost. */
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    tools: text("tools").array(),
    createdAt: createdAt(),
  },
  (t) => [index("assistant_messages_conv_idx").on(t.organizationId, t.userId, t.channel, t.createdAt)],
);

// --- Automations -------------------------------------------------------------------------------
/** Trigger → conditions → action. Actions never fire triggers, so rules cannot loop. */
export const automations = pgTable(
  "automations",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    trigger: text("trigger").notNull(),
    conditions: jsonb("conditions").notNull().default(sql`'{}'::jsonb`),
    action: text("action").notNull(),
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("automations_org_trigger_idx").on(t.organizationId, t.trigger)],
);

/** Every run of a rule; `subject` (e.g. the invoice id) makes each rule fire once per subject. */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    organizationId: orgId(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    ok: boolean("ok").notNull(),
    message: text("message"),
    attempts: integer("attempts").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("automation_runs_once_key").on(t.automationId, t.subject), index("automation_runs_org_idx").on(t.organizationId, t.createdAt)],
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

// --- Dashboards --------------------------------------------------------------------------------
/** A person's own overview pages: which widgets, in which order and size. */
export const dashboards = pgTable(
  "dashboards",
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    /** [{ id, type, size 1–4, collapsed }] — checked by src/server/dashboards.ts. */
    widgets: jsonb("widgets").notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("dashboards_user_idx").on(t.organizationId, t.userId, t.position)],
);

// --- Creator Studio ----------------------------------------------------------------------------
export const contentStatusEnum = pgEnum("content_status", ["IDEA", "DRAFT", "REVIEW", "SCHEDULED", "PUBLISHED"]);

/** A piece of content: a post, video, story or article, planned on the content calendar. */
export const contentItems = pgTable(
  "content_items",
  {
    id: id(),
    organizationId: orgId(),
    title: text("title").notNull(),
    body: text("body"),
    description: text("description"),
    platform: text("platform").notNull().default("OTHER"),
    contentType: text("content_type").notNull().default("POST"),
    status: contentStatusEnum("status").notNull().default("DRAFT"),
    category: text("category"),
    hashtags: text("hashtags").array().notNull().default(sql`'{}'::text[]`),
    /** Files from the media library (documents). */
    mediaIds: uuid("media_ids").array().notNull().default(sql`'{}'::uuid[]`),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Where it went out through this app (a connected channel), and the link to it. */
    socialAccountId: uuid("social_account_id"),
    externalUrl: text("external_url"),
    assignedUserId: uuid("assigned_user_id"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("content_items_org_scheduled_idx").on(t.organizationId, t.scheduledAt), index("content_items_org_status_idx").on(t.organizationId, t.status)],
);

export const contentComments = pgTable(
  "content_comments",
  {
    id: id(),
    organizationId: orgId(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("content_comments_item_idx").on(t.contentId, t.createdAt)],
);

export const contentTemplates = pgTable(
  "content_templates",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    platform: text("platform").notNull().default("OTHER"),
    contentType: text("content_type").notNull().default("POST"),
    body: text("body").notNull(),
    hashtags: text("hashtags").array().notNull().default(sql`'{}'::text[]`),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("content_templates_org_idx").on(t.organizationId)],
);

/** One run of the content generator: for the daily limits and the cost. */
export const contentGenerations = pgTable(
  "content_generations",
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid("user_id").notNull(),
    kind: text("kind").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: createdAt(),
  },
  (t) => [index("content_generations_org_idx").on(t.organizationId, t.createdAt)],
);

// --- Social media ------------------------------------------------------------------------------
/** A channel of the company: a YouTube channel, a Telegram channel, an Instagram profile … */
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: id(),
    organizationId: orgId(),
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    /** The provider's id for it: YouTube channel id, Telegram @channel or chat id. */
    externalId: text("external_id").notNull(),
    url: text("url"),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("social_accounts_key").on(t.organizationId, t.provider, t.externalId)],
);

/** The figures a provider reported for a channel on one day (the last fetch of the day wins). */
export const socialStats = pgTable(
  "social_stats",
  {
    id: id(),
    organizationId: orgId(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    followers: integer("followers"),
    views: numeric("views", { precision: 20, scale: 0, mode: "number" }),
    posts: integer("posts"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("social_stats_day_key").on(t.accountId, t.day), index("social_stats_org_day_idx").on(t.organizationId, t.day)],
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
  "quotes",
  "quote_items",
  "payment_reminders",
  "appointments",
  "projects",
  "tasks",
  "deals",
  "stock_movements",
  "suppliers",
  "purchase_orders",
  "purchase_order_items",
  "documents",
  "automations",
  "automation_runs",
  "dashboards",
  "content_items",
  "content_comments",
  "content_templates",
  "content_generations",
  "social_accounts",
  "social_stats",
] as const;
