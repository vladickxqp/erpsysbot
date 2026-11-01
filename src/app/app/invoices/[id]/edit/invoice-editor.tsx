"use client";

import { toEditable, type ProductOption } from "@/components/app/line-editor";
import { InvoiceForm } from "../../invoice-form";

export function InvoiceEditor({
  invoice,
  items,
  clients,
  products,
  smallBusiness,
}: {
  invoice: { id: string; clientId: string; serviceDate: string; dueDate: string; notes: string };
  items: Parameters<typeof toEditable>[0];
  clients: { id: string; name: string; number: number }[];
  products: ProductOption[];
  smallBusiness: boolean;
}) {
  return (
    <InvoiceForm initial={{ ...invoice, lines: toEditable(items) }} clients={clients} products={products} smallBusiness={smallBusiness} />
  );
}
