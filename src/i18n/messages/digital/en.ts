import type de from "./de";

const digital: typeof de = {
  title: "Digital",
  product: "Digital (delivers itself once paid)",
  shared: "Every buyer gets the same",
  note: "Note for buyers",
  add: "Add",
  entries: "New entries, one per line",
  entry: "Entry",
  variant: "Variant",
  available: "Available",
  sold: "Sold",
  waiting: "Paid, waiting for entries",
  show: "Show",
  copy: "Copy",
  copied: "Copied",
  added: "{count} added",
  order: "Order",
  status: {
    AVAILABLE: "Available",
    SOLD: "Sold",
  },
  buyer: {
    title: "Your digital items",
    pending: "Will be provided shortly",
  },
  short: "Order {order}: {count} digital items missing ({product})",
  mail: {
    subject: "Order {number}: your items are ready",
    body: "Your digital items for order {number} are ready on your order page. You find the link to it in your order confirmation.",
  },
  error: {
    NOT_DIGITAL: "Not a digital product",
    EMPTY: "No entries",
    TOO_MANY: "At most 500 entries at once, 4000 characters each",
    SOLD: "Already sold",
  },
};

export default digital;
