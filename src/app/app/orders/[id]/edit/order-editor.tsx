"use client";

import { toEditable, type ProductOption } from "@/components/app/line-editor";
import type { OrderStatus } from "@/lib/domain";
import { OrderForm } from "../../order-form";

/** The order form, filled with a stored order (lines made editable here, in the browser). */
export function OrderEditor({
  order,
  items,
  clients,
  products,
  smallBusiness,
}: {
  order: { id: string; clientId: string; status: OrderStatus; title: string; notes: string; dueDate: string };
  items: Parameters<typeof toEditable>[0];
  clients: { id: string; name: string; number: number }[];
  products: ProductOption[];
  smallBusiness: boolean;
}) {
  return (
    <OrderForm
      initial={{ ...order, lines: toEditable(items) }}
      clients={clients}
      products={products}
      smallBusiness={smallBusiness}
    />
  );
}
