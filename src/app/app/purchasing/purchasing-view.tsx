"use client";

import { AlertTriangle, PackageCheck, Plus, Send, Trash2, Truck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { purchaseStatusAction, receivePurchaseAction, savePurchaseAction, saveSupplierAction, type PurchaseResult } from "./actions";

type Item = { productId: string; quantity: number; unitCostCents: number; name?: string; unit?: string };
type Order = {
  id: string;
  number: number;
  supplierId: string;
  supplierName: string;
  status: "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED";
  expectedOn: string | null;
  notes: string | null;
  totalCents: number;
  createdAt: string;
  items: Item[];
};
type Supplier = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  notes: string | null;
};
type Product = { id: string; name: string; unit: string; purchasePriceCents: number | null };

const TONE: Record<Order["status"], string> = {
  DRAFT: "bg-muted text-muted-foreground",
  ORDERED: "bg-primary/10 text-primary border-primary/20",
  RECEIVED: "bg-success/10 text-success border-success/20",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const parseEuro = (text: string) => {
  const n = Number(text.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

export function PurchasingView({
  tab,
  canManage,
  orders,
  suppliers,
  products,
  lowStock,
}: {
  tab: "orders" | "suppliers";
  canManage: boolean;
  orders: Order[];
  suppliers: Supplier[];
  products: Product[];
  lowStock: { id: string; name: string; unit: string; stock: number; min: number }[];
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const money = (c: number) => formatMoney(c, locale, region);
  const [pending, start] = useTransition();
  const [order, setOrder] = useState<{ id: string | null; supplierId: string; expectedOn: string; notes: string; items: { productId: string; quantity: string; cost: string }[] } | null>(null);
  const [supplier, setSupplier] = useState<(Omit<Supplier, "id"> & { id: string | null }) | null>(null);

  const run = (work: () => Promise<PurchaseResult>, done?: () => void) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        done?.();
        router.refresh();
      } else toast.error(t(result.error ?? "common.error"));
    });

  const newOrder = (productIds: string[] = []) =>
    setOrder({
      id: null,
      supplierId: suppliers[0]?.id ?? "",
      expectedOn: "",
      notes: "",
      items: (productIds.length ? productIds : [""]).map((productId) => {
        const p = products.find((x) => x.id === productId);
        return { productId, quantity: "1", cost: p?.purchasePriceCents ? euros(p.purchasePriceCents) : "" };
      }),
    });

  const saveOrder = () =>
    order &&
    run(
      () =>
        savePurchaseAction(order.id, {
          supplierId: order.supplierId,
          expectedOn: order.expectedOn || null,
          notes: order.notes,
          items: order.items
            .filter((i) => i.productId)
            .map((i) => ({ productId: i.productId, quantity: Number(i.quantity.replace(",", ".")), unitCostCents: parseEuro(i.cost || "0") })),
        }),
      () => setOrder(null),
    );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">{t("inventory.title")}</h1>
        <div className="flex rounded-lg border bg-card p-0.5">
          {(["orders", "suppliers"] as const).map((v) => (
            <Link
              key={v}
              href={v === "orders" ? "/app/purchasing" : "/app/purchasing?tab=suppliers"}
              className={cn("rounded-md px-3 py-1.5 text-sm", tab === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t(`inventory.${v}`)}
            </Link>
          ))}
        </div>
        {canManage && tab === "orders" && (
          <Button onClick={() => newOrder()} disabled={!suppliers.length}>
            <Plus className="size-4" /> {t("inventory.newOrder")}
          </Button>
        )}
        {canManage && tab === "suppliers" && (
          <Button onClick={() => setSupplier({ id: null, name: "", contactName: "", email: "", phone: "", street: "", postalCode: "", city: "", country: region.country, notes: "" })}>
            <Plus className="size-4" /> {t("inventory.newSupplier")}
          </Button>
        )}
      </div>

      {tab === "orders" && lowStock.length > 0 && (
        <Card className="mb-4 border-warning/40">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning" /> {t("inventory.low", { count: lowStock.length })}
            </CardTitle>
            {canManage && suppliers.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => newOrder(lowStock.map((l) => l.id))}>
                <Truck className="size-4" /> {t("inventory.reorder")}
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            {lowStock.map((l) => (
              <Badge key={l.id} variant="outline" className="border-warning/40">
                {l.name}: {l.stock} / {l.min} {l.unit}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {tab === "orders" &&
        (orders.length === 0 ? (
          <EmptyState icon={Truck} title={suppliers.length ? t("inventory.noOrders") : t("inventory.noSuppliers")} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">{t("orders.number")}</TableHead>
                  <TableHead>{t("inventory.supplier")}</TableHead>
                  <TableHead>{t("orders.status")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("inventory.expected")}</TableHead>
                  <TableHead className="text-right">{t("orders.total")}</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="tabular-nums text-muted-foreground">#{o.number}</TableCell>
                    <TableCell className="font-medium">
                      {o.status === "DRAFT" && canManage ? (
                        <button
                          type="button"
                          className="hover:underline"
                          onClick={() =>
                            setOrder({
                              id: o.id,
                              supplierId: o.supplierId,
                              expectedOn: o.expectedOn ?? "",
                              notes: o.notes ?? "",
                              items: o.items.map((i) => ({ productId: i.productId, quantity: String(i.quantity), cost: euros(i.unitCostCents) })),
                            })
                          }
                        >
                          {o.supplierName}
                        </button>
                      ) : (
                        o.supplierName
                      )}
                      {o.items.length > 0 && <div className="text-xs font-normal text-muted-foreground">{o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={TONE[o.status]}>
                        {t(`inventory.${o.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{o.expectedOn ? formatDate(o.expectedOn, locale, region) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(o.totalCents)}</TableCell>
                    <TableCell>
                      {canManage && (o.status === "DRAFT" || o.status === "ORDERED") && (
                        <div className="flex justify-end gap-1">
                          {o.status === "DRAFT" && (
                            <Button size="icon" variant="ghost" disabled={pending} aria-label={t("inventory.markOrdered")} onClick={() => run(() => purchaseStatusAction(o.id, "ORDERED"))}>
                              <Send className="size-4" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={pending}
                            aria-label={t("inventory.receive")}
                            onClick={() => run(() => receivePurchaseAction(o.id), () => toast.success(t("inventory.received")))}
                          >
                            <PackageCheck className="size-4" />
                          </Button>
                          <Button size="icon" variant="ghost" disabled={pending} aria-label={t("common.cancel")} onClick={() => run(() => purchaseStatusAction(o.id, "CANCELLED"))}>
                            <X className="size-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}

      {tab === "suppliers" &&
        (suppliers.length === 0 ? (
          <EmptyState icon={Truck} title={t("inventory.noSuppliers")} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suppliers.map((s) => (
              <Link key={s.id} href={`/app/purchasing/suppliers/${s.id}`} className="rounded-xl border bg-card p-4 text-left text-sm hover:border-primary/40">
                <div className="font-medium">{s.name}</div>
                <div className="mt-1 text-muted-foreground">{[s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "—"}</div>
                <div className="text-muted-foreground">{[s.postalCode, s.city].filter(Boolean).join(" ")}</div>
              </Link>
            ))}
          </div>
        ))}

      <Dialog open={order !== null} onOpenChange={(o) => !o && setOrder(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("inventory.newOrder")}</DialogTitle>
            <DialogDescription className="sr-only">{t("inventory.title")}</DialogDescription>
          </DialogHeader>
          {order && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveOrder();
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label>{t("inventory.supplier")}</Label>
                  <Select value={order.supplierId} onValueChange={(v) => setOrder({ ...order, supplierId: v })}>
                    <SelectTrigger className="w-full" aria-label={t("inventory.supplier")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("inventory.expected")}</span>
                  <Input type="date" value={order.expectedOn} onChange={(e) => setOrder({ ...order, expectedOn: e.target.value })} />
                </label>
              </div>
              <div className="grid gap-2">
                {order.items.map((item, index) => (
                  <div key={index} className="grid grid-cols-[1fr_5rem_6rem_auto] items-end gap-2">
                    <Select
                      value={item.productId}
                      onValueChange={(v) => {
                        const p = products.find((x) => x.id === v);
                        const items = [...order.items];
                        items[index] = { ...item, productId: v, cost: item.cost || (p?.purchasePriceCents ? euros(p.purchasePriceCents) : "") };
                        setOrder({ ...order, items });
                      }}
                    >
                      <SelectTrigger className="w-full" aria-label={t("lines.product")}>
                        <SelectValue placeholder={t("lines.product")} />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      inputMode="decimal"
                      value={item.quantity}
                      aria-label={t("lines.quantity")}
                      onChange={(e) => {
                        const items = [...order.items];
                        items[index] = { ...item, quantity: e.target.value };
                        setOrder({ ...order, items });
                      }}
                    />
                    <Input
                      inputMode="decimal"
                      value={item.cost}
                      placeholder="0,00"
                      aria-label={t("inventory.purchasePrice")}
                      onChange={(e) => {
                        const items = [...order.items];
                        items[index] = { ...item, cost: e.target.value };
                        setOrder({ ...order, items });
                      }}
                    />
                    <Button type="button" variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => setOrder({ ...order, items: order.items.filter((_, i) => i !== index) })}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setOrder({ ...order, items: [...order.items, { productId: "", quantity: "1", cost: "" }] })}>
                  <Plus className="size-4" /> {t("lines.add")}
                </Button>
              </div>
              <Textarea rows={2} value={order.notes} placeholder={t("orders.notes")} onChange={(e) => setOrder({ ...order, notes: e.target.value })} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOrder(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={pending || !order.supplierId}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={supplier !== null} onOpenChange={(o) => !o && setSupplier(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{supplier?.id ? supplier.name : t("inventory.newSupplier")}</DialogTitle>
            <DialogDescription className="sr-only">{t("inventory.suppliers")}</DialogDescription>
          </DialogHeader>
          {supplier && (
            <form
              className="grid grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const { id, ...input } = supplier;
                run(() => saveSupplierAction(id, input), () => setSupplier(null));
              }}
            >
              {(
                [
                  ["name", "inventory.supplier", 2],
                  ["contactName", "inventory.contact", 1],
                  ["phone", "clients.phone", 1],
                  ["email", "auth.email", 2],
                  ["street", "clients.street", 2],
                  ["postalCode", "clients.postalCode", 1],
                  ["city", "clients.city", 1],
                ] as const
              ).map(([key, label, span]) => (
                <label key={key} className={cn("grid gap-1.5", span === 2 && "col-span-2")}>
                  <span className="text-sm font-medium">{t(label)}</span>
                  <Input value={supplier[key] ?? ""} onChange={(e) => setSupplier({ ...supplier, [key]: e.target.value })} required={key === "name"} />
                </label>
              ))}
              <label className="col-span-2 grid gap-1.5">
                <span className="text-sm font-medium">{t("orders.notes")}</span>
                <Textarea rows={2} value={supplier.notes ?? ""} onChange={(e) => setSupplier({ ...supplier, notes: e.target.value })} />
              </label>
              <DialogFooter className="col-span-2">
                <Button type="submit" disabled={pending}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
