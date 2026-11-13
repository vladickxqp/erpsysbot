/**
 * Documents as blocks, the same for the app and the server: Word files are
 * read into them and written from them, PDFs are drawn from them, and a
 * text template is a short plain text that becomes them:
 *
 *   # Heading   ## Smaller   ### Smallest
 *   - a bullet   1. a numbered entry
 *   | a | table | row |
 *   ---  (alone on a line) a new page
 *   **bold**   *italic*   __underlined__   \* a star itself
 *
 * Placeholders such as {{client.name}} are filled in before a template
 * becomes a document; unknown ones stay as they are, so they show.
 */

export type Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean };
export type Align = "left" | "center" | "right" | "justify";
export type DocBlock =
  | { type: "heading"; level: 1 | 2 | 3; runs: Run[] }
  | { type: "paragraph"; runs: Run[]; align?: Align }
  | { type: "list"; ordered: boolean; items: Run[][] }
  | { type: "table"; rows: Run[][][] }
  | { type: "image"; data: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number }
  | { type: "pageBreak" };

/** What a template may ask for, by where the value comes from. */
export const PLACEHOLDER_GROUPS = {
  general: ["date", "user.name"],
  company: ["company.name", "company.address", "company.email", "company.phone", "company.vatId", "company.iban"],
  client: ["client.name", "client.firstName", "client.lastName", "client.company", "client.address", "client.email", "client.phone", "client.number"],
  order: ["order.number", "order.title", "order.date", "order.total"],
} as const;
export type PlaceholderKey = (typeof PLACEHOLDER_GROUPS)[keyof typeof PLACEHOLDER_GROUPS][number];
export const PLACEHOLDER_KEYS: readonly PlaceholderKey[] = Object.values(PLACEHOLDER_GROUPS).flat();

/** {{client.name}}, {{ date }}. */
export const PLACEHOLDER = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;

/** The text with its placeholders filled in; those without a value stay as they are. */
export const fillPlaceholders = (text: string, values: Record<string, string>) => text.replace(PLACEHOLDER, (m, key: string) => values[key] ?? m);

/** The placeholders a text uses, in order, each once. */
export const placeholdersOf = (text: string): string[] => [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];

/** The marks inside a line: **bold**, *italic*, __underlined__; a backslash keeps the next character as it is. */
export function inlineRuns(text: string): Run[] {
  const runs: Run[] = [];
  const state = { bold: false, italic: false, underline: false };
  let buffer = "";
  const flush = () => {
    if (buffer) runs.push({ text: buffer, ...(state.bold ? { bold: true } : {}), ...(state.italic ? { italic: true } : {}), ...(state.underline ? { underline: true } : {}) });
    buffer = "";
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) {
      buffer += text[++i];
    } else if (text.startsWith("**", i)) {
      flush();
      state.bold = !state.bold;
      i++;
    } else if (text.startsWith("__", i)) {
      flush();
      state.underline = !state.underline;
      i++;
    } else if (text[i] === "*") {
      flush();
      state.italic = !state.italic;
    } else buffer += text[i];
  }
  flush();
  return runs;
}

/** A text template as blocks (see the top of this file). */
export function textBlocks(source: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  let paragraph: string[] = [];
  // What the line before was: a list or a table continues only on the very next line.
  let open: "list" | "table" | null = null;
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", runs: inlineRuns(paragraph.join("\n")) });
    paragraph = [];
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const last = blocks[blocks.length - 1];
    if (!line.trim()) {
      endParagraph();
      open = null;
      continue;
    }
    if (/^\s*-{3,}\s*$/.test(line)) {
      endParagraph();
      blocks.push({ type: "pageBreak" });
      open = null;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      endParagraph();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, runs: inlineRuns(heading[2]) });
      open = null;
      continue;
    }
    const item = /^\s*(?:([-•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      endParagraph();
      const ordered = !item[1];
      const runs = inlineRuns(item[3]);
      if (open === "list" && last?.type === "list" && last.ordered === ordered) last.items.push(runs);
      else blocks.push({ type: "list", ordered, items: [runs] });
      open = "list";
      continue;
    }
    const row = /^\s*\|(.*)\|\s*$/.exec(line);
    if (row) {
      endParagraph();
      const cells = row[1].split("|").map((c) => c.trim());
      // The line under a header ("|---|:--:|") only marks it as one.
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      const runs = cells.map(inlineRuns);
      if (open === "table" && last?.type === "table") last.rows.push(runs);
      else blocks.push({ type: "table", rows: [runs] });
      open = "table";
      continue;
    }
    open = null;
    paragraph.push(line);
  }
  endParagraph();
  return blocks;
}

/** The plain words of blocks, for a title or a search. */
export function blocksText(blocks: DocBlock[]): string {
  const runs = (r: { text: string }[]) => r.map((x) => x.text).join("");
  return blocks
    .map((b) =>
      b.type === "heading" || b.type === "paragraph"
        ? runs(b.runs)
        : b.type === "list"
          ? b.items.map(runs).join("\n")
          : b.type === "table"
            ? b.rows.map((r) => r.map(runs).join(" | ")).join("\n")
            : "",
    )
    .filter(Boolean)
    .join("\n\n");
}
