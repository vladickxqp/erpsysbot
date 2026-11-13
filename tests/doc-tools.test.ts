import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { automationRuns, contentGenerations, organizations } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { blocksText, inlineRuns, placeholdersOf, textBlocks, type DocBlock } from "@/lib/doc-text";
import { saveAutomation } from "@/server/automations";
import { createClient } from "@/server/clients";
import { contextFor, type Context } from "@/server/context";
import {
  convertDocument,
  createFromTemplate,
  deleteTemplate,
  DOCX,
  draftTemplate,
  extractPages,
  imagesToPdfDocument,
  listTemplates,
  mergePdfDocuments,
  saveTemplate,
} from "@/server/doc-tools";
import { listDocuments, readDocument, storeDocument } from "@/server/documents";
import { fillDocx, placeholdersOfDocx, readDocx, unzip, writeDocx, zip } from "@/server/docx";
import { createOrder } from "@/server/orders";
import { blocksToPdf, imagesToPdf, mergePdfs, pageList, pickPages } from "@/server/pdf-tools";
import { newCompany, newMember } from "./helpers";

/** A one-pixel PNG. */
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();
const text = (blocks: DocBlock[]) => blocksText(blocks);
const codeOf = (work: () => unknown) => {
  try {
    work();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "thrown";
  }
};

async function company(name: string): Promise<Context> {
  const ctx = await newCompany(name);
  await getDb().update(organizations).set({ street: "Hafenweg 2", postalCode: "20457", city: "Hamburg", email: "hallo@example.org" }).where(eq(organizations.id, ctx.organization.id));
  return (await contextFor(ctx.user))!;
}

/** The AI's answer, as the provider hands it back. */
const answer = (json: unknown) =>
  (async () =>
    ({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: JSON.stringify(json) }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 7 } }) as unknown as Anthropic.Beta.BetaMessage);

describe("the plain template format", () => {
  it("reads headings, lists, tables, page breaks and marks", () => {
    const blocks = textBlocks(["# Vertrag", "", "Zwischen **{{company.name}}** und *{{client.name}}*.", "zweite Zeile", "", "- eins", "- zwei", "", "- neu", "1. erstens", "| A | B |", "| --- | --- |", "| 1 | 2 |", "---", "## Ende"].join("\n"));
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "list", "table", "pageBreak", "heading"]);
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: "eins" }], [{ text: "zwei" }]] });
    expect(blocks[4]).toMatchObject({ ordered: true });
    expect((blocks[5] as { rows: unknown[] }).rows).toHaveLength(2);
    expect(inlineRuns("**fett** und *schräg* __unter__ \\*")).toEqual([
      { text: "fett", bold: true },
      { text: " und " },
      { text: "schräg", italic: true },
      { text: " " },
      { text: "unter", underline: true },
      { text: " *" },
    ]);
    expect(placeholdersOf("{{client.name}}, {{ date }}, {{client.name}}")).toEqual(["client.name", "date"]);
  });
});

describe("Word files", () => {
  it("are written and read back: headings, marks, lists, tables, pictures, page breaks", () => {
    const blocks: DocBlock[] = [
      { type: "heading", level: 1, runs: [{ text: "Angebot" }] },
      { type: "paragraph", runs: [{ text: "Fett", bold: true }, { text: " und " }, { text: "schräg", italic: true }, { text: " & <unter>", underline: true }], align: "center" },
      { type: "list", ordered: true, items: [[{ text: "eins" }], [{ text: "zwei" }]] },
      { type: "list", ordered: false, items: [[{ text: "Punkt" }]] },
      { type: "table", rows: [[[{ text: "A" }], [{ text: "B" }]], [[{ text: "1" }], [{ text: "2" }]]] },
      { type: "image", data: PNG, mime: "image/png", width: 120, height: 60 },
      { type: "pageBreak" },
      { type: "paragraph", runs: [{ text: "Привет, Grüße – €" }] },
    ];
    const bytes = writeDocx(blocks, { title: "Angebot" });
    expect([...unzip(bytes).keys()]).toEqual(expect.arrayContaining(["[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/media/image1.png"]));
    const back = readDocx(bytes);
    expect(back.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "table", "image", "pageBreak", "paragraph"]);
    expect(back[1]).toEqual(blocks[1]);
    expect(back[2]).toMatchObject({ ordered: true, items: [[{ text: "eins" }], [{ text: "zwei" }]] });
    expect(back[3]).toMatchObject({ ordered: false });
    expect(back[4]).toEqual(blocks[4]);
    expect(back[5]).toMatchObject({ type: "image", mime: "image/png", width: 120, height: 60 });
    expect(Buffer.from((back[5] as { data: Uint8Array }).data).equals(Buffer.from(PNG))).toBe(true);
    expect(text(back)).toContain("Привет, Grüße – €");
  });

  it("are filled in: placeholders split by Word keep working, those in one run keep their look", () => {
    const document =
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>Hallo {{cli</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>ent.name}}!</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{{date}}</w:t></w:r><w:r><w:t xml:space="preserve"> und {{unbekannt}}</w:t></w:r></w:p>' +
      "</w:body></w:document>";
    const template = zip([{ name: "word/document.xml", data: document }]);
    expect(placeholdersOfDocx(template)).toEqual(["client.name", "date", "unbekannt"]);
    const back = readDocx(fillDocx(template, { "client.name": "Eva & Co <GmbH>", date: "13.11.2026" }));
    expect(back[0]).toEqual({ type: "paragraph", runs: [{ text: "Hallo Eva & Co <GmbH>!" }] });
    expect(back[1]).toEqual({ type: "paragraph", runs: [{ text: "13.11.2026", bold: true }, { text: " und {{unbekannt}}" }] });
  });

  it("refuse what is not a Word file", () => {
    expect(codeOf(() => readDocx(new TextEncoder().encode("kein zip")))).toBe("NOT_DOCX");
    expect(codeOf(() => readDocx(zip([{ name: "word/other.xml", data: "<x/>" }])))).toBe("NOT_DOCX");
  });
});

