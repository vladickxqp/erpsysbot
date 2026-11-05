const OLD_TOOLS = new Set([
  "business_overview",
  "search_clients",
  "get_client",
  "create_client",
  "list_invoices",
  "get_invoice",
  "create_invoice_draft",
  "list_orders",
  "create_order",
  "finance_summary",
  "list_products",
  "list_appointments",
  "create_appointment",
  "list_tasks",
  "create_task",
  "list_deals",
  "create_deal",
]);

/** The name of a tool in the person's language. */
export const toolLabel = (t: (key: string) => string, name: string) => t(OLD_TOOLS.has(name) ? `assistant.tool_${name}` : `hub.ai.tool_${name}`);
