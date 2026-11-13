/**
 * PDFs made from documents and PDFs taken apart, with pdf-lib:
 *
 * - blocks (from a Word file or a text template) laid out on A4 pages in
 *   DejaVu Sans, which covers umlauts, € and Cyrillic: headings, wrapped
 *   and aligned paragraphs with bold, slanted and underlined words, lists,
 *   tables, pictures, page breaks;
 * - pictures (PNG, JPEG) as pages of their own;
 * - several PDFs as one, and chosen pages of a PDF as a PDF of their own.
 *
 * Encrypted PDFs are refused rather than opened.
 */
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Align, DocBlock, Run } from "@/lib/doc-text";
import { loadFonts } from "./pdf";

export class PdfToolError extends Error {
  constructor(public readonly code: "ENCRYPTED" | "NOT_PDF" | "PAGES" | "IMAGE") {
    super(code);
  }
}

const MM = 72 / 25.4;
const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { left: 25 * MM, right: 20 * MM, top: 20 * MM, bottom: 20 * MM };
const INK = rgb(0.07, 0.09, 0.15);
const RULE = rgb(0.74, 0.77, 0.81);
const SHADE = rgb(0.95, 0.96, 0.97);
const CONTENT = A4.width - MARGIN.left - MARGIN.right;

type Fonts = { regular: PDFFont; bold: PDFFont };
type Word = { text: string; run: Run; font: PDFFont; width: number; space: number };
type Line = Word[];

class Sheet {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = A4.height - MARGIN.top;
  }
  /** A new page unless `height` still fits on this one. */
  need(height: number) {
    if (this.y - height < MARGIN.bottom) this.newPage();
  }
  get atTop() {
    return this.y >= A4.height - MARGIN.top - 0.5;
  }
}

function width(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

/** The words of runs with their widths; a line break inside a run is its own mark. */
function wordsOf(runs: Run[], fonts: Fonts, size: number): (Word | "\n")[] {
  const out: (Word | "\n")[] = [];
  for (const run of runs) {
    const font = run.bold ? fonts.bold : fonts.regular;
    const text = run.text.replace(/\t/g, "    ").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "");
    for (const piece of text.split(/(\n| +)/)) {
      if (piece === "\n") out.push("\n");
      else if (/^ +$/.test(piece)) {
        const last = out[out.length - 1];
        if (last && last !== "\n") last.space += width(font, piece, size);
      } else if (piece) out.push({ text: piece, run, font, width: width(font, piece, size), space: 0 });
    }
  }
  return out;
}

/** A word wider than the line, cut into pieces that fit. */
function fit(word: Word, max: number, size: number): Word[] {
  if (word.width <= max) return [word];
  const pieces: Word[] = [];
  let current = "";
  for (const ch of word.text) {
    if (current && width(word.font, current + ch, size) > max) {
      pieces.push({ ...word, text: current, width: width(word.font, current, size), space: 0 });
      current = "";
    }
    current += ch;
  }
  pieces.push({ ...word, text: current, width: width(word.font, current, size) });
  return pieces;
}

/** The runs broken into lines no wider than `max`. */
function linesOf(runs: Run[], fonts: Fonts, size: number, max: number): Line[] {
  const lines: Line[] = [[]];
  let used = 0;
  for (const item of wordsOf(runs, fonts, size)) {
    if (item === "\n") {
      lines.push([]);
      used = 0;
      continue;
    }
    for (const piece of fit(item, max, size)) {
      const line = lines[lines.length - 1];
      const before = line.length ? line[line.length - 1].space : 0;
      if (line.length && used + before + piece.width > max) {
        lines.push([piece]);
        used = piece.width;
      } else {
        line.push(piece);
        used += before + piece.width;
      }
    }
  }
  return lines;
}

const lineHeight = (size: number) => size * 1.4;