describe("PDF tools", () => {
  it("lay blocks out on as many pages as they need", async () => {
    const long = Array.from({ length: 80 }, (_, i) => ({ type: "paragraph" as const, runs: [{ text: `Absatz ${i + 1}: ${"Wort ".repeat(30)}` }] }));
    const pdf = await blocksToPdf([{ type: "heading", level: 1, runs: [{ text: "Bericht" }] }, ...long, { type: "pageBreak" }, { type: "table", rows: [[[{ text: "Kopf" }]], [[{ text: "Zelle" }]]] }], { title: "Bericht" });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(doc.getTitle()).toBe("Bericht");
  });

  it("make pictures pages, merge PDFs and take pages out", async () => {
    const two = await imagesToPdf([{ data: PNG, mime: "image/png" }, { data: PNG, mime: "image/png" }]);
    expect(await pages(two)).toBe(2);
    await expect(imagesToPdf([{ data: PNG, mime: "image/gif" }])).rejects.toMatchObject({ code: "IMAGE" });
    const five = await mergePdfs([two, two, await imagesToPdf([{ data: PNG, mime: "image/png" }])]);
    expect(await pages(five)).toBe(5);
    expect(pageList("1-2, 4", 5)).toEqual([0, 1, 3]);
    expect(pageList(" 2 – 3 ", 5)).toEqual([1, 2]);
    expect([pageList("0", 5), pageList("3-1", 5), pageList("6", 5), pageList("x", 5), pageList("", 5)]).toEqual([null, null, null, null, null]);
    expect(await pages(await pickPages(five, "2, 5"))).toBe(2);
    await expect(pickPages(five, "9")).rejects.toMatchObject({ code: "PAGES" });
    await expect(mergePdfs([new TextEncoder().encode("kein pdf")])).rejects.toMatchObject({ code: "NOT_PDF" });
  });
});

