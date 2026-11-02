import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@/server/clients";
import { updateCompany } from "@/server/company";
import { contextFor, type Context } from "@/server/context";
import { deleteDocument, listDocuments, readDocument, sniffType, storeDocument } from "@/server/documents";
import { adjustStock, listMovements, lowStock, receivePurchaseOrder, savePurchaseOrder, saveSupplier, setPurchaseStatus } from "@/server/inventory";
import { createInvoiceDraft, issueInvoice, recordPayment } from "@/server/invoices";
import { today } from "@/server/money";
import { createOrder, setOrderStatus } from "@/server/orders";
import { tablePdf } from "@/server/pdf";
import { saveProduct } from "@/server/products";
import { buildReport, REPORTS, reportCsv } from "@/server/reports";
import { newCompany, newMember } from "./helpers";

const stockOf = async (ctx: Context, id: string) => {
  const { listProducts } = await import("@/server/products");
  return Number((await listProducts(ctx)).find((p) => p.id === id)!.stockQuantity);
};

describe("inventory", () => {
  it("receives a delivery once, deducts a completed order once and counts stock", async () => {
    const ctx = await newCompany("Lager GmbH");
    const cable = await saveProduct(ctx, { kind: "PRODUCT", name: "Kabel NYM 3x1,5", unit: "m", priceCents: 120, vatRate: 19, trackStock: true, minStock: 50 });
    const supplier = await saveSupplier(ctx, null, { name: "Großhandel AG" });
    const po = await savePurchaseOrder(ctx, null, { supplierId: supplier.id, items: [{ productId: cable.id, quantity: 100, unitCostCents: 45 }] });
    expect(po.totalCents).toBe(4500);
    await setPurchaseStatus(ctx, po.id, "ORDERED");
    await receivePurchaseOrder(ctx, po.id);
    await expect(receivePurchaseOrder(ctx, po.id)).rejects.toMatchObject({ code: "NOT_ORDERED" });
    expect(await stockOf(ctx, cable.id)).toBe(100);

    const client = await createClient(ctx, { lastName: "Kunde" });
    const order = await createOrder(ctx, { clientId: client.id, items: [{ productId: cable.id, description: "Kabel", quantity: 60, unit: "m", unitPriceCents: 120, vatRate: 19 }] });
    await setOrderStatus(ctx, order.id, "COMPLETED");
    await setOrderStatus(ctx, order.id, "IN_PROGRESS");
    await setOrderStatus(ctx, order.id, "COMPLETED");
    expect(await stockOf(ctx, cable.id)).toBe(40);
    expect((await lowStock(ctx)).map((p) => p.id)).toEqual([cable.id]);

    await adjustStock(ctx, cable.id, { counted: 38, note: "Inventur" });
    expect(await stockOf(ctx, cable.id)).toBe(38);
    expect((await listMovements(ctx, cable.id)).map((m) => m.type)).toEqual(["ADJUSTMENT", "SALE", "PURCHASE"]);

    const service = await saveProduct(ctx, { kind: "SERVICE", name: "Montage", unit: "Std", priceCents: 6500, vatRate: 19 });
    await expect(adjustStock(ctx, service.id, { counted: 1 })).rejects.toMatchObject({ code: "NOT_TRACKED" });
    const employee = await newMember(ctx, "EMPLOYEE");
    await expect(adjustStock(employee, cable.id, { counted: 1 })).rejects.toMatchObject({ permission: "inventory.manage" });
  });
});