/** Writes runs from the current height down, wrapped to `max` and aligned; pages follow as needed unless `fixed`. */
function write(sheet: Sheet, runs: Run[], o: { size: number; x?: number; max?: number; align?: Align; fixed?: boolean }) {
  const x0 = o.x ?? MARGIN.left;
  const max = o.max ?? CONTENT;
  const lines = linesOf(runs, sheet.fonts, o.size, max);
  lines.forEach((line, n) => {
    if (!o.fixed) sheet.need(lineHeight(o.size));
    const baseline = sheet.y - o.size;
    const natural = line.reduce((sum, w, i) => sum + w.width + (i < line.length - 1 ? w.space : 0), 0);
    const last = n === lines.length - 1;
    const gaps = line.slice(0, -1).filter((w) => w.space > 0).length;
    let x = x0;
    let extra = 0;
    if (o.align === "center") x += (max - natural) / 2;
    else if (o.align === "right") x += max - natural;
    else if (o.align === "justify" && !last && gaps) extra = (max - natural) / gaps;
    line.forEach((w, i) => {
      sheet.page.drawText(w.text, { x, y: baseline, size: o.size, font: w.font, color: INK, ...(w.run.italic ? { xSkew: degrees(12) } : {}) });
      if (w.run.underline) sheet.page.drawLine({ start: { x, y: baseline - 1.6 }, end: { x: x + w.width + (i < line.length - 1 && line[i + 1].run.underline ? w.space : 0), y: baseline - 1.6 }, thickness: 0.6, color: INK });
      x += w.width + (i < line.length - 1 ? w.space + (w.space > 0 ? extra : 0) : 0);
    });
    sheet.y -= lineHeight(o.size);
  });
}

function drawTable(sheet: Sheet, rows: Run[][][]) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const cell = CONTENT / cols;
  const pad = 4;
  const size = 10;
  const header = rows.length > 1;
  rows.forEach((row, r) => {
    const cells = Array.from({ length: cols }, (_, c) => (header && r === 0 ? (row[c] ?? []).map((run) => ({ ...run, bold: true })) : (row[c] ?? [])));
    const height = Math.max(...cells.map((runs) => linesOf(runs, sheet.fonts, size, cell - 2 * pad).length)) * lineHeight(size) + 2 * pad;
    sheet.need(Math.min(height, A4.height - MARGIN.top - MARGIN.bottom));
    const top = sheet.y;
    cells.forEach((runs, c) => {
      const x = MARGIN.left + c * cell;
      sheet.page.drawRectangle({ x, y: top - height, width: cell, height, borderColor: RULE, borderWidth: 0.6, ...(header && r === 0 ? { color: SHADE } : {}) });
      sheet.y = top - pad;
      write(sheet, runs, { size, x: x + pad, max: cell - 2 * pad, fixed: true });
    });
    sheet.y = top - height;
  });
}

async function drawImage(sheet: Sheet, block: Extract<DocBlock, { type: "image" }>) {
  let image;
  try {
    image = block.mime === "image/png" ? await sheet.doc.embedPng(block.data) : await sheet.doc.embedJpg(block.data);
  } catch {
    return;
  }
  const room = (A4.height - MARGIN.top - MARGIN.bottom) * 0.75;
  const scale = Math.min(1, CONTENT / Math.max(1, block.width), room / Math.max(1, block.height));
  const w = block.width * scale;
  const h = block.height * scale;
  sheet.need(h);
  sheet.page.drawImage(image, { x: MARGIN.left, y: sheet.y - h, width: w, height: h });
  sheet.y -= h;
}

async function newDocument(title?: string): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold] = await loadFonts();
  if (title) doc.setTitle(title);
  doc.setCreator("NEXORA ONE");
  doc.setProducer("NEXORA ONE");
  return { doc, fonts: { regular: await doc.embedFont(regular, { subset: true }), bold: await doc.embedFont(bold, { subset: true }) } };
}

