/**
 * Product variants: a product names its options (size, colour …) and their
 * values; every combination can become a variant with its own SKU, price and
 * stock. No database code: the editor uses it too.
 */
export type VariantOption = { name: string; values: string[] };
export type VariantChoice = Record<string, string>;

export const MAX_OPTIONS = 3;
export const MAX_VALUES = 30;
export const MAX_VARIANTS = 200;

/** Options as typed: trimmed, without empty or repeated names and values. */
export function cleanOptions(options: readonly VariantOption[]): VariantOption[] {
  const seen = new Set<string>();
  const out: VariantOption[] = [];
  for (const option of options) {
    const name = option.name.trim().slice(0, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const values = [...new Set(option.values.map((v) => v.trim().slice(0, 60)).filter(Boolean))].slice(0, MAX_VALUES);
    if (values.length) out.push({ name, values });
    if (out.length === MAX_OPTIONS) break;
  }
  return out;
}

/** Every combination of the options' values, in the order they were given. */
export function combinations(options: readonly VariantOption[]): VariantChoice[] {
  let result: VariantChoice[] = [{}];
  for (const option of cleanOptions(options)) {
    result = result.flatMap((choice) => option.values.map((value) => ({ ...choice, [option.name]: value })));
    if (result.length > MAX_VARIANTS) return result.slice(0, MAX_VARIANTS);
  }
  return result.length === 1 && !Object.keys(result[0]).length ? [] : result;
}

/** One stable key per combination, whatever order its options come in: "Farbe=Rot|Größe=M". */
export function choiceKey(choice: VariantChoice): string {
  return Object.keys(choice)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `${name}=${choice[name]}`)
    .join("|");
}

/** "Rot / M" — how a variant is named next to its product. */
export const choiceLabel = (choice: VariantChoice, options?: readonly VariantOption[]) =>
  (options?.length ? options.map((o) => choice[o.name]).filter(Boolean) : Object.values(choice)).join(" / ");

/** A suggested SKU for a variant: the product's SKU with the values, e.g. "TSHIRT-ROT-M". */
export function variantSku(base: string | null, choice: VariantChoice, options?: readonly VariantOption[]): string | null {
  if (!base) return null;
  const parts = (options?.length ? options.map((o) => choice[o.name]) : Object.values(choice)).filter(Boolean);
  const slug = parts.map((p) => p.normalize("NFKD").replace(/[^\w]+/g, "").toUpperCase()).filter(Boolean);
  return [base, ...slug].join("-").slice(0, 60);
}

/** "Größe=M; Farbe=Rot" (as an import column) → { Größe: "M", Farbe: "Rot" }. */
export function parseChoice(text: string): VariantChoice | null {
  const choice: VariantChoice = {};
  for (const part of text.split(/[;|]/)) {
    if (!part.trim()) continue;
    const at = part.indexOf("=") >= 0 ? part.indexOf("=") : part.indexOf(":");
    if (at <= 0) return null;
    const name = part.slice(0, at).trim().slice(0, 40);
    const value = part.slice(at + 1).trim().slice(0, 60);
    if (!name || !value) return null;
    choice[name] = value;
  }
  return Object.keys(choice).length ? choice : null;
}
