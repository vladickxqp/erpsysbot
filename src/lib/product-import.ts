/**
 * Reading a product list someone exported elsewhere: which column is what,
 * and what each row would become. No database code: the preview uses it too.
 */
import { parseMoney } from "@/server/money";
import { parseChoice, type VariantChoice } from "./variants";

export const IMPORT_FIELDS = [
  "name",
  "sku",
  "parentSku",
  "variant",
  "kind",
  "description",
  "category",
  "unit",
  "price",
  "purchasePrice",
  "vatRate",
  "barcode",
  "stock",
  "minStock",
  "weight",
  "supplier",
  "supplierSku",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Header words people use, in the languages the app speaks; compared without case, spaces and dots. */
const SYNONYMS: Record<ImportField, string[]> = {
  name: ["name", "bezeichnung", "produkt", "produktname", "artikel", "artikelname", "title", "titel", "product", "productname", "название", "наименование", "товар", "назва", "nombre", "producto"],
  sku: ["sku", "artikelnummer", "artnr", "artikelnr", "itemnumber", "productcode", "artikul", "артикул", "referencia"],
  parentSku: ["parentsku", "elternsku", "hauptartikel", "elternartikelnummer", "parent", "родительскийартикул", "батьківськийартикул"],
  variant: ["variant", "variante", "varianten", "options", "optionen", "вариант", "варіант"],
  kind: ["typ", "type", "art", "kind", "тип"],
  description: ["description", "beschreibung", "text", "описание", "опис", "descripción", "descripcion"],
  category: ["category", "kategorie", "warengruppe", "категория", "категорія", "categoría", "categoria"],
  unit: ["unit", "einheit", "mengeneinheit", "единица", "одиниця", "unidad"],
  price: ["price", "preis", "vk", "verkaufspreis", "nettopreis", "vknetto", "цена", "ціна", "precio", "sellingprice"],
  purchasePrice: ["purchaseprice", "ek", "einkaufspreis", "eknetto", "cost", "закупочнаяцена", "закупівельнаціна", "preciodecompra"],
  vatRate: ["vat", "vatrate", "mwst", "ust", "steuersatz", "mehrwertsteuer", "ндс", "пдв", "iva", "tax"],
  barcode: ["barcode", "ean", "gtin", "upc", "штрихкод", "códigodebarras"],
  stock: ["stock", "bestand", "lagerbestand", "menge", "quantity", "остаток", "залишок", "existencias"],
  minStock: ["minstock", "mindestbestand", "минимальныйостаток", "мінімальнийзалишок", "stockmínimo"],
  weight: ["weight", "gewicht", "gewichtg", "вес", "вага", "peso"],
  supplier: ["supplier", "lieferant", "hersteller", "vendor", "поставщик", "постачальник", "proveedor"],
  supplierSku: ["suppliersku", "lieferantenartikelnummer", "lieferantenartnr", "herstellernummer", "mpn", "артикулпоставщика", "артикулпостачальника"],
};

const squash = (s: string) => s.toLowerCase().normalize("NFC").replace(/[\s._\-/()€%]+/g, "");

/** The field each column most likely holds; null for columns nobody can place. A field is taken once. */
export function guessMapping(header: readonly string[]): (ImportField | null)[] {
  const taken = new Set<ImportField>();
  return header.map((title) => {
    const word = squash(title);
    const field = IMPORT_FIELDS.find((f) => !taken.has(f) && SYNONYMS[f].some((s) => squash(s) === word));
    if (field) taken.add(field);
    return field ?? null;
  });
}

export type ImportRow = {
  /** Line in the file (the header is line 1). */
  line: number;
  name: string | null;
  sku: string | null;
  parentSku: string | null;
  variant: VariantChoice | null;
  kind: "PRODUCT" | "SERVICE";
  description: string | null;
  category: string | null;
  unit: string | null;
  priceCents: number | null;
  purchasePriceCents: number | null;
  vatRate: number | null;
  barcode: string | null;
  stock: number | null;
  minStock: number | null;
  weightGrams: number | null;
  supplier: string | null;
  supplierSku: string | null;
  errors: string[];
};

const number = (text: string) => {
  const t = text.trim().replace(/\s/g, "");
  if (!t) return null;
  // "1.234,5" and "1,234.5" both mean 1234.5.
  const normal = /,\d{1,3}$/.test(t) && !/\.\d{1,3}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const n = Number(normal);
  return Number.isFinite(n) ? n : Number.NaN;
};

const KINDS: Record<string, "PRODUCT" | "SERVICE"> = { product: "PRODUCT", produkt: "PRODUCT", ware: "PRODUCT", artikel: "PRODUCT", товар: "PRODUCT", service: "SERVICE", dienstleistung: "SERVICE", leistung: "SERVICE", услуга: "SERVICE", послуга: "SERVICE" };

/** Every row as the import would take it, with what is wrong with it. Rules that need the database come later. */
export function readRows(table: readonly string[][], mapping: readonly (ImportField | null)[], allowedRates: readonly number[]): ImportRow[] {
  const at = (row: readonly string[], field: ImportField) => {
    const index = mapping.indexOf(field);
    const value = index >= 0 ? (row[index] ?? "").trim() : "";
    return value || null;
  };
  const seen = new Map<string, number>();
  return table.slice(1).flatMap((row, index) => {
    if (row.every((cell) => !cell.trim())) return [];
    const errors: string[] = [];
    const text = (field: ImportField, max: number) => {
      const value = at(row, field);
      if (value && value.length > max) errors.push(`${field}.long`);
      return value ? value.slice(0, max) : null;
    };
    const money = (field: "price" | "purchasePrice") => {
      const value = at(row, field);
      if (!value) return null;
      const cents = parseMoney(value);
      if (cents === null || cents < 0) {
        errors.push(`${field}.invalid`);
        return null;
      }
      return cents;
    };
    const amount = (field: ImportField) => {
      const value = at(row, field);
      if (!value) return null;
      const n = number(value);
      if (Number.isNaN(n) || (n as number) < 0) {
        errors.push(`${field}.invalid`);
        return null;
      }
      return n;
    };
    const parentSku = text("parentSku", 60);
    const variantText = at(row, "variant");
    const variant = variantText ? parseChoice(variantText) : null;
    if (variantText && !variant) errors.push("variant.invalid");
    if (parentSku && !variant) errors.push("variant.missing");
    const name = text("name", 200);
    if (!name && !parentSku) errors.push("name.missing");
    const priceCents = money("price");
    if (priceCents === null && !parentSku && !errors.includes("price.invalid")) errors.push("price.missing");
    const vatValue = at(row, "vatRate");
    const vat = vatValue === null ? null : number(vatValue.replace("%", ""));
    if (vat !== null && (Number.isNaN(vat) || !allowedRates.includes(vat))) errors.push("vatRate.invalid");
    const sku = text("sku", 60);
    if (sku) {
      const first = seen.get(sku.toLowerCase());
      if (first) errors.push("sku.twice");
      else seen.set(sku.toLowerCase(), index + 2);
    }
    const kindValue = at(row, "kind")?.toLowerCase() ?? null;
    const stock = amount("stock");
    return [
      {
        line: index + 2,
        name,
        sku,
        parentSku,
        variant,
        // An import is a list of goods unless a row says otherwise.
        kind: kindValue && KINDS[kindValue] ? KINDS[kindValue] : "PRODUCT",
        description: text("description", 2000),
        category: text("category", 80),
        unit: text("unit", 20),
        priceCents,
        purchasePriceCents: money("purchasePrice"),
        vatRate: vat !== null && !Number.isNaN(vat) ? vat : null,
        barcode: text("barcode", 60),
        stock,
        minStock: amount("minStock"),
        weightGrams: (() => {
          const w = amount("weight");
          return w === null ? null : Math.round(w);
        })(),
        supplier: text("supplier", 200),
        supplierSku: text("supplierSku", 80),
        errors,
      },
    ];
  });
}
