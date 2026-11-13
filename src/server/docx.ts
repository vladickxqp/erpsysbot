/**
 * Word files without a library. A DOCX is a ZIP of XML parts:
 *
 * - reading takes the main document apart into blocks (headings, paragraphs
 *   with bold, italic and underlined runs, lists, tables, pictures, page
 *   breaks), enough to show it or turn it into a PDF;
 * - writing builds a small, valid DOCX from such blocks;
 * - filling replaces {{placeholders}} in a company's own Word template, also
 *   where Word split one across several runs (that paragraph then takes the
 *   look of its first run).
 *
 * The ZIP part reads stored and deflated entries (node:zlib) and refuses
 * encrypted files and anything unpacking to more than MAX_UNPACKED, so a
 * crafted file cannot fill the memory.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { fillPlaceholders, PLACEHOLDER, type DocBlock, type Run } from "@/lib/doc-text";
import { crc32 } from "./zip";

export class DocxError extends Error {
  constructor(public readonly code: "NOT_DOCX" | "TOO_LARGE" | "ENCRYPTED") {
    super(code);
  }
}

const MAX_UNPACKED = 80 * 1024 * 1024;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

// --- ZIP ---------------------------------------------------------------------------------------

/** The files of a ZIP archive by name. */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new DocxError("NOT_DOCX");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new DocxError("NOT_DOCX");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const packedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (flags & 1) throw new DocxError("ENCRYPTED");
    if (name.endsWith("/")) continue;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new DocxError("NOT_DOCX");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const packed = bytes.subarray(start, start + packedSize);
    let data: Uint8Array;
    if (method === 0) data = packed;
    else if (method === 8) {
      try {
        data = new Uint8Array(inflateRawSync(packed, { maxOutputLength: MAX_UNPACKED - total + 1 }));
      } catch {
        throw new DocxError(total > 0 ? "TOO_LARGE" : "NOT_DOCX");
      }
    } else throw new DocxError("NOT_DOCX");
    total += data.length;
    if (total > MAX_UNPACKED) throw new DocxError("TOO_LARGE");
    files.set(name, data);
  }
  return files;
}

/** A ZIP archive of these files, deflated. */
export function zip(entries: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const packed = new Uint8Array(deflateRawSync(raw));
    const crc = crc32(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 8, true); // deflate
    local.setUint16(12, 0x21, true); // 1980-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, packed);
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(10, 8, true);
    header.setUint16(14, 0x21, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, packed.length, true);
    header.setUint32(24, raw.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), name);
    offset += 30 + name.length + packed.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// --- XML ---------------------------------------------------------------------------------------

type XmlNode = { name: string; attrs: Record<string, string>; children: (XmlNode | string)[] };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? m;
  });
export const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** A small, forgiving XML parser: elements, attributes and text; no namespaces resolved, no DTD. */
function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  for (const m of xml.matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[3]) {
      if (m[2] === "/") {
        // Close up to the matching element; a stray end tag is ignored.
        const at = stack.map((n) => n.name).lastIndexOf(m[3]);
        if (at > 0) stack.length = at;
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(ATTR)) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? "");
      const node: XmlNode = { name: m[3], attrs, children: [] };
      top.children.push(node);
      if (m[5] !== "/") stack.push(node);
    } else if (m[6] !== undefined) top.children.push(decodeEntities(m[6]));
  }
  return root;
}

const elements = (n: XmlNode) => n.children.filter((c): c is XmlNode => typeof c !== "string");
const child = (n: XmlNode | undefined, name: string) => (n ? elements(n).find((c) => c.name === name) : undefined);
function descendants(n: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of elements(n)) {
    if (c.name === name) out.push(c);
    else descendants(c, name, out);
  }
  return out;
}
const textOf = (n: XmlNode): string => n.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
/** On/off properties such as w:b: present means on, unless its value says off. */
const on = (n: XmlNode | undefined) => !!n && !["0", "false", "off", "none"].includes((n.attrs["w:val"] ?? "").toLowerCase());