describe("documents", () => {
  const saved = process.env.UPLOAD_DIR;
  beforeAll(() => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "erp-docs-"));
  });
  afterAll(() => {
    process.env.UPLOAD_DIR = saved;
  });

  it("recognises files by content, not by name", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 ...");
    expect(sniffType(pdf, "rechnung.exe")).toBe("application/pdf");
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]), "x.png")).toBe("image/png");
    expect(sniffType(new TextEncoder().encode("<script>alert(1)</script>"), "seite.html")).toBeNull();
    expect(sniffType(new TextEncoder().encode("a;b\n1;2"), "liste.csv")).toBe("text/csv");
    expect(sniffType(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "makro.docm")).toBeNull();
  });

  it("stores per company, reads back only inside it, and deletes the file", async () => {
    const ctx = await newCompany("Ablage GmbH");
    const client = await createClient(ctx, { lastName: "Akte" });
    const doc = await storeDocument(ctx, { name: "../../vertrag.pdf", bytes: new TextEncoder().encode("%PDF-1.4 vertrag") }, { clientId: client.id, category: "Verträge" });
    expect(doc.name).toBe(".._.._vertrag.pdf");
    expect((await readDocument(ctx, doc.id)).bytes.toString()).toBe("%PDF-1.4 vertrag");
    expect((await listDocuments(ctx, { clientId: client.id })).map((d) => d.id)).toEqual([doc.id]);

    const other = await newCompany("Fremde GmbH");
    await expect(readDocument(other, doc.id)).rejects.toThrow();
    await expect(storeDocument(ctx, { name: "x.html", bytes: new TextEncoder().encode("<html>") })).rejects.toMatchObject({ code: "TYPE" });
    await expect(storeDocument(ctx, { name: "big.pdf", bytes: new Uint8Array(16 * 1024 * 1024) })).rejects.toMatchObject({ code: "TOO_LARGE" });

    await deleteDocument(ctx, doc.id);
    await expect(readDocument(ctx, doc.id)).rejects.toThrow();
  });
});

describe("reports", () => {
  it("adds up real records: revenue per month, open items by age, revenue per client", async () => {
    let ctx = await newCompany("Bericht GmbH");
    await updateCompany(ctx, { name: ctx.organization.name, street: "Weg 1", postalCode: "68159", city: "Mannheim", taxNumber: "1/2/3" });
    ctx = (await contextFor(ctx.user))!;
    const client = await createClient(ctx, { companyName: "Großkunde AG" });
    const line = (eur: number) => ({ description: "Arbeit", quantity: 1, unit: "Std", unitPriceCents: eur * 100, vatRate: 19 });
    const paid = await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, items: [line(100)] })).id);
    await recordPayment(ctx, paid.id, { amountCents: 11900, paidOn: today() });
    await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, dueDate: "2020-01-31", items: [line(50)] })).id);
    const from = `${today().slice(0, 7)}-01`;

    const revenue = await buildReport(ctx, "revenue", from, today());
    expect(revenue.totals).toMatchObject({ income: 11900, expense: 0, result: 11900 });
    const aging = await buildReport(ctx, "aging", from, today());
    expect(aging.totals?.d90plus).toBe(5950);
    const byClient = await buildReport(ctx, "clients", from, today());
    expect(byClient.rows[0]).toMatchObject({ client: "Großkunde AG", invoices: 2, net: 15000, share: 1 });

    const csv = reportCsv(byClient, (k) => k);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Großkunde AG;2;150,00");
    const pdf = await tablePdf({ company: "Bericht GmbH", title: "Test", subtitle: "x", columns: [{ label: "A", align: "left" }], rows: [["ä ö ü – Ж"]] });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");

    const employee = await newMember(ctx, "EMPLOYEE");
    await expect(buildReport(employee, "revenue", from, today())).rejects.toMatchObject({ permission: "finance.read" });
  });

  it("builds every report without hanging (one database connection, as in development)", async () => {
    const ctx = await newCompany("Alle Berichte GmbH");
    await createClient(ctx, { lastName: "Einer", source: "Messe" });
    for (const kind of REPORTS) {
      const report = await buildReport(ctx, kind, "2020-01-01", today());
      expect(report.columns.length).toBeGreaterThan(0);
    }
    const activity = await buildReport(ctx, "activity", "2020-01-01", today());
    expect(activity.rows[0]).toMatchObject({ person: ctx.user.name, area: "client" });
  }, 20_000);
});
