import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bestOffer, margins } from "@/lib/pricing";
import { guessMapping, readRows } from "@/lib/product-import";
import { choiceKey, choiceLabel, cleanOptions, combinations, parseChoice, variantSku } from "@/lib/variants";
import {
  addProductImage,
  deleteCategory,
  getProductDetail,
  getSupplierDetail,
  listCatalog,
  listCategories,
  moveProductImage,
  saveCategory,
  saveCommerceSettings,
  saveOffer,
  saveVariant,
  saveVariantOptions,
} from "@/server/catalog";
import { storeDocument } from "@/server/documents";
import { adjustStock, saveSupplier } from "@/server/inventory";
import { activateImport, applyImport, discardImport, importPreview, startImport } from "@/server/product-import";
import { saveProduct } from "@/server/products";
import { newCompany, newMember } from "./helpers";

const csv = (lines: string[]) => ({ name: "liste.csv", bytes: new TextEncoder().encode(lines.join("\n")) });

describe("margins", () => {
  it("keeps revenue, gross margin and contribution apart", () => {
    // 100 € net, 19 % VAT: the fee is charged on the 119 € the customer pays.
    const m = margins({ priceCents: 10_000, purchaseCents: 6_000, shippingCents: 500, otherCents: 200, feePercent: 1.5, feeFixedCents: 25, vatRate: 19 });
    expect(m).toEqual({
      revenueCents: 10_000,
      purchaseCents: 6_000,
      grossMarginCents: 4_000,
      grossMarginPercent: 40,
      paymentFeeCents: 179 + 25,
      shippingCents: 500,
      otherCents: 200,
      contributionCents: 4_000 - 500 - 200 - 204,
      contributionPercent: 30.96,
    });
  });

  it("says unknown instead of pretending a missing purchase price was zero", () => {
    const m = margins({ priceCents: 1_000, purchaseCents: null, feeFixedCents: 30 });
    expect(m.grossMarginCents).toBeNull();
    expect(m.contributionCents).toBeNull();
    expect(m.paymentFeeCents).toBe(30);
    expect(margins({ priceCents: 0, purchaseCents: 0, feeFixedCents: 30 }).paymentFeeCents).toBe(0);
    expect(margins({ priceCents: 500, purchaseCents: 800 }).contributionCents).toBe(-300);
  });

  it("picks the cheapest offer with shipping, the preferred one on a tie", () => {
    const a = { id: "a", purchasePriceCents: 900, shippingCostCents: 200, preferred: false };
    const b = { id: "b", purchasePriceCents: 1_000, shippingCostCents: null, preferred: false };
    const c = { id: "c", purchasePriceCents: 1_000, shippingCostCents: 100, preferred: true };
    expect(bestOffer([a, b])?.id).toBe("b");
    expect(bestOffer([a, b, c])?.id).toBe("b");
    expect(bestOffer([{ ...a, purchasePriceCents: 1_000, shippingCostCents: 100 }, c])?.id).toBe("c");
    expect(bestOffer([])).toBeNull();
  });
});

describe("variants", () => {
  it("combines cleaned options and names them", () => {
    const options = cleanOptions([
      { name: " Größe ", values: ["S", "M", "M", " "] },
      { name: "Farbe", values: ["Rot", "Blau"] },
      { name: "", values: ["x"] },
    ]);
    expect(options).toEqual([
      { name: "Größe", values: ["S", "M"] },
      { name: "Farbe", values: ["Rot", "Blau"] },
    ]);
    const all = combinations(options);
    expect(all).toHaveLength(4);
    expect(choiceLabel(all[1], options)).toBe("S / Blau");
    expect(choiceKey({ Farbe: "Rot", Größe: "M" })).toBe(choiceKey({ Größe: "M", Farbe: "Rot" }));
    expect(variantSku("TS", { Größe: "M", Farbe: "Rot" }, options)).toBe("TS-M-ROT");
    expect(variantSku(null, { Größe: "M" })).toBeNull();
    expect(parseChoice("Größe=M; Farbe: Rot")).toEqual({ Größe: "M", Farbe: "Rot" });
    expect(parseChoice("nur Text")).toBeNull();
  });
});

