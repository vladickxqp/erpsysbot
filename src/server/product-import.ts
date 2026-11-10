/**
 * Products from a file: CSV or Excel. Uploading only reads the file; the
 * preview shows what each row would become and what is wrong with it; only
 * applying creates anything, and what it creates stays inactive until the
 * company has looked at it and activates it. Rows with mistakes are left out,
 * never guessed.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { productImports, productSuppliers, productVariants, products, supplierPriceHistory, suppliers } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { allowedRates } from "@/lib/countries";
import { guessMapping, IMPORT_FIELDS, readRows, type ImportField, type ImportRow } from "@/lib/product-import";
import { choiceKey, cleanOptions, type VariantOption } from "@/lib/variants";
import { audit } from "./audit";
import { categoryByName } from "./catalog";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { parseCsv } from "./import";
import { bookMovement } from "./inventory";
import { requirePermission } from "./permissions";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
const MAX_COLUMNS = 60;

export class ProductImportError extends Error {
  constructor(public readonly code: "TOO_LARGE" | "TYPE" | "EMPTY" | "TOO_MANY_ROWS" | "NOT_PREVIEW" | "NOTHING") {
    super(code);
  }
}

/** The first sheet or the CSV as rows of text cells. */
export async function readTable(name: string, bytes: Uint8Array): Promise<string[][]> {
  if (!bytes.length) throw new ProductImportError("EMPTY");
  if (bytes.length > MAX_IMPORT_BYTES) throw new ProductImportError("TOO_LARGE");
  const ext = name.toLowerCase().split(".").pop() ?? "";
  let table: string[][];
  if (ext === "xlsx" || ext === "xls" || ext === "ods") {
    const XLSX = await import("@e965/xlsx");
    // Formulas are not run and links are not followed: only the stored values are read.
    const book = XLSX.read(bytes, { type: "array", cellFormula: false, cellHTML: false, sheetRows: MAX_IMPORT_ROWS + 2 });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new ProductImportError("EMPTY");
    table = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: false }) as unknown[][]).map((row) => row.map((cell) => String(cell ?? "")));
  } else if (ext === "csv" || ext === "txt" || ext === "tsv") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // Excel's CSV in Germany: Windows-1252.
      text = new TextDecoder("windows-1252").decode(bytes);
    }
    table = parseCsv(text.replace(/^﻿/, ""));
  } else throw new ProductImportError("TYPE");
  table = table.filter((row) => row.some((cell) => cell.trim())).map((row) => row.slice(0, MAX_COLUMNS));
  if (table.length < 2) throw new ProductImportError("EMPTY");
  if (table.length - 1 > MAX_IMPORT_ROWS) throw new ProductImportError("TOO_MANY_ROWS");
  return table;
}

export async function startImport(ctx: Context, file: { name: string; bytes: Uint8Array }): Promise<string> {
  requirePermission(ctx.permissions, "products.manage");
  const table = await readTable(file.name, file.bytes);
  const header = table[0].map((cell) => cell.trim().slice(0, 80));
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .insert(productImports)
      .values({ organizationId: ctx.organization.id, fileName: file.name.replace(/[\\/\u0000-\u001f]+/g, "_").slice(0, 200), header, rows: table.slice(1), mapping: guessMapping(header), createdBy: ctx.user.userId })
      .returning({ id: productImports.id });
    await audit(tx, ctx, "product_import.start", "product_import", row.id, { rows: table.length - 1 });
    return row.id;
  });
}

const mappingInput = z.array(z.enum(IMPORT_FIELDS).nullable()).max(MAX_COLUMNS);

type Checked = ImportRow & { isVariant: boolean };

/** The file's rows checked against what the company already has. */
async function check(tx: Tx, ctx: Context, header: string[], body: string[][], mapping: (ImportField | null)[]): Promise<Checked[]> {
  const rates = ctx.organization.smallBusiness ? [0, ...allowedRates(ctx.organization.taxRates, ctx.organization.country)] : allowedRates(ctx.organization.taxRates, ctx.organization.country);
  const rows: Checked[] = readRows([header, ...body], mapping, rates).map((r) => ({ ...r, isVariant: !!r.parentSku }));
  const skus = rows.map((r) => r.sku).filter((s): s is string => !!s);
  const parents = rows.map((r) => r.parentSku).filter((s): s is string => !!s);
  // SKUs are compared without case: "ab-1" and "AB-1" are the same article to a person.
  const lookup = [...new Set([...skus, ...parents].map((s) => s.toLowerCase()))];
  const known = lookup.length
    ? [
        ...(await tx.select({ sku: products.sku }).from(products).where(inArray(sql`lower(${products.sku})`, lookup))).map((r) => ({ sku: r.sku!, product: true })),
        ...(await tx.select({ sku: productVariants.sku }).from(productVariants).where(inArray(sql`lower(${productVariants.sku})`, lookup))).map((r) => ({ sku: r.sku!, product: false })),
      ]
    : [];
  const existing = new Set(known.map((k) => k.sku.toLowerCase()));
  const existingProducts = new Set(known.filter((k) => k.product).map((k) => k.sku.toLowerCase()));
  const mains = new Map(rows.filter((r) => !r.isVariant && r.sku).map((r) => [r.sku!.toLowerCase(), r]));
  for (const row of rows) {
    if (row.sku && existing.has(row.sku.toLowerCase())) row.errors.push("sku.exists");
    if (row.isVariant) {
      const parent = mains.get(row.parentSku!.toLowerCase());
      if (parent?.errors.length) row.errors.push("parent.invalid");
      else if (!parent && !existingProducts.has(row.parentSku!.toLowerCase())) row.errors.push("parent.unknown");
    }
  }
  return rows;
}

