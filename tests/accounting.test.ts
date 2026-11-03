import { describe, expect, it } from "vitest";
import { createClient } from "@/server/clients";
import { updateCompany } from "@/server/company";
import { contextFor, type Context } from "@/server/context";
import { cp1252, datevExport, datevRows, grossByRate, saveDatevSettings } from "@/server/datev";
import { bookLine, importStatement, listBank, parseAmount, parseBankCsv, parseCamt, parseDate, setIgnored } from "@/server/bank";
import { listTransactions } from "@/server/finance";
import { createInvoiceDraft, getInvoice, issueInvoice, listInvoices, recordPayment } from "@/server/invoices";
import { deleteRecurring, listRecurring, nextOccurrence, runRecurring, saveRecurring } from "@/server/recurring";
import { newCompany, newMember } from "./helpers";

const line = (description: string, priceEur: number, vatRate = 19) => ({ description, quantity: 1, unit: "Stk", unitPriceCents: Math.round(priceEur * 100), discountPercent: 0, vatRate });

async function company(name: string): Promise<Context> {
  const ctx = await newCompany(name);
  await updateCompany(ctx, { name, street: "Hauptstraße 1", postalCode: "68159", city: "Mannheim", taxNumber: "38/123/45678" });
  return (await contextFor(ctx.user))!;
}

describe("recurring invoices", () => {
  it("keeps the day of the month across short months", () => {
    expect(nextOccurrence("2026-01-31", "MONTHLY", 31)).toBe("2026-02-28");
    expect(nextOccurrence("2026-02-28", "MONTHLY", 31)).toBe("2026-03-31");
    expect(nextOccurrence("2026-11-15", "QUARTERLY", 15)).toBe("2027-02-15");
    expect(nextOccurrence("2028-02-29", "YEARLY", 29)).toBe("2029-02-28");
    expect(nextOccurrence("2026-12-28", "WEEKLY", 28)).toBe("2027-01-04");
  });

  it("makes the due invoices once, catches up missed dates and stops at the end date", async () => {
    const ctx = await company("Abo GmbH");
    const client = await createClient(ctx, { companyName: "Mieter KG" });
    const plan = await saveRecurring(ctx, null, {
      clientId: client.id,
      title: "Miete",
      items: [line("Büromiete", 1000)],
      interval: "MONTHLY",
      startDate: "2026-01-31",
      endDate: "2026-04-30",
      autoIssue: true,
    });
    const first = await runRecurring(ctx, "2026-03-05");
    expect(first).toMatchObject({ created: 2, issued: 2, failed: 0 });
    expect(await runRecurring(ctx, "2026-03-05")).toMatchObject({ created: 0 });
    const [listed] = await listRecurring(ctx);
    expect(listed).toMatchObject({ nextDate: "2026-03-31", clientName: "Mieter KG", grossCents: 119000 });

    await runRecurring(ctx, "2026-12-31");
    const after = (await listRecurring(ctx))[0];
    expect(after.active).toBe(false);
    const { rows } = await listInvoices(ctx, { pageSize: 50 });
    expect(rows.map((r) => r.serviceDate).sort()).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(rows.every((r) => r.status === "ISSUED")).toBe(true);

    const employee = await newMember(ctx, "EMPLOYEE");
    await expect(saveRecurring(employee, null, { clientId: client.id, items: [line("x", 1)], interval: "WEEKLY", startDate: "2026-01-01" })).rejects.toMatchObject({ permission: "invoices.create" });
    await deleteRecurring(ctx, plan.id);
    expect(await listRecurring(ctx)).toEqual([]);
  });

  it("keeps the date for later when the invoice cannot be made", async () => {
    const ctx = await company("Abo Fehler GmbH");
    const client = await createClient(ctx, { companyName: "Kunde" });
    await saveRecurring(ctx, null, { clientId: client.id, items: [line("Wartung", 50)], interval: "MONTHLY", startDate: "2026-05-01" });
    // Rates of the company changed meanwhile: 19 % is no longer allowed.
    await updateCompany(ctx, { name: ctx.organization.name, street: "Hauptstraße 1", postalCode: "68159", city: "Mannheim", taxNumber: "38/123/45678", taxRates: "7" });
    const changed = (await contextFor(ctx.user))!;
    expect(await runRecurring(changed, "2026-05-02")).toMatchObject({ created: 0, failed: 1 });
    const [plan] = await listRecurring(changed);
    expect(plan.nextDate).toBe("2026-05-01");
    expect(plan.lastError).toBeTruthy();
  });
});