// --- Reading -----------------------------------------------------------------------------------

type Reading = {
  files: Map<string, Uint8Array>;
  rels: Map<string, string>;
  ordered: Map<string, boolean>;
  levels: Map<string, 1 | 2 | 3>;
};

/** Relationship ids of the document to the files they point at. */
function relationships(xml: Uint8Array | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const r of descendants(parseXml(decoder.decode(xml)), "Relationship")) {
    const target = r.attrs.Target ?? "";
    if (r.attrs.Id && r.attrs.TargetMode !== "External") map.set(r.attrs.Id, target.startsWith("/") ? target.slice(1) : `word/${target}`);
  }
  return map;
}

/** Which numbered lists count (1., 2.) rather than show bullets. */
function numbering(xml: Uint8Array | undefined): Map<string, boolean> {
  const map = new Map<string, boolean>();
  if (!xml) return map;
  const root = parseXml(decoder.decode(xml));
  const abstract = new Map<string, boolean>();
  for (const a of descendants(root, "w:abstractNum")) {
    const first = elements(a).find((l) => l.name === "w:lvl" && (l.attrs["w:ilvl"] ?? "0") === "0");
    const format = child(first, "w:numFmt")?.attrs["w:val"] ?? "bullet";
    abstract.set(a.attrs["w:abstractNumId"] ?? "", format !== "bullet" && format !== "none");
  }
  for (const n of descendants(root, "w:num")) map.set(n.attrs["w:numId"] ?? "", abstract.get(child(n, "w:abstractNumId")?.attrs["w:val"] ?? "") ?? false);
  return map;
}

/** Paragraph styles that are headings, by their id ("Heading1", "berschrift1", "Title"). */
function headingStyles(xml: Uint8Array | undefined): Map<string, 1 | 2 | 3> {
  const map = new Map<string, 1 | 2 | 3>([["Title", 1], ["Heading1", 1], ["Heading2", 2], ["Heading3", 3]]);
  if (!xml) return map;
  for (const s of descendants(parseXml(decoder.decode(xml)), "w:style")) {
    const id = s.attrs["w:styleId"];
    const name = (child(s, "w:name")?.attrs["w:val"] ?? "").toLowerCase();
    const level = name === "title" ? 1 : /^heading (\d)$/.exec(name)?.[1];
    if (id && level) map.set(id, Math.min(3, Number(level)) as 1 | 2 | 3);
  }
  return map;
}

function imageOf(drawing: XmlNode, r: Reading): DocBlock | null {
  const blip = descendants(drawing, "a:blip")[0];
  const target = r.rels.get(blip?.attrs["r:embed"] ?? "");
  const data = target ? r.files.get(target) : undefined;
  if (!data) return null;
  const mime = data[0] === 0x89 && data[1] === 0x50 ? "image/png" : data[0] === 0xff && data[1] === 0xd8 ? "image/jpeg" : null;
  if (!mime) return null;
  const extent = descendants(drawing, "wp:extent")[0];
  const emu = (v: string | undefined, fallback: number) => (v && Number(v) > 0 ? Number(v) / 12700 : fallback);
  return { type: "image", data, mime, width: emu(extent?.attrs.cx, 300), height: emu(extent?.attrs.cy, 200) };
}