describe("documents from templates", () => {
  it("fills a text template for a client and an order, as PDF and as Word, kept next to them", async () => {
    const ctx = await company("Vorlagen GmbH");
    const client = await createClient(ctx, { type: "COMPANY", companyName: "Kunde AG", street: "Weg 1", postalCode: "20095", city: "Hamburg" });
    const order = await createOrder(ctx, { clientId: client.id, title: "Wallbox", items: [{ description: "Montage", quantity: 2, unit: "Stk", unitPriceCents: 10000, discountPercent: 0, vatRate: 19 }] });
    const id = await saveTemplate(ctx, null, { name: "Bestätigung", body: "# Auftrag {{order.number}}\n\nSehr geehrte {{client.name}}, {{client.address}}.\n\nSumme: **{{order.total}}** – {{company.name}}, {{unbekannt}}" });
    expect((await listTemplates(ctx)).map((t) => [t.name, t.fields])).toEqual([["Bestätigung", ["order.number", "client.name", "client.address", "order.total", "company.name", "unbekannt"]]]);

    const pdf = await createFromTemplate(ctx, { templateId: id, orderId: order.id, format: "pdf" });
    expect(pdf).toMatchObject({ mimeType: "application/pdf", clientId: client.id, orderId: order.id, category: "Bestätigung", name: "Bestätigung – Kunde AG.pdf" });
    const word = await createFromTemplate(ctx, { templateId: id, orderId: order.id, format: "docx", name: "Auftrag/Kunde" });
    expect(word).toMatchObject({ mimeType: DOCX, name: "Auftrag Kunde.docx" });
    const written = text(readDocx(new Uint8Array((await readDocument(ctx, word.id)).bytes)));
    expect(written).toContain(`Auftrag #${order.number}`);
    expect(written).toContain("Sehr geehrte Kunde AG, Weg 1, 20095 Hamburg.");
    expect(written).toMatch(/Summe: 238,00\s€ – Vorlagen GmbH, \{\{unbekannt\}\}/);

    // Without a client the client's places stay empty, not as placeholders.
    const plain = await createFromTemplate(ctx, { templateId: id, format: "docx" });
    expect(text(readDocx(new Uint8Array((await readDocument(ctx, plain.id)).bytes)))).toContain("Sehr geehrte , .");
  });

  it("fills the company's own Word file and refuses other files as templates", async () => {
    const ctx = await company("Word GmbH");
    const client = await createClient(ctx, { type: "PERSON", firstName: "Eva", lastName: "Muster" });
    const source = await storeDocument(ctx, { name: "Vertrag.docx", bytes: writeDocx([{ type: "paragraph", runs: [{ text: "Vertrag mit {{client.firstName}} {{client.lastName}}" }] }]) });
    const id = await saveTemplate(ctx, null, { name: "Vertrag", sourceDocumentId: source.id });
    expect((await listTemplates(ctx))[0]).toMatchObject({ sourceName: "Vertrag.docx", fields: ["client.firstName", "client.lastName"] });
    const made = await createFromTemplate(ctx, { templateId: id, clientId: client.id, format: "docx" });
    expect(text(readDocx(new Uint8Array((await readDocument(ctx, made.id)).bytes)))).toBe("Vertrag mit Eva Muster");
    const pdf = await createFromTemplate(ctx, { templateId: id, clientId: client.id, format: "pdf" });
    expect(pdf.mimeType).toBe("application/pdf");

    const notWord = await storeDocument(ctx, { name: "x.pdf", bytes: await blocksToPdf([]) });
    await expect(saveTemplate(ctx, null, { name: "PDF", sourceDocumentId: notWord.id })).rejects.toMatchObject({ code: "TYPE" });
    await expect(saveTemplate(ctx, null, { name: "Leer", body: "   " })).rejects.toMatchObject({ code: "EMPTY" });
    await deleteTemplate(ctx, id);
    expect(await listTemplates(ctx)).toEqual([]);
  });

  it("are made by those who manage documents, and by an automation for a new client", async () => {
    const ctx = await company("Rechte GmbH");
    const id = await saveTemplate(ctx, null, { name: "Willkommen", body: "Willkommen, {{client.name}}!" });
    const viewer = await newMember(ctx, "VIEWER");
    await expect(createFromTemplate(viewer, { templateId: id, format: "pdf" })).rejects.toMatchObject({ permission: "documents.manage" });
    const other = await company("Fremd GmbH");
    await expect(createFromTemplate(other, { templateId: id, format: "pdf" })).rejects.toThrow();

    await saveAutomation(ctx, null, { name: "Begrüßung", trigger: "client.created", action: "document.create", params: { templateId: id, format: "docx" } });
    const client = await createClient(ctx, { type: "COMPANY", companyName: "Neu KG" });
    const runs = await withTenant(ctx.organization.id, (tx) => tx.select().from(automationRuns));
    expect(runs.map((r) => r.ok)).toEqual([true]);
    const docs = await listDocuments(ctx, { clientId: client.id });
    expect(docs.map((d) => d.name)).toEqual(["Willkommen – Neu KG.docx"]);
    expect(text(readDocx(new Uint8Array((await readDocument(ctx, docs[0].id)).bytes)))).toBe("Willkommen, Neu KG!");
  });
});