describe("DATEV export", () => {
  it("splits gross by tax rate to the cent", () => {
    expect(grossByRate([{ vatRate: 19, netCents: 1000 }, { vatRate: 7, netCents: 333 }], 1546, false)).toEqual([
      { rate: 19, cents: 1190 },
      { rate: 7, cents: 356 },
    ]);
    expect(grossByRate([{ vatRate: 0, netCents: 500 }], 500, true)).toEqual([{ rate: 0, cents: 500 }]);
    expect([...cp1252("Müller €—x")]).toEqual([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x20, 0x80, 0x97, 0x78]);
  });

  it("books invoices to the debtor and revenue accounts, payments to the bank", async () => {
    const ctx = await company("Datev GmbH");
    const client = await createClient(ctx, { companyName: "Müller & Söhne" });
    const draft = await createInvoiceDraft(ctx, { clientId: client.id, items: [line("Beratung", 100), line("Buch", 10, 7)] });
    const invoice = await issueInvoice(ctx, draft.id);
    await recordPayment(ctx, invoice.id, { amountCents: invoice.grossCents, paidOn: invoice.issueDate! });
    const day = invoice.issueDate!;

    const rows = await datevRows(ctx, `${day.slice(0, 4)}-01-01`, `${day.slice(0, 4)}-12-31`, "SKR03");
    expect(rows).toEqual([
      { cents: 11900, side: "S", account: 10000 + client.number, contra: 8400, date: day, document: invoice.number, text: "Müller & Söhne" },
      { cents: 1070, side: "S", account: 10000 + client.number, contra: 8300, date: day, document: invoice.number, text: "Müller & Söhne" },
      { cents: 12970, side: "S", account: 1200, contra: 10000 + client.number, date: day, document: invoice.number, text: `Müller & Söhne ${invoice.number}` },
    ]);

    await expect(datevExport(ctx, `${day.slice(0, 4)}-01-01`, `${day.slice(0, 4)}-12-31`)).rejects.toMatchObject({ code: "NOT_SET_UP" });
    await saveDatevSettings(ctx, { consultant: 12345, client: 678, chart: "SKR04" });
    const fresh = (await contextFor(ctx.user))!;
    await expect(datevExport(fresh, "2025-12-01", "2026-01-31")).rejects.toMatchObject({ code: "ONE_YEAR" });
    const file = await datevExport(fresh, `${day.slice(0, 4)}-01-01`, `${day.slice(0, 4)}-12-31`);
    const text = new TextDecoder("windows-1252").decode(file.bytes);
    const lines = text.trimEnd().split("\r\n");
    expect(lines[0]).toMatch(/^"EXTF";700;21;"Buchungsstapel";13;\d{17};;"RE";"";"";12345;678;\d{8};4;/);
    expect(lines[0]).toContain(';"04";');
    expect(lines[2]).toBe(`119,00;"S";"EUR";;;"";${10000 + client.number};4400;"";${day.slice(8, 10)}${day.slice(5, 7)};"${invoice.number}";"";;"Müller & Söhne"`);
    expect(lines[4]).toContain(";1800;");
    expect(file.rows).toBe(3);

    const accountant = await newMember(ctx, "EMPLOYEE");
    await expect(datevRows(accountant, "2026-01-01", "2026-12-31", "SKR03")).rejects.toMatchObject({ permission: "finance.export" });
  });
});

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt>
<Ntry><Amt Ccy="EUR">{AMOUNT}</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-11-02</Dt></BookgDt><AcctSvcrRef>REF-1</AcctSvcrRef>
<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Mieter KG</Nm></Dbtr><DbtrAcct><Id><IBAN>DE02 1203 0000 0000 2020 51</IBAN></Id></DbtrAcct></RltdPties>
<RmtInf><Ustrd>Rechnung {NUMBER} vielen Dank</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">49.90</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-11-03</Dt></BookgDt><AcctSvcrRef>REF-2</AcctSvcrRef>
<NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Telekom &amp; Co</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Internet November</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