export async function importPreview(ctx: Context, id: string, rawMapping?: (string | null)[]) {
  requirePermission(ctx.permissions, "products.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const [batch] = await tx.select().from(productImports).where(eq(productImports.id, id));
    if (!batch) throw new NotFoundError();
    const header = batch.header as string[];
    let mapping = batch.mapping as (ImportField | null)[];
    if (rawMapping && batch.status === "PREVIEW") {
      mapping = mappingInput.parse(rawMapping.slice(0, header.length));
      await tx.update(productImports).set({ mapping }).where(eq(productImports.id, id));
    }
    const rows = await check(tx, ctx, header, batch.rows as string[][], mapping);
    const valid = rows.filter((r) => !r.errors.length);
    const categories = [...new Set(valid.map((r) => r.category?.toLowerCase()).filter(Boolean))];
    const supplierNames = [...new Set(valid.map((r) => r.supplier?.toLowerCase()).filter(Boolean))] as string[];
    const knownSuppliers = supplierNames.length
      ? (await tx.select({ name: suppliers.name }).from(suppliers).where(inArray(sql`lower(${suppliers.name})`, supplierNames))).map((s) => s.name.toLowerCase())
      : [];
    return {
      id: batch.id,
      fileName: batch.fileName,
      status: batch.status,
      createdCount: batch.createdCount,
      header,
      mapping,
      rows,
      summary: {
        products: valid.filter((r) => !r.isVariant).length,
        variants: valid.filter((r) => r.isVariant).length,
        errors: rows.length - valid.length,
        categories: categories.length,
        newSuppliers: supplierNames.filter((n) => !knownSuppliers.includes(n)).length,
      },
    };
  });
}

