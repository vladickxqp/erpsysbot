/** Audit trail entries ("invoice.issue") in words: the entity and a few verbs. */
export const ACTIVITY_VERB: Record<string, string> = {
  create: "created",
  draft: "created",
  upload: "created",
  invite: "created",
  connect: "created",
  update: "changed",
  status: "changed",
  move: "changed",
  role: "changed",
  adjust: "changed",
  modules: "changed",
  password_link: "changed",
  delete: "deleted",
  delete_draft: "deleted",
  remove: "deleted",
  disconnect: "deleted",
  cancel: "cancelled",
  issue: "issued",
  payment: "paid",
  publish: "published",
  receive: "received",
  import: "created",
};

export const ACTIVITY_ENTITIES = [
  "appointment",
  "automation",
  "client",
  "company",
  "content",
  "deal",
  "document",
  "invoice",
  "order",
  "product",
  "project",
  "purchase",
  "quote",
  "reminder",
  "social",
  "stock",
  "task",
  "team",
  "transaction",
] as const;

/** Where an entry's record lives, when it has a page. */
export function activityLink(action: string, entityId: string | null): string | null {
  if (!entityId) return null;
  const entity = action.split(".")[0];
  const page: Record<string, string> = { client: "clients", invoice: "invoices", order: "orders", quote: "quotes", content: "content" };
  return page[entity] && !action.endsWith(".delete") && !action.endsWith(".delete_draft") ? `/app/${page[entity]}/${entityId}` : null;
}