/** The runs of a paragraph (or a part of it), with pictures and page breaks found on the way. */
function collectRuns(n: XmlNode, r: Reading, out: { runs: Run[]; after: DocBlock[]; breakAt: number[] }) {
  for (const c of elements(n)) {
    if (c.name === "w:r") {
      const props = child(c, "w:rPr");
      const style = { bold: on(child(props, "w:b")), italic: on(child(props, "w:i")), underline: on(child(props, "w:u")) };
      for (const part of elements(c)) {
        if (part.name === "w:t") out.runs.push({ text: textOf(part), ...style });
        else if (part.name === "w:tab") out.runs.push({ text: "\t", ...style });
        else if (part.name === "w:br" || part.name === "w:cr") {
          if (part.attrs["w:type"] === "page") out.breakAt.push(out.runs.length);
          else out.runs.push({ text: "\n", ...style });
        } else if (part.name === "w:drawing" || part.name === "w:pict") {
          const image = imageOf(part, r);
          if (image) out.after.push(image);
        }
      }
    } else if (c.name === "w:del" || c.name === "w:pPr" || c.name === "w:rPr" || c.name === "mc:Fallback") {
      // Deleted text of tracked changes, properties and the second copy Word keeps for old readers carry nothing new.
    } else collectRuns(c.name === "w:sdt" ? (child(c, "w:sdtContent") ?? c) : c, r, out);
  }
}

/** Neighbouring runs of the same look as one; formatting flags only where they are on. */
function tidyRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const prev = out[out.length - 1];
    if (prev && !!prev.bold === !!run.bold && !!prev.italic === !!run.italic && !!prev.underline === !!run.underline) prev.text += run.text;
    else out.push({ text: run.text, ...(run.bold ? { bold: true } : {}), ...(run.italic ? { italic: true } : {}), ...(run.underline ? { underline: true } : {}) });
  }
  return out;
}

function readParagraph(p: XmlNode, r: Reading, blocks: DocBlock[]) {
  const props = child(p, "w:pPr");
  const styleId = child(props, "w:pStyle")?.attrs["w:val"] ?? "";
  const level = r.levels.get(styleId) ?? (/^(?:heading|berschrift|überschrift)\s*(\d)$/i.exec(styleId) ? (Math.min(3, Number(/(\d)$/.exec(styleId)![1])) as 1 | 2 | 3) : undefined);
  const numId = child(child(props, "w:numPr"), "w:numId")?.attrs["w:val"];
  const jc = child(props, "w:jc")?.attrs["w:val"];
  const align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" ? "justify" : undefined;
  const found = { runs: [] as Run[], after: [] as DocBlock[], breakAt: [] as number[] };
  collectRuns(p, r, found);
  // A page break inside the paragraph ends the page there.
  const pieces: Run[][] = [];
  let from = 0;
  for (const at of found.breakAt) {
    pieces.push(found.runs.slice(from, at));
    from = at;
  }
  pieces.push(found.runs.slice(from));
  pieces.forEach((piece, i) => {
    if (i > 0) blocks.push({ type: "pageBreak" });
    const runs = tidyRuns(piece);
    // A paragraph that only holds a picture or a page break is no empty line of its own.
    if (!runs.length && (i > 0 || found.after.length || found.breakAt.length)) return;
    if (numId && numId !== "0" && r.ordered.has(numId) && runs.length) {
      const ordered = r.ordered.get(numId) ?? false;
      const last = blocks[blocks.length - 1];
      if (last?.type === "list" && last.ordered === ordered) last.items.push(runs);
      else blocks.push({ type: "list", ordered, items: [runs] });
    } else if (level && runs.length) blocks.push({ type: "heading", level, runs });
    else blocks.push({ type: "paragraph", runs, ...(align ? { align } : {}) });
  });
  blocks.push(...found.after);
}

function readTable(tbl: XmlNode, r: Reading): DocBlock {
  const rows = elements(tbl)
    .filter((tr) => tr.name === "w:tr")
    .map((tr) =>
      elements(tr)
        .filter((tc) => tc.name === "w:tc")
        .map((tc) => {
          const runs: Run[] = [];
          for (const p of descendants(tc, "w:p")) {
            const found = { runs: [] as Run[], after: [] as DocBlock[], breakAt: [] as number[] };
            collectRuns(p, r, found);
            if (runs.length) runs.push({ text: "\n" });
            runs.push(...found.runs);
          }
          return tidyRuns(runs);
        }),
    )
    .filter((row) => row.length);
  return { type: "table", rows };
}