/** Creates what the preview showed as valid, inactive and marked with this import. Once. */
export async function applyImport(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "products.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const [batch] = await tx.select().from(productImports).where(eq(productImports.id, id)).for("update");
    if (!batch) throw new NotFoundError();
    if (batch.status !== "PREVIEW") throw new ProductImportError("NOT_PREVIEW");
    const rows = (await check(tx, ctx, batch.header as string[], batch.rows as string[][], batch.mapping as (ImportField | null)[])).filter((r) => !r.errors.length);
    if (!rows.length) throw new ProductImportError("NOTHING");
    const org = ctx.organization;
    const defaultRate = org.smallBusiness ? 0 : allowedRates(org.taxRates, org.country)[0];
    const supplierIds = new Map<string, string>();
    const supplierOf = async (name: string) => {
      const key = name.toLowerCase();
      if (supplierIds.has(key)) return supplierIds.get(key)!;
      const [known] = await tx.select({ id: suppliers.id }).from(suppliers).where(sql`lower(${suppliers.name}) = ${key}`).limit(1);
      const supplierId = known?.id ?? (await tx.insert(suppliers).values({ organizationId: org.id, name, country: org.country }).returning({ id: suppliers.id }))[0].id;
      supplierIds.set(key, supplierId);
      return supplierId;
    };
    const offer = async (productId: string, variantId: string | null, row: ImportRow) => {
      if (!row.supplier || row.purchasePriceCents === null) return;
      const [made] = await tx
        .insert(productSuppliers)
        .values({ organizationId: org.id, productId, variantId, supplierId: await supplierOf(row.supplier), supplierSku: row.supplierSku, purchasePriceCents: row.purchasePriceCents, currency: org.currency, preferred: true })
        .onConflictDoNothing()
        .returning();
      if (made) await tx.insert(supplierPriceHistory).values({ organizationId: org.id, productSupplierId: made.id, purchasePriceCents: made.purchasePriceCents, currency: made.currency });
    };
    const productIds = new Map<string, string>();
    let created = 0;
    let variants = 0;
    for (const row of rows.filter((r) => !r.isVariant)) {
      const categoryId = row.category ? await categoryByName(tx, org.id, row.category) : null;
      const [product] = await tx
        .insert(products)
        .values({
          organizationId: org.id,
          kind: row.kind,
          name: row.name!,
          sku: row.sku,
          description: row.description,
          unit: row.unit ?? "Stk",
          priceCents: row.priceCents ?? 0,
          purchasePriceCents: row.purchasePriceCents,
          vatRate: row.vatRate ?? defaultRate,
          barcode: row.barcode,
          category: row.category,
          categoryId,
          weightGrams: row.weightGrams,
          trackStock: row.kind === "PRODUCT" && (row.stock !== null || row.minStock !== null),
          minStock: row.minStock === null ? null : String(row.minStock),
          active: false,
          importId: batch.id,
        })
        .returning({ id: products.id });
      if (row.sku) productIds.set(row.sku.toLowerCase(), product.id);
      if (row.kind === "PRODUCT" && row.stock) {
        await bookMovement(tx, ctx, { productId: product.id, type: "ADJUSTMENT", quantity: row.stock, dedupeKey: `import:${batch.id}:${row.line}`, note: batch.fileName });
      }
      await offer(product.id, null, row);
      created++;
    }
    const touched = new Map<string, VariantOption[]>();
    for (const row of rows.filter((r) => r.isVariant)) {
      const key = row.parentSku!.toLowerCase();
      let productId = productIds.get(key);
      if (!productId) {
        const [parent] = await tx.select({ id: products.id }).from(products).where(sql`lower(${products.sku}) = ${key}`).limit(1);
        if (!parent) continue;
        productId = parent.id;
        productIds.set(key, productId);
      }
      const choice = row.variant!;
      const [variant] = await tx
        .insert(productVariants)
        .values({
          organizationId: org.id,
          productId,
          options: choice,
          optionsKey: choiceKey(choice),
          sku: row.sku,
          barcode: row.barcode,
          priceCents: row.priceCents,
          purchasePriceCents: row.purchasePriceCents,
          minStock: row.minStock === null ? null : String(row.minStock),
          position: variants + 1,
        })
        .onConflictDoNothing()
        .returning({ id: productVariants.id });
      if (!variant) continue;
      if (row.stock) {
        await tx.update(products).set({ trackStock: true, kind: "PRODUCT" }).where(eq(products.id, productId));
        await bookMovement(tx, ctx, { productId, variantId: variant.id, type: "ADJUSTMENT", quantity: row.stock, dedupeKey: `import:${batch.id}:${row.line}`, note: batch.fileName });
      }
      await offer(productId, variant.id, row);
      const options = touched.get(productId) ?? [];
      for (const [name, value] of Object.entries(choice)) {
        const option = options.find((o) => o.name === name);
        if (option) option.values.push(value);
        else options.push({ name, values: [value] });
      }
      touched.set(productId, options);
      variants++;
    }
    // The product learns the options its variants are made of, joined with those it had.
    for (const [productId, options] of touched) {
      const [product] = await tx.select({ variantOptions: products.variantOptions }).from(products).where(eq(products.id, productId));
      const before = (product?.variantOptions ?? []) as VariantOption[];
      const merged = [...before.map((o) => ({ ...o, values: [...o.values] }))];
      for (const option of options) {
        const known = merged.find((o) => o.name === option.name);
        if (known) known.values.push(...option.values);
        else merged.push(option);
      }
      await tx.update(products).set({ variantOptions: cleanOptions(merged) }).where(eq(products.id, productId));
    }
    await tx.update(productImports).set({ status: "APPLIED", createdCount: created + variants, appliedAt: new Date() }).where(eq(productImports.id, id));
    await audit(tx, ctx, "product_import.apply", "product_import", id, { products: created, variants });
    return { created, variants };
  });
}

/** The company has looked at them: the imported products go on sale. */
export async function activateImport(ctx: Context, id: string): Promise<number> {
  requirePermission(ctx.permissions, "products.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const done = await tx.update(products).set({ active: true, updatedAt: new Date() }).where(and(eq(products.importId, id), eq(products.active, false))).returning({ id: products.id });
    await audit(tx, ctx, "product_import.activate", "product_import", id, { products: done.length });
    return done.length;
  });
}

export async function discardImport(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "products.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.update(productImports).set({ status: "DISCARDED", rows: [] }).where(and(eq(productImports.id, id), eq(productImports.status, "PREVIEW"))).returning({ id: productImports.id });
    if (!row) throw new ProductImportError("NOT_PREVIEW");
  });
}

export async function listImports(ctx: Context) {
  requirePermission(ctx.permissions, "products.manage");
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ id: productImports.id, fileName: productImports.fileName, status: productImports.status, createdCount: productImports.createdCount, createdAt: productImports.createdAt })
      .from(productImports)
      .orderBy(desc(productImports.createdAt))
      .limit(20),
  );
}