describe("bank statements", () => {
  it("reads CAMT and bank CSV exports", () => {
    const lines = parseCamt(CAMT.replace("{AMOUNT}", "119.00").replace("{NUMBER}", "RE-2026-0001"));
    expect(lines).toEqual([
      { bookedOn: "2026-11-02", amountCents: 11900, currency: "EUR", counterparty: "Mieter KG", iban: "DE02120300000000202051", purpose: "Rechnung RE-2026-0001 vielen Dank", ref: "REF-1" },
      { bookedOn: "2026-11-03", amountCents: -4990, currency: "EUR", counterparty: "Telekom & Co", iban: null, purpose: "Internet November", ref: "REF-2" },
    ]);
    const csv = 'Kontoinhaber;Muster\n\n"Buchungstag";"Valutadatum";"Beguenstigter/Zahlungspflichtiger";"Verwendungszweck";"IBAN";"Betrag (EUR)"\n02.11.26;02.11.26;"Kunde AG";"RE 2026 0002";"DE12";"1.234,56"\n03.11.2026;03.11.2026;"Miete";"Büro";"";"-800,00"\n';
    expect(parseBankCsv(csv)).toEqual([
      { bookedOn: "2026-11-02", amountCents: 123456, currency: "EUR", counterparty: "Kunde AG", iban: "DE12", purpose: "RE 2026 0002", ref: null },
      { bookedOn: "2026-11-03", amountCents: -80000, currency: "EUR", counterparty: "Miete", iban: null, purpose: "Büro", ref: null },
    ]);
    expect(parseAmount("1,234.56")).toBe(123456);
    expect(parseAmount("-12,3")).toBe(-1230);
    expect(parseDate("2026-01-05T10:00")).toBe("2026-01-05");
    expect(() => parseBankCsv("a;b\n1;2")).toThrow();
  });

  it("imports each line once, pays the invoice it clearly names and books the rest on request", async () => {
    const ctx = await company("Bank GmbH");
    const client = await createClient(ctx, { companyName: "Mieter KG" });
    const invoice = await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, items: [line("Miete", 100)] })).id);
    const xml = new TextEncoder().encode(CAMT.replace("{AMOUNT}", "119.00").replace("{NUMBER}", invoice.number!));

    expect(await importStatement(ctx, { name: "konto.xml", bytes: xml })).toEqual({ lines: 2, imported: 2, skipped: 0, matched: 1 });
    expect(await importStatement(ctx, { name: "konto.xml", bytes: xml })).toMatchObject({ imported: 0, skipped: 2 });
    expect((await getInvoice(ctx, invoice.id)).invoice.status).toBe("PAID");

    const { rows } = await listBank(ctx, "NEW");
    expect(rows.map((r) => r.amountCents)).toEqual([-4990]);
    await bookLine(ctx, rows[0].id, "other");
    await expect(bookLine(ctx, rows[0].id)).rejects.toMatchObject({ code: "NOT_NEW" });
    const expenses = await listTransactions(ctx, { type: "EXPENSE" });
    expect(expenses.rows.map((t) => [t.amountCents, t.category])).toEqual([[4990, "other"]]);
    expect((await listBank(ctx, "MATCHED")).rows.map((r) => r.invoiceId)).toEqual([invoice.id]);

    const csv = new TextEncoder().encode('Buchungstag;Betrag;Verwendungszweck\n05.11.2026;10,00;Zinsen\n');
    await importStatement(ctx, { name: "x.csv", bytes: csv });
    const [interest] = (await listBank(ctx, "NEW")).rows;
    await setIgnored(ctx, interest.id, true);
    expect((await listBank(ctx, "IGNORED")).rows).toHaveLength(1);

    const other = await company("Fremde Bank GmbH");
    expect((await listBank(other, "MATCHED")).rows).toEqual([]);
    const employee = await newMember(ctx, "EMPLOYEE");
    await expect(importStatement(employee, { name: "x.csv", bytes: csv })).rejects.toMatchObject({ permission: "finance.create" });
  });

  it("suggests an invoice by amount and name when the purpose does not name it", async () => {
    const ctx = await company("Vorschlag GmbH");
    const client = await createClient(ctx, { companyName: "Schmidt Bau" });
    const invoice = await issueInvoice(ctx, (await createInvoiceDraft(ctx, { clientId: client.id, items: [line("Arbeit", 200)] })).id);
    const csv = new TextEncoder().encode("Buchungstag;Name;Betrag;Verwendungszweck\n04.11.2026;SCHMIDT BAU GMBH;238,00;Danke\n");
    expect(await importStatement(ctx, { name: "a.csv", bytes: csv })).toMatchObject({ imported: 1, matched: 0 });
    const [entry] = (await listBank(ctx, "NEW")).rows;
    expect(entry.suggestions).toEqual([{ invoiceId: invoice.id, number: invoice.number, clientName: "Schmidt Bau", openCents: 23800, sure: false }]);
  });
});