function readBody(n: XmlNode, r: Reading, blocks: DocBlock[]) {
  for (const c of elements(n)) {
    if (c.name === "w:p") readParagraph(c, r, blocks);
    else if (c.name === "w:tbl") blocks.push(readTable(c, r));
    else if (c.name === "w:sdt") readBody(child(c, "w:sdtContent") ?? c, r, blocks);
  }
}

/** The content of a Word file as blocks. */
export function readDocx(bytes: Uint8Array): DocBlock[] {
  const files = unzip(bytes);
  const main = files.get("word/document.xml");
  if (!main) throw new DocxError("NOT_DOCX");
  const r: Reading = {
    files,
    rels: relationships(files.get("word/_rels/document.xml.rels")),
    ordered: numbering(files.get("word/numbering.xml")),
    levels: headingStyles(files.get("word/styles.xml")),
  };
  const body = descendants(parseXml(decoder.decode(main)), "w:body")[0];
  if (!body) throw new DocxError("NOT_DOCX");
  const blocks: DocBlock[] = [];
  readBody(body, r, blocks);
  // Empty paragraphs at the end are only the page's tail.
  while (blocks.length && blocks[blocks.length - 1].type === "paragraph" && !(blocks[blocks.length - 1] as { runs: Run[] }).runs.length) blocks.pop();
  return blocks;
}

// --- Writing -----------------------------------------------------------------------------------

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** The width the page leaves for content: A4 less 2.5 cm on each side, in twentieths of a point. */
const CONTENT_TWIPS = 11906 - 2 * 1417;

// Control characters other than tab and line breaks are not allowed in XML.
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "");

function runXml(run: Run): string {
  const props = `${run.bold ? "<w:b/><w:bCs/>" : ""}${run.italic ? "<w:i/><w:iCs/>" : ""}${run.underline ? '<w:u w:val="single"/>' : ""}`;
  const body = clean(run.text)
    .split(/(\n|\t)/)
    .map((part) => (part === "\n" ? "<w:br/>" : part === "\t" ? "<w:tab/>" : part ? `<w:t xml:space="preserve">${escapeXml(part)}</w:t>` : ""))
    .join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${body}</w:r>`;
}

const runsXml = (runs: Run[]) => runs.map(runXml).join("");

function paragraphXml(runs: Run[], props = ""): string {
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runsXml(runs)}</w:p>`;
}

type Media = { id: string; name: string; data: Uint8Array };

function imageXml(block: Extract<DocBlock, { type: "image" }>, media: Media[]): string {
  const n = media.length + 1;
  const id = `rIdImg${n}`;
  media.push({ id, name: `image${n}.${block.mime === "image/png" ? "png" : "jpg"}`, data: block.data });
  const maxWidth = CONTENT_TWIPS / 20;
  const scale = Math.min(1, maxWidth / Math.max(1, block.width));
  const cx = Math.round(block.width * scale * 12700);
  const cy = Math.round(block.height * scale * 12700);
  return (
    `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Bild ${n}"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="Bild ${n}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
}

function tableXml(rows: Run[][][]): string {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const width = Math.floor(CONTENT_TWIPS / cols);
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
  const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join("");
  const body = rows
    .map((row) => {
      const cells = Array.from({ length: cols }, (_, i) => row[i] ?? []);
      return `<w:tr>${cells.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraphXml(cell)}</w:tc>`).join("")}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${width * cols}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

const STYLES_XML =
  XML_HEAD +
  `<w:styles ${NS}>` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
  "</w:styles>";

function numberingXml(lists: boolean[]): string {
  const level = (ordered: boolean) =>
    ordered
      ? '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>'
      : '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>';
  const abstract = `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${level(false)}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${level(true)}</w:abstractNum>`;
  // Each list its own number, so a numbered list starts again at 1.
  const nums = lists
    .map((ordered, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${ordered ? 1 : 0}"/>${ordered ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ""}</w:num>`)
    .join("");
  return `${XML_HEAD}<w:numbering ${NS}>${abstract}${nums}</w:numbering>`;
}

