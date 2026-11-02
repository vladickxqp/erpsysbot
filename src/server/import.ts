/**
 * Importing clients from a CSV file (Excel, other CRMs). Semicolon or comma,
 * headers in German, English or Russian; rows that look like an existing
 * client are skipped, broken rows are reported with their line number.
 */
import { ZodError } from "zod";
import { createClient, DuplicateClientError, type ClientInput } from "./clients";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

const MAX_ROWS = 2000;

/** RFC 4180-ish: quotes, doubled quotes, line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.slice(0, source.indexOf("\n") === -1 ? undefined : source.indexOf("\n"));
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const FIELDS: Record<keyof ClientInput & string, string[]> = {
  companyName: ["firma", "unternehmen", "company", "company name", "firmenname", "компания", "фирма", "организация"],
  firstName: ["vorname", "first name", "firstname", "given name", "имя"],
  lastName: ["nachname", "name", "last name", "lastname", "surname", "family name", "фамилия"],
  email: ["e-mail", "email", "mail", "e-mail-adresse", "почта", "эл. почта"],
  phone: ["telefon", "phone", "tel", "tel.", "mobil", "handy", "mobile", "телефон"],
  street: ["straße", "strasse", "street", "adresse", "address", "anschrift", "улица", "адрес"],
  postalCode: ["plz", "postleitzahl", "zip", "zip code", "postal code", "postcode", "индекс"],
  city: ["ort", "stadt", "city", "town", "город"],
  country: ["land", "country", "страна"],
  vatId: ["ust-idnr", "ust-idnr.", "ustid", "ust-id", "vat id", "vat", "vat number"],
  notes: ["notiz", "notizen", "notes", "note", "bemerkung", "kommentar", "заметки", "комментарий"],
  tags: ["tags", "tag", "schlagworte", "kategorie", "теги"],
  type: [],
  status: [],
  source: ["quelle", "source", "источник"],
};

const normalise = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

export function mapHeader(header: string[]): (keyof ClientInput | null)[] {
  return header.map((h) => {
    const key = normalise(h);
    const found = (Object.entries(FIELDS) as [keyof ClientInput, string[]][]).find(([, names]) => names.includes(key));
    return found ? found[0] : null;
  });
}

export type ImportResult = { created: number; skipped: number; failed: { line: number; reason: string }[]; unknownColumns: string[] };

export async function importClients(ctx: Context, text: string): Promise<ImportResult> {
  requirePermission(ctx.permissions, "clients.create");
  const rows = parseCsv(text);
  const [header, ...data] = rows;
  if (!header) return { created: 0, skipped: 0, failed: [], unknownColumns: [] };
  const map = mapHeader(header);
  const result: ImportResult = { created: 0, skipped: 0, failed: [], unknownColumns: header.filter((_, i) => !map[i]).map((h) => h.trim()).filter(Boolean) };
  if (data.length > MAX_ROWS) {
    result.failed.push({ line: MAX_ROWS + 2, reason: "TOO_MANY_ROWS" });
  }
  for (const [index, cells] of data.slice(0, MAX_ROWS).entries()) {
    const line = index + 2;
    const input: Record<string, unknown> = {};
    map.forEach((field, i) => {
      const value = cells[i]?.trim();
      if (!field || !value) return;
      input[field] = field === "tags" ? value.split(/[,|]/).map((t) => t.trim()).filter(Boolean) : value;
    });
    if (typeof input.country === "string" && input.country.length !== 2) delete input.country;
    input.type = input.companyName ? "COMPANY" : "PERSON";
    input.source ??= "Import";
    try {
      await createClient(ctx, input as ClientInput);
      result.created++;
    } catch (e) {
      if (e instanceof DuplicateClientError) result.skipped++;
      else if (e instanceof ZodError) result.failed.push({ line, reason: e.issues.map((i) => String(i.path[0])).join(", ") });
      else throw e;
    }
  }
  return result;
}