/** A PDF of these blocks on A4 pages. */
export async function blocksToPdf(blocks: DocBlock[], meta: { title?: string } = {}): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument(meta.title);
  const sheet = new Sheet(doc, fonts);
  for (const b of blocks) {
    if (b.type === "heading") {
      const size = b.level === 1 ? 20 : b.level === 2 ? 15.5 : 12.5;
      if (!sheet.atTop) sheet.y -= b.level === 1 ? 12 : 9;
      // A heading stays with the first line after it.
      sheet.need(lineHeight(size) + lineHeight(11));
      write(sheet, b.runs.map((r) => ({ ...r, bold: true })), { size });
      sheet.y -= 3;
    } else if (b.type === "paragraph") {
      write(sheet, b.runs, { size: 11, align: b.align });
      sheet.y -= 6;
    } else if (b.type === "list") {
      b.items.forEach((item, i) => {
        sheet.need(lineHeight(11));
        sheet.page.drawText(b.ordered ? `${i + 1}.` : "•", { x: MARGIN.left + 4, y: sheet.y - 11, size: 11, font: fonts.regular, color: INK });
        write(sheet, item, { size: 11, x: MARGIN.left + 22, max: CONTENT - 22 });
        sheet.y -= 2;
      });
      sheet.y -= 6;
    } else if (b.type === "table") {
      if (b.rows.length) drawTable(sheet, b.rows);
      sheet.y -= 10;
    } else if (b.type === "image") {
      await drawImage(sheet, b);
      sheet.y -= 8;
    } else if (!sheet.atTop) sheet.newPage();
  }
  return doc.save();
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    throw new PdfToolError(e instanceof Error && /encrypt/i.test(e.name + e.message) ? "ENCRYPTED" : "NOT_PDF");
  }
}

/** Each picture on an A4 page of its own, upright or across as the picture is, with a margin. */
export async function imagesToPdf(images: { data: Uint8Array; mime: string }[], meta: { title?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (meta.title) doc.setTitle(meta.title);
  doc.setCreator("NEXORA ONE");
  for (const img of images) {
    let embedded;
    try {
      embedded = img.mime === "image/png" ? await doc.embedPng(img.data) : img.mime === "image/jpeg" ? await doc.embedJpg(img.data) : null;
    } catch {
      embedded = null;
    }
    if (!embedded) throw new PdfToolError("IMAGE");
    const across = embedded.width > embedded.height;
    const [pw, ph] = across ? [A4.height, A4.width] : [A4.width, A4.height];
    const page = doc.addPage([pw, ph]);
    const margin = 10 * MM;
    const scale = Math.min((pw - 2 * margin) / embedded.width, (ph - 2 * margin) / embedded.height, 2);
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return doc.save();
}

/** Several PDFs as one, in this order. */
export async function mergePdfs(pdfs: Uint8Array[], meta: { title?: string } = {}): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  if (meta.title) out.setTitle(meta.title);
  out.setCreator("NEXORA ONE");
  for (const bytes of pdfs) {
    const source = await loadPdf(bytes);
    for (const page of await out.copyPages(source, source.getPageIndices())) out.addPage(page);
  }
  return out.save();
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await loadPdf(bytes)).getPageCount();
}

/** "1-3, 5" as the indices (from 0) of pages a document of `count` pages has; null when it names none, or pages it does not have. */
export function pageList(spec: string, count: number): number[] | null {
  const out: number[] = [];
  for (const part of spec.replace(/\s*[-–]\s*/g, "-").split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const from = Number(m[1]);
    const to = Number(m[2] ?? m[1]);
    if (from < 1 || to < from || to > count) return null;
    for (let p = from; p <= to; p++) out.push(p - 1);
    if (out.length > 5000) return null;
  }
  return out.length ? out : null;
}

/** The chosen pages of a PDF (`spec` as in pageList) as a PDF of their own. */
export async function pickPages(bytes: Uint8Array, spec: string, meta: { title?: string } = {}): Promise<Uint8Array> {
  const source = await loadPdf(bytes);
  const pages = pageList(spec, source.getPageCount());
  if (!pages) throw new PdfToolError("PAGES");
  const out = await PDFDocument.create();
  if (meta.title) out.setTitle(meta.title);
  out.setCreator("NEXORA ONE");
  for (const page of await out.copyPages(source, pages)) out.addPage(page);
  return out.save();
}