/** A Word file of these blocks (A4, 2.5 cm margins), with its title in the file's properties. */
export function writeDocx(blocks: DocBlock[], meta: { title?: string } = {}): Uint8Array {
  const media: Media[] = [];
  const lists: boolean[] = [];
  const body = blocks
    .map((b, i) => {
      switch (b.type) {
        case "heading":
          return paragraphXml(b.runs, `<w:pStyle w:val="Heading${b.level}"/>`);
        case "paragraph":
          return paragraphXml(b.runs, b.align && b.align !== "left" ? `<w:jc w:val="${b.align === "justify" ? "both" : b.align}"/>` : "");
        case "list": {
          lists.push(b.ordered);
          const id = lists.length;
          return b.items.map((item) => paragraphXml(item, `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`)).join("");
        }
        case "table":
          // Word wants a paragraph between two tables and after the last block.
          return b.rows.length ? tableXml(b.rows) + (i === blocks.length - 1 || blocks[i + 1].type === "table" ? "<w:p/>" : "") : "";
        case "image":
          return imageXml(b, media);
        case "pageBreak":
          return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      }
    })
    .join("");
  const section = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  const documentXml = `${XML_HEAD}<w:document ${NS}><w:body>${body || "<w:p/>"}${section}</w:body></w:document>`;
  const rels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    media.map((m) => `<Relationship Id="${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join("") +
    "</Relationships>";
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const core =
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${escapeXml(clean(meta.title ?? ""))}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const types =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    "</Types>";
  const rootRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    "</Relationships>";
  return zip([
    { name: "[Content_Types].xml", data: types },
    { name: "_rels/.rels", data: rootRels },
    { name: "word/document.xml", data: documentXml },
    { name: "word/styles.xml", data: STYLES_XML },
    { name: "word/numbering.xml", data: numberingXml(lists) },
    { name: "word/_rels/document.xml.rels", data: rels },
    { name: "docProps/core.xml", data: core },
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
  ]);
}

// --- Filling -----------------------------------------------------------------------------------

const PARAGRAPH = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const TEXT = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g;
const parts = (name: string) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name);

function fillParagraph(xml: string, values: Record<string, string>): string {
  const texts = [...xml.matchAll(TEXT)].map((m) => decodeEntities(m[2]));
  const joined = texts.join("");
  if (!joined.includes("{{")) return xml;
  const filled = fillPlaceholders(joined, values);
  const each = texts.map((t) => fillPlaceholders(t, values));
  // Every placeholder inside one run: each keeps its look. Split across runs: the first takes the whole text.
  const replacement = each.join("") === filled ? each : [filled, ...texts.slice(1).map(() => "")];
  let i = 0;
  return xml.replace(TEXT, () => `<w:t xml:space="preserve">${escapeXml(replacement[i++] ?? "")}</w:t>`);
}

/** The company's own Word template with its placeholders filled in; unknown ones stay as they are. */
export function fillDocx(bytes: Uint8Array, values: Record<string, string>): Uint8Array {
  const files = unzip(bytes);
  if (!files.has("word/document.xml")) throw new DocxError("NOT_DOCX");
  return zip(
    [...files].map(([name, data]) => ({
      name,
      data: parts(name) ? decoder.decode(data).replace(PARAGRAPH, (p) => fillParagraph(p, values)) : data,
    })),
  );
}

/** The placeholders a Word template uses, in order, each once. */
export function placeholdersOfDocx(bytes: Uint8Array): string[] {
  const keys = new Set<string>();
  for (const [name, data] of unzip(bytes)) {
    if (!parts(name)) continue;
    for (const p of decoder.decode(data).matchAll(PARAGRAPH)) {
      const text = [...p[0].matchAll(TEXT)].map((m) => decodeEntities(m[2])).join("");
      for (const m of text.matchAll(PLACEHOLDER)) keys.add(m[1]);
    }
  }
  return [...keys];
}