describe("import rules", () => {
  it("guesses columns in several languages and checks each row", () => {
    expect(guessMapping(["Bezeichnung", "Art.-Nr.", "VK netto", "EK", "Kategorie", "Lieferant", "Unbekannt"])).toEqual(["name", "sku", "price", "purchasePrice", "category", "supplier", null]);
    expect(guessMapping(["Название", "Артикул", "Цена"])).toEqual(["name", "sku", "price"]);
    expect(guessMapping(["Artikelnummer", "Name", "Preis", "EK"])).toEqual(["sku", "name", "price", "purchasePrice"]);
    const mapping = guessMapping(["Name", "Artikelnummer", "Preis", "USt", "Hauptartikel", "Variante"]);
    const rows = readRows(
      [
        ["Name", "Artikelnummer", "Preis", "USt", "Hauptartikel", "Variante"],
        ["Shirt", "TS", "19,90", "19", "", ""],
        ["", "TS-M", "", "", "TS", "Größe=M"],
        ["Kaputt", "TS", "abc", "7,5", "", ""],
        ["", "", "", "", "", ""],
        ["", "", "5", "", "TS", "nur Text"],
      ],
      mapping,
      [19, 7, 0],
    );
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4, 6]);
    expect(rows[0]).toMatchObject({ name: "Shirt", priceCents: 1990, vatRate: 19, kind: "PRODUCT", errors: [] });
    expect(rows[1]).toMatchObject({ parentSku: "TS", variant: { Größe: "M" }, errors: [] });
    expect(rows[2].errors).toEqual(expect.arrayContaining(["price.invalid", "vatRate.invalid", "sku.twice"]));
    expect(rows[3].errors).toEqual(expect.arrayContaining(["variant.invalid", "variant.missing"]));
  });
});