describe("converting documents", () => {
  it("turns Word, text and pictures into PDF, and PDF into Word through the AI, next to the original", async () => {
    const ctx = await company("Wandel GmbH");
    const client = await createClient(ctx, { type: "COMPANY", companyName: "Bauherr GmbH" });
    const word = await storeDocument(ctx, { name: "Brief.docx", bytes: writeDocx([{ type: "paragraph", runs: [{ text: "Hallo" }] }]) }, { clientId: client.id, category: "Briefe" });
    const pdf = await convertDocument(ctx, word.id, "pdf");
    expect(pdf).toMatchObject({ name: "Brief.pdf", mimeType: "application/pdf", clientId: client.id, category: "Briefe" });

    const note = await storeDocument(ctx, { name: "notiz.txt", bytes: new TextEncoder().encode("Erste Zeile\nzweite\n\nNeuer Absatz mit *Stern*") });
    const fromText = await convertDocument(ctx, note.id, "docx");
    expect(readDocx(new Uint8Array((await readDocument(ctx, fromText.id)).bytes))).toEqual([
      { type: "paragraph", runs: [{ text: "Erste Zeile\nzweite" }] },
      { type: "paragraph", runs: [{ text: "Neuer Absatz mit *Stern*" }] },
    ]);
    const picture = await storeDocument(ctx, { name: "foto.png", bytes: PNG });
    expect((await convertDocument(ctx, picture.id, "pdf")).name).toBe("foto.pdf");
    await expect(convertDocument(ctx, word.id, "docx")).rejects.toMatchObject({ code: "TYPE" });

    const read = answer({
      blocks: [
        { type: "heading", level: 1, text: "Rechnung", ordered: false, items: [], rows: [] },
        { type: "paragraph", level: 0, text: "Betrag **100 €**", ordered: false, items: [], rows: [] },
        { type: "table", level: 0, text: "", ordered: false, items: [], rows: [["Pos", "Preis"], ["1", "100"]] },
      ],
    });
    const back = await convertDocument(ctx, pdf.id, "docx", read);
    expect(back).toMatchObject({ name: "Brief.docx", clientId: client.id });
    const blocks = readDocx(new Uint8Array((await readDocument(ctx, back.id)).bytes));
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "table"]);
    expect(blocks[1]).toEqual({ type: "paragraph", runs: [{ text: "Betrag " }, { text: "100 €", bold: true }] });
    const used = await withTenant(ctx.organization.id, (tx) => tx.select().from(contentGenerations));
    expect(used.map((g) => g.kind)).toEqual(["document"]);
  });

  it("merges PDFs, makes one PDF of pictures and takes pages out", async () => {
    const ctx = await company("Stapel GmbH");
    const a = await storeDocument(ctx, { name: "a.pdf", bytes: await imagesToPdf([{ data: PNG, mime: "image/png" }, { data: PNG, mime: "image/png" }]) });
    const b = await storeDocument(ctx, { name: "b.pdf", bytes: await imagesToPdf([{ data: PNG, mime: "image/png" }]) });
    const merged = await mergePdfDocuments(ctx, [a.id, b.id]);
    expect(merged.name).toBe("a (+1).pdf");
    expect(await pages(new Uint8Array((await readDocument(ctx, merged.id)).bytes))).toBe(3);
    const cut = await extractPages(ctx, merged.id, "1, 3");
    expect(cut.name).toBe("a (+1) – 1,3.pdf");
    expect(await pages(new Uint8Array((await readDocument(ctx, cut.id)).bytes))).toBe(2);
    await expect(extractPages(ctx, merged.id, "4")).rejects.toMatchObject({ code: "PAGES" });
    await expect(mergePdfDocuments(ctx, [a.id])).rejects.toMatchObject({ code: "EMPTY" });

    const p1 = await storeDocument(ctx, { name: "eins.png", bytes: PNG });
    const p2 = await storeDocument(ctx, { name: "zwei.png", bytes: PNG });
    const album = await imagesToPdfDocument(ctx, [p1.id, p2.id]);
    expect(await pages(new Uint8Array((await readDocument(ctx, album.id)).bytes))).toBe(2);
    await expect(imagesToPdfDocument(ctx, [p1.id, a.id])).rejects.toMatchObject({ code: "TYPE" });
  });

  it("drafts a template with the AI, in the company's language", async () => {
    const ctx = await company("Entwurf GmbH");
    let system = "";
    const draft = await draftTemplate(ctx, "Mahnung für eine offene Rechnung", async (params) => {
      system = String(params.system);
      return answer({ name: "Mahnung", body: "# Mahnung\n\nSehr geehrte {{client.name}}," })();
    });
    expect(draft).toEqual({ name: "Mahnung", body: "# Mahnung\n\nSehr geehrte {{client.name}}," });
    expect(system).toContain("German");
    expect(system).toContain("{{client.name}}");
  });
});
