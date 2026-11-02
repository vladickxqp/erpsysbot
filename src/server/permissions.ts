/**
 * Who may do what inside a company.
 *
 * A role brings a set of permissions; CUSTOM brings exactly the permissions
 * stored on the membership, the other roles add those on top of their own.
 * Every server action checks the permission it needs (`require`) — the
 * interface hiding a button is a convenience, never the protection.
 */
export const PERMISSIONS = [
  "clients.read",
  "clients.create",
  "clients.update",
  "clients.delete",
  "orders.read",
  "orders.create",
  "orders.update",
  "orders.delete",
  "products.manage",
  "invoices.read",
  "invoices.create",
  "invoices.issue",
  "invoices.cancel",
  "finance.read",
  "finance.create",
  "finance.export",
  "employees.read",
  "employees.manage",
  "settings.manage",
  "billing.manage",
  "ai.use",
  "calendar.read",
  "calendar.manage",
  "tasks.read",
  "tasks.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Role = "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE" | "ACCOUNTANT" | "CUSTOM";

const all = [...PERMISSIONS];
const without = (...drop: Permission[]) => all.filter((p) => !drop.includes(p));

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: all,
  ADMIN: without("billing.manage"),
  MANAGER: [
    "clients.read", "clients.create", "clients.update", "clients.delete",
    "orders.read", "orders.create", "orders.update", "orders.delete",
    "products.manage",
    "invoices.read", "invoices.create",
    "finance.read",
    "employees.read",
    "ai.use",
    "calendar.read", "calendar.manage",
    "tasks.read", "tasks.manage",
  ],
  EMPLOYEE: [
    "clients.read", "clients.create", "clients.update",
    "orders.read", "orders.create", "orders.update",
    "ai.use",
    "calendar.read", "calendar.manage",
    "tasks.read", "tasks.manage",
  ],
  ACCOUNTANT: [
    "clients.read",
    "orders.read",
    "invoices.read", "invoices.create", "invoices.issue", "invoices.cancel",
    "finance.read", "finance.create", "finance.export",
    "ai.use",
    "calendar.read",
    "tasks.read", "tasks.manage",
  ],
  CUSTOM: [],
};

export function permissionsFor(role: Role, extra: readonly string[] = []): Set<Permission> {
  const granted = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const p of extra) if ((PERMISSIONS as readonly string[]).includes(p)) granted.add(p as Permission);
  return granted;
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: Permission) {
    super(`forbidden: ${permission}`);
  }
}

export function can(granted: Set<Permission>, permission: Permission): boolean {
  return granted.has(permission);
}

export function requirePermission(granted: Set<Permission>, permission: Permission): void {
  if (!granted.has(permission)) throw new ForbiddenError(permission);
}
