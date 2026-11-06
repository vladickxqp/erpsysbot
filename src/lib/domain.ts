/**
 * Names shared by the server and the browser — no database code in here, so
 * the forms can use them without pulling the server into the bundle.
 */
export const ORDER_STATUSES = ["DRAFT", "NEW", "CONFIRMED", "IN_PROGRESS", "WAITING", "COMPLETED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
/** Still to be worked on. */
export const OPEN_STATUSES: OrderStatus[] = ["NEW", "CONFIRMED", "IN_PROGRESS", "WAITING"];

export const INVOICE_FILTERS = ["DRAFT", "OPEN", "SENT", "OVERDUE", "PARTIALLY_PAID", "PAID", "CANCELLED", "CREDITED", "CREDIT_NOTE"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

export const INVOICE_SORTS = ["number", "client", "issueDate", "dueDate", "total", "status", "created"] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];

export const PAYMENT_METHODS = ["TRANSFER", "CASH", "CARD", "PAYPAL", "OTHER"] as const;

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE", "REFUND", "ADJUSTMENT"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const EXPENSE_CATEGORIES = [
  "material",
  "rent",
  "salaries",
  "vehicle",
  "marketing",
  "software",
  "insurance",
  "taxes",
  "travel",
  "other",
] as const;
