import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Bold, inline code, and links into the app (only the /app/... part, whatever host stands before it). */
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|(?:https?:\/\/[^\s)]+?)?\/app\/[A-Za-z0-9/_?=&%.-]*[A-Za-z0-9/_=&%-])/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = match[0];
    if (token.startsWith("**")) {
      out.push(
        <strong key={`${key}-${n++}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      out.push(
        <code key={`${key}-${n++}`} className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const href = token.slice(token.indexOf("/app/"));
      out.push(
        <a key={`${key}-${n++}`} href={href} className="font-medium text-primary underline-offset-2 hover:underline">
          {href}
        </a>,
      );
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * The little Markdown an answer has: paragraphs, lists, bold, code, headings
 * as bold lines. Built as React elements, so nothing in an answer can become
 * markup of its own.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const state: { list: { ordered: boolean; items: string[] } | null; para: string[] } = { list: null, para: [] };
  const flushPara = () => {
    if (!state.para.length) return;
    const lines = state.para;
    const key = `p${blocks.length}`;
    blocks.push(
      <p key={key}>
        {lines.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {inline(line, `${key}-${i}`)}
          </Fragment>
        ))}
      </p>,
    );
    state.para = [];
  };
  const flushList = () => {
    const list = state.list;
    if (!list) return;
    const key = `l${blocks.length}`;
    const items = list.items.map((item, i) => <li key={i}>{inline(item, `${key}-${i}`)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={key} className="grid list-decimal gap-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={key} className="grid list-disc gap-1 pl-5 marker:text-muted-foreground">
          {items}
        </ul>
      ),
    );
    state.list = null;
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = !bullet;
      if (state.list && state.list.ordered !== ordered) flushList();
      state.list ??= { ordered, items: [] };
      state.list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flushList();
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      blocks.push(
        <p key={`h${blocks.length}`} className="font-semibold">
          {inline(heading[1], `h${blocks.length}`)}
        </p>,
      );
      continue;
    }
    state.para.push(line);
  }
  flushPara();
  flushList();
  return <div className={cn("grid gap-2 break-words", className)}>{blocks}</div>;
}
