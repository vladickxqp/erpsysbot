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
  index,
  integer,
  jsonb,
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
export const TENANT_TABLES = ["counters", "clients", "audit_log"] as const;