describe("catalog", () => {
  const saved = process.env.UPLOAD_DIR;
  beforeAll(() => {
    process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "erp-catalog-"));
  });
  afterAll(() => {
    process.env.UPLOAD_DIR = saved;
  });

  it("keeps categories as a tree without cycles and with unique names", async () => {
    const ctx = await newCompany("Kategorien GmbH");
    const clothes = await saveCategory(ctx, null, { name: "Kleidung" });
    const shirts = await saveCategory(ctx, null, { name: "Shirts", parentId: clothes.id });
    await expect(saveCategory(ctx, null, { name: "kleidung" })).rejects.toMatchObject({ code: "NAME_TAKEN" });
    await expect(saveCategory(ctx, clothes.id, { name: "Kleidung", parentId: shirts.id })).rejects.toMatchObject({ code: "CYCLE" });
    const shirt = await saveProduct(ctx, { kind: "PRODUCT", name: "Shirt", priceCents: 1990, vatRate: 19, categoryId: shirts.id });
    expect(shirt.category).toBe("Shirts");
    await saveCategory(ctx, shirts.id, { name: "T-Shirts", parentId: clothes.id });
    expect((await listCatalog(ctx, { categoryId: shirts.id })).rows.map((r) => [r.name, r.categoryName])).toEqual([["Shirt", "T-Shirts"]]);
    await deleteCategory(ctx, shirts.id);
    expect((await listCategories(ctx)).map((c) => c.name)).toEqual(["Kleidung"]);
    expect((await getProductDetail(ctx, shirt.id)).product.categoryId).toBeNull();
  });

  it("makes variants, keeps those with stock when an option goes and books stock per variant", async () => {
    const ctx = await newCompany("Varianten GmbH");
    const shirt = await saveProduct(ctx, { kind: "PRODUCT", name: "Shirt", sku: "TS", priceCents: 2000, purchasePriceCents: 800, vatRate: 19, trackStock: true });
    expect((await saveVariantOptions(ctx, shirt.id, [{ name: "Größe", values: ["S", "M"] }, { name: "Farbe", values: ["Rot"] }])).variants).toBe(2);
    let detail = await getProductDetail(ctx, shirt.id);
    expect(detail.variants.map((v) => v.sku)).toEqual(["TS-S-ROT", "TS-M-ROT"]);
    const [small, medium] = detail.variants;
    await saveVariant(ctx, medium.id, { sku: "TS-M", barcode: "", priceCents: 2200, purchasePriceCents: null, minStock: 2, active: true });
    await expect(saveVariant(ctx, small.id, { sku: "TS-M", barcode: "", priceCents: null, purchasePriceCents: null, minStock: null, active: true })).rejects.toMatchObject({ code: "SKU_TAKEN" });
    await adjustStock(ctx, shirt.id, { counted: 5, variantId: medium.id });
    await saveVariantOptions(ctx, shirt.id, [{ name: "Größe", values: ["S"] }, { name: "Farbe", values: ["Rot"] }]);
    detail = await getProductDetail(ctx, shirt.id);
    // M has stock: it stays, switched off. Nothing else is lost.
    expect(detail.variants.map((v) => [v.sku, v.active, Number(v.stockQuantity)])).toEqual([
      ["TS-S-ROT", true, 0],
      ["TS-M", false, 5],
    ]);
    expect(Number(detail.product.stockQuantity)).toBe(5);
    expect(detail.variants[1].margins).toMatchObject({ revenueCents: 2200, purchaseCents: 800, grossMarginCents: 1400 });
    await expect(saveVariantOptions(ctx, shirt.id, [{ name: "A", values: Array.from({ length: 30 }, (_, i) => `a${i}`) }, { name: "B", values: Array.from({ length: 10 }, (_, i) => `b${i}`) }])).rejects.toMatchObject({ code: "TOO_MANY" });
  });

  it("compares suppliers, records price changes and counts payment fees", async () => {
    const ctx = await newCompany("Einkauf GmbH");
    await saveCommerceSettings(ctx, { paymentFeePercent: 2, paymentFeeFixedCents: 30 });
    const lamp = await saveProduct(ctx, { kind: "PRODUCT", name: "Lampe", priceCents: 5000, vatRate: 19, shippingCostCents: 400 });
    const near = await saveSupplier(ctx, null, { name: "Nah AG", deliveryDays: 2 });
    const far = await saveSupplier(ctx, null, { name: "Fern Ltd", currency: "USD" });
    const cheap = await saveSupplier(ctx, null, { name: "Billig GmbH" });
    const offer = await saveOffer(ctx, lamp.id, null, { supplierId: near.id, purchasePriceCents: 2500, preferred: true });
    await saveOffer(ctx, lamp.id, null, { supplierId: far.id, purchasePriceCents: 1000 });
    await saveOffer(ctx, lamp.id, null, { supplierId: cheap.id, purchasePriceCents: 2200, shippingCostCents: 100, preferred: true });
    await saveOffer(ctx, lamp.id, offer.id, { supplierId: near.id, purchasePriceCents: 2400, preferred: false });
    await expect(saveOffer(ctx, lamp.id, null, { supplierId: near.id, purchasePriceCents: 1 })).rejects.toMatchObject({ code: "OFFER_TAKEN" });

    const detail = await getProductDetail(ctx, lamp.id);
    const byName = Object.fromEntries(detail.offers.map((o) => [o.supplier.name, o]));
    // The USD offer is listed but cannot be compared with euro prices.
    expect(byName["Fern Ltd"].currency).toBe("USD");
    expect(detail.bestOfferId).toBe(byName["Billig GmbH"].id);
    expect(byName["Nah AG"].history.map((h) => h.purchasePriceCents)).toEqual([2400, 2500]);
    expect(detail.offers.filter((o) => o.preferred).map((o) => o.supplier.name)).toEqual(["Billig GmbH"]);
    // 5000 net → 5950 gross → fee 119 + 30; own shipping 400 wins over the offer's.
    expect(detail.margins).toMatchObject({ purchaseCents: 2200, grossMarginCents: 2800, paymentFeeCents: 149, shippingCents: 400, contributionCents: 2800 - 400 - 149 });
    expect((await listCatalog(ctx)).rows[0].margins.contributionCents).toBe(2800 - 400 - 149);

    const supplier = await getSupplierDetail(ctx, near.id);
    expect(supplier.offers.map((o) => o.product.name)).toEqual(["Lampe"]);
    expect(supplier.performance).toMatchObject({ orders: 0, received: 0, averageDays: null, limited: true });
  });

  it("accepts pictures only and keeps their order", async () => {
    const ctx = await newCompany("Bilder GmbH");
    const p = await saveProduct(ctx, { kind: "PRODUCT", name: "Vase", priceCents: 3000, vatRate: 19 });
    const png = (name: string) => storeDocument(ctx, { name, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) }, { category: "product" });
    const [one, two] = [await png("a.png"), await png("b.png")];
    const pdf = await storeDocument(ctx, { name: "x.pdf", bytes: new TextEncoder().encode("%PDF-1.4 x") });
    await addProductImage(ctx, p.id, one.id);
    await addProductImage(ctx, p.id, two.id);
    await expect(addProductImage(ctx, p.id, pdf.id)).rejects.toMatchObject({ code: "NOT_IMAGE" });
    let images = (await getProductDetail(ctx, p.id)).images;
    expect(images.map((i) => i.documentId)).toEqual([one.id, two.id]);
    await moveProductImage(ctx, images[1].id, "up");
    images = (await getProductDetail(ctx, p.id)).images;
    expect(images.map((i) => i.documentId)).toEqual([two.id, one.id]);
    expect((await listCatalog(ctx)).rows[0].imageId).toBe(two.id);
  });

  it("imports a list as inactive products with variants, suppliers and stock, once", async () => {
    const ctx = await newCompany("Import GmbH");
    await saveProduct(ctx, { kind: "PRODUCT", name: "Alt", sku: "OLD-1", priceCents: 100, vatRate: 19 });
    const id = await startImport(
      ctx,
      csv([
        "Name;Artikelnummer;Preis;EK;Kategorie;Lieferant;Bestand;Hauptartikel;Variante",
        "Shirt;TS;19,90;7,50;Kleidung;Textil AG;;;",
        ";TS-S;;;;Textil AG;4;TS;Größe=S",
        ";TS-M;21,90;;;;6;TS;Größe=M",
        "Mütze;MZ;9,90;;Kleidung;;3;;",
        "Doppelt;OLD-1;5,00;;;;;;",
        "Ohne Preis;NP;;;;;;;",
      ]),
    );
    const preview = await importPreview(ctx, id);
    expect(preview.mapping).toEqual(["name", "sku", "price", "purchasePrice", "category", "supplier", "stock", "parentSku", "variant"]);
    expect(preview.summary).toEqual({ products: 2, variants: 2, errors: 2, categories: 1, newSuppliers: 1 });
    expect(preview.rows.find((r) => r.sku === "OLD-1")?.errors).toEqual(["sku.exists"]);
    expect(preview.rows.find((r) => r.sku === "NP")?.errors).toEqual(["price.missing"]);

    expect(await applyImport(ctx, id)).toEqual({ created: 2, variants: 2 });
    await expect(applyImport(ctx, id)).rejects.toMatchObject({ code: "NOT_PREVIEW" });
    await expect(discardImport(ctx, id)).rejects.toMatchObject({ code: "NOT_PREVIEW" });

    const imported = await listCatalog(ctx, { status: "imported" });
    expect(imported.rows.map((r) => r.name).sort()).toEqual(["Mütze", "Shirt"]);
    const shirtId = imported.rows.find((r) => r.name === "Shirt")!.id;
    const shirt = await getProductDetail(ctx, shirtId);
    expect(shirt.product).toMatchObject({ active: false, category: "Kleidung", trackStock: true, variantOptions: [{ name: "Größe", values: ["S", "M"] }] });
    expect(shirt.variants.map((v) => [v.sku, Number(v.stockQuantity), v.priceCents])).toEqual([
      ["TS-S", 4, null],
      ["TS-M", 6, 2190],
    ]);
    expect(Number(shirt.product.stockQuantity)).toBe(10);
    expect(shirt.offers.map((o) => [o.supplier.name, o.variantId === null, o.purchasePriceCents])).toEqual([["Textil AG", true, 750]]);
    expect(shirt.margins.grossMarginCents).toBe(1990 - 750);

    expect(await activateImport(ctx, id)).toBe(2);
    expect((await listCatalog(ctx, { status: "imported" })).total).toBe(0);
    expect((await listCatalog(ctx, { q: "ts-m" })).rows.map((r) => r.name)).toEqual(["Shirt"]);

    const other = await startImport(ctx, csv(["Name;Preis", "X;1"]));
    await discardImport(ctx, other);
    await expect(applyImport(ctx, other)).rejects.toMatchObject({ code: "NOT_PREVIEW" });
    await expect(startImport(ctx, { name: "liste.csv", bytes: new Uint8Array() })).rejects.toMatchObject({ code: "EMPTY" });
    await expect(startImport(ctx, { name: "liste.pdf", bytes: new TextEncoder().encode("%PDF-1.4") })).rejects.toMatchObject({ code: "TYPE" });
  });

  it("lets the import fix columns by hand", async () => {
    const ctx = await newCompany("Spalten GmbH");
    const id = await startImport(ctx, csv(["Spalte A;Spalte B", "Tasse;4,50"]));
    expect((await importPreview(ctx, id)).summary.products).toBe(0);
    const fixed = await importPreview(ctx, id, ["name", "price"]);
    expect(fixed.summary).toMatchObject({ products: 1, errors: 0 });
    expect((await importPreview(ctx, id)).mapping).toEqual(["name", "price"]);
  });

  it("keeps every company's catalog to itself", async () => {
    const a = await newCompany("A GmbH");
    const b = await newCompany("B GmbH");
    const product = await saveProduct(a, { kind: "PRODUCT", name: "Geheim", priceCents: 100, vatRate: 19 });
    const supplier = await saveSupplier(a, null, { name: "Lieferant A" });
    const category = await saveCategory(a, null, { name: "Intern" });
    const doc = await storeDocument(a, { name: "a.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
    const own = await saveProduct(b, { kind: "PRODUCT", name: "Eigen", priceCents: 100, vatRate: 19 });

    expect((await listCatalog(b)).rows.map((r) => r.name)).toEqual(["Eigen"]);
    expect(await listCategories(b)).toEqual([]);
    await expect(getProductDetail(b, product.id)).rejects.toThrow();
    await expect(getSupplierDetail(b, supplier.id)).rejects.toThrow();
    await expect(saveOffer(b, own.id, null, { supplierId: supplier.id, purchasePriceCents: 1 })).rejects.toThrow();
    await expect(addProductImage(b, own.id, doc.id)).rejects.toThrow();
    await expect(saveProduct(b, { kind: "PRODUCT", name: "Eigen", priceCents: 100, vatRate: 19, categoryId: category.id }, own.id)).rejects.toThrow();
    await expect(deleteCategory(b, category.id)).rejects.toThrow();
    expect((await listCategories(a)).map((c) => c.name)).toEqual(["Intern"]);
  });

  it("asks for the right permission", async () => {
    const ctx = await newCompany("Rechte GmbH");
    const employee = await newMember(ctx, "EMPLOYEE");
    const p = await saveProduct(ctx, { kind: "PRODUCT", name: "Teil", priceCents: 100, vatRate: 19 });
    const s = await saveSupplier(ctx, null, { name: "L" });
    await expect(saveCategory(employee, null, { name: "X" })).rejects.toMatchObject({ permission: "products.manage" });
    await expect(saveVariantOptions(employee, p.id, [{ name: "A", values: ["1"] }])).rejects.toMatchObject({ permission: "products.manage" });
    await expect(saveOffer(employee, p.id, null, { supplierId: s.id, purchasePriceCents: 1 })).rejects.toMatchObject({ permission: "inventory.manage" });
    await expect(saveCommerceSettings(employee, { paymentFeePercent: 1, paymentFeeFixedCents: 0 })).rejects.toMatchObject({ permission: "settings.manage" });
    await expect(startImport(employee, csv(["Name;Preis", "X;1"]))).rejects.toMatchObject({ permission: "products.manage" });
  });
});
