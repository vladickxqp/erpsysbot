"use client";

import { Archive, ArchiveRestore, ArrowUp, Check, History, MessageSquarePlus, Pencil, Settings2, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { archiveConversationAction, askAction, decideProposalAction, deleteConversationAction, renameConversationAction, type Proposal } from "./actions";
import { toolLabel } from "./tool-label";

type Message = { id: string; role: "user" | "assistant"; content: string; tools?: string[] | null; failed?: boolean; proposals?: Proposal[] };
type Listed = { id: string; title: string; contextType: string | null; archived: boolean };

const ERRORS = {
  NOT_CONFIGURED: "assistant.notConfigured",
  LIMIT: "assistant.limit",
  BUSY: "assistant.busy",
  REFUSED: "assistant.refused",
  FAILED: "assistant.failed",
  FORBIDDEN: "common.forbidden",
} as const;

/** Links the assistant writes (/app/... or the full address) become clickable. */
function Linked({ text }: { text: string }) {
  // Only the /app/... part becomes the link: whatever host stands before it is dropped.
  const parts = text.split(/((?:https?:\/\/[^\s)]+?)?\/app\/[A-Za-z0-9/_-]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part.slice(part.indexOf("/app/"))} className="font-medium text-primary underline-offset-2 hover:underline">
            {part.slice(part.indexOf("/app/"))}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const shown = (value: unknown): string => (typeof value === "string" ? value : Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ") : JSON.stringify(value));

type Row = Record<string, unknown>;
/** One line of a proposal, with everything it holds. */
const rowText = (row: Row) =>
  Object.entries(row)
    .filter(([key, value]) => key !== "title" && key !== "description" && value !== undefined && value !== "")
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${shown(value)}`)
    .join(" · ");

/** What the assistant prepared, marked as a proposal, with the person's yes or no. */
export function ProposalCard({ proposal: initial }: { proposal: Proposal }) {
  const { t } = useI18n();
  const router = useRouter();
  const [proposal, setProposal] = useState(initial);
  const [pending, start] = useTransition();
  const rows = [proposal.input.tasks, proposal.input.items].find(Array.isArray) as Row[] | undefined;
  const fields = Object.entries(proposal.input).filter(([key, value]) => key !== "tasks" && key !== "items" && value !== undefined && value !== "");
  const link = typeof proposal.result?.link === "string" ? proposal.result.link : null;
  const decide = (approve: boolean) =>
    start(async () => {
      const result = await decideProposalAction(proposal.id, approve);
      if (result.proposal) setProposal(result.proposal);
      if (result.error) toast.error(t(result.error));
      if (result.proposal?.status === "FAILED") toast.error(t("hub.ai.failed"));
      router.refresh();
    });
  return (
    <div className="rounded-xl border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{t(`hub.ai.status_${proposal.status}`)}</span>
        <span className="font-medium">{toolLabel(t, proposal.tool)}</span>
      </div>
      <dl className="mt-2 grid gap-0.5 text-xs">
        {fields.map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">{key.replaceAll("_", " ")}:</dt>
            <dd className="max-h-60 min-w-0 overflow-y-auto break-words whitespace-pre-wrap">{shown(value)}</dd>
          </div>
        ))}
      </dl>
      {rows && (
        <ol className="mt-2 grid max-h-72 list-decimal gap-1 overflow-y-auto pl-5 text-xs">
          {rows.map((row, i) => (
            <li key={i}>
              <span className="font-medium">{shown(row.title ?? row.description ?? "")}</span>
              {row.title !== undefined && row.description !== undefined && <span className="block whitespace-pre-wrap text-muted-foreground">{shown(row.description)}</span>}
              {rowText(row) && <span className="block whitespace-pre-wrap text-muted-foreground">{rowText(row)}</span>}
            </li>
          ))}
        </ol>
      )}
      {proposal.status === "PROPOSED" && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => decide(true)}>
            <Check className="size-4" /> {t("hub.ai.confirm")}
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(false)}>
            <X className="size-4" /> {t("hub.ai.reject")}
          </Button>
        </div>
      )}
      {proposal.status === "DONE" && link && (
        <Link href={link} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
          {t("hub.ai.openResult")}
        </Link>
      )}
      {proposal.status === "FAILED" && proposal.error && <p className="mt-2 text-xs text-destructive">{proposal.error}</p>}
    </div>
  );
}

export function Chat({
  conversations,
  current,
  initial,
  proposals,
  ask,
  context,
  contextType,
  query,
  archived,
}: {
  conversations: Listed[];
  current: { id: string; title: string; archived: boolean } | null;
  initial: Message[];
  proposals: Proposal[];
  ask?: string;
  context: string | null;
  contextType: string | null;
  query: string;
  archived: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const asked = useRef(false);
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState(current?.id ?? null);
  const [pending, start] = useTransition();
  const [title, setTitle] = useState<string | null>(null);
  const [q, setQ] = useState(query);
  const end = useRef<HTMLDivElement>(null);

  // Block body: newer browsers return a Promise from scrollIntoView, which React must not get.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || pending) return;
    setDraft("");
    const mine: Message = { id: `local-${Date.now()}`, role: "user", content: question };
    setMessages((m) => [...m, mine]);
    start(async () => {
      const result = await askAction(question, conversationId, conversationId ? null : context);
      if (result.conversationId && result.conversationId !== conversationId) {
        setConversationId(result.conversationId);
        window.history.replaceState(null, "", `/app/assistant?c=${result.conversationId}`);
      }
      setMessages((m) => [
        ...m,
        result.answer
          ? { id: `a-${Date.now()}`, role: "assistant", content: result.answer, tools: result.tools, proposals: result.proposals }
          : { id: `e-${Date.now()}`, role: "assistant", content: t(ERRORS[result.error ?? "FAILED"]), failed: true },
      ]);
      router.refresh();
    });
  };

  // A question passed in a link waits in the box: only the person sends it, so no link can speak for them.
  useEffect(() => {
    if (!ask || asked.current) return;
    asked.current = true;
    window.history.replaceState(null, "", "/app/assistant");
    setDraft(ask);
  }, [ask]);

  const act = (work: () => Promise<{ error?: string }>, then?: () => void) =>
    start(async () => {
      const result = await work();
      if (result.error) toast.error(t(result.error));
      else then?.();
      router.refresh();
    });

  const pendingProposals = proposals.filter((p) => !messages.some((m) => m.proposals?.some((x) => x.id === p.id)));

  return (
    <div className="grid h-[calc(100dvh-10rem)] gap-4 lg:h-[calc(100dvh-7rem)] lg:grid-cols-[260px_1fr]">
      <aside className="hidden min-h-0 flex-col gap-2 lg:flex">
        <Button asChild size="sm">
          <Link href="/app/assistant">
            <MessageSquarePlus className="size-4" /> {t("hub.ai.newChat")}
          </Link>
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/app/assistant?q=${encodeURIComponent(q)}${archived ? "&archived=1" : ""}`);
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("hub.ai.searchChats")} aria-label={t("hub.ai.searchChats")} />
        </form>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {conversations.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">{t("hub.ai.noChats")}</p>}
          {conversations.map((c) => (
            <Link key={c.id} href={`/app/assistant?c=${c.id}`} className={cn("block truncate rounded-md px-2 py-1.5 text-sm hover:bg-muted", c.id === conversationId && "bg-muted font-medium")}>
              {c.title}
            </Link>
          ))}
        </div>
        <div className="grid gap-0.5 border-t pt-2 text-sm">
          <Link href={archived ? "/app/assistant" : "/app/assistant?archived=1"} className="flex items-center gap-2 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted">
            <Archive className="size-4" aria-hidden /> {t(archived ? "hub.ai.active" : "hub.ai.archive")}
          </Link>
          <Link href="/app/assistant/history" className="flex items-center gap-2 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted">
            <History className="size-4" aria-hidden /> {t("hub.ai.history")}
          </Link>
          <Link href="/app/assistant/settings" className="flex items-center gap-2 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted">
            <Settings2 className="size-4" aria-hidden /> {t("hub.ai.memoryAgents")}
          </Link>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="mb-3 flex items-center gap-2">
          {title !== null ? (
            <form
              className="flex flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                act(() => renameConversationAction(conversationId!, title), () => setTitle(null));
              }}
            >
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus aria-label={t("hub.ai.rename")} />
              <Button type="submit" size="sm" disabled={pending}>
                {t("common.save")}
              </Button>
            </form>
          ) : (
            <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">{current?.title ?? t("nav.ai")}</h1>
          )}
          {contextType && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t(`hub.ai.context_${contextType}`)}</span>}
          {current && title === null && (
            <>
              <Button size="icon" variant="ghost" aria-label={t("hub.ai.rename")} onClick={() => setTitle(current.title)}>
                <Pencil className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" disabled={pending} aria-label={t(current.archived ? "hub.ai.restore" : "hub.ai.archive")} onClick={() => act(() => archiveConversationAction(current.id, !current.archived))}>
                {current.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
              </Button>
              <Button size="icon" variant="ghost" disabled={pending} aria-label={t("common.delete")} onClick={() => act(() => deleteConversationAction(current.id), () => router.push("/app/assistant"))}>
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card p-4">
          {messages.length === 0 && pendingProposals.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-6" />
              </div>
              <div className="text-lg font-medium">{t("assistant.empty")}</div>
              <div className="flex flex-wrap justify-center gap-2">
                {(["s1", "s2", "s3"] as const).map((key) => (
                  <Button key={key} variant="outline" size="sm" onClick={() => send(t(`assistant.${key}`))}>
                    {t(`assistant.${key}`)}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {messages.map((m) => (
                <Fragment key={m.id}>
                  <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed", m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted", m.failed && "bg-destructive/10 text-destructive")}>
                    {m.role === "assistant" ? <Linked text={m.content} /> : m.content}
                    {m.tools && m.tools.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1 border-t border-foreground/10 pt-2">
                        {m.tools.map((tool) => (
                          <span key={tool} className="rounded-full bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                            ⚙ {toolLabel(t, tool)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {m.proposals?.map((p) => <ProposalCard key={p.id} proposal={p} />)}
                </Fragment>
              ))}
              {pendingProposals.map((p) => (
                <ProposalCard key={p.id} proposal={p} />
              ))}
              {pending && <div className="w-fit animate-pulse rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">{t("assistant.thinking")}</div>}
              <div ref={end} />
            </div>
          )}
        </div>

        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder={t("assistant.placeholder")}
            rows={1}
            maxLength={4000}
            className="max-h-40 min-h-11 resize-none"
            aria-label={t("assistant.placeholder")}
          />
          <Button type="submit" size="icon" className="size-11 shrink-0" disabled={pending || !draft.trim()} aria-label={t("assistant.send")}>
            <ArrowUp className="size-5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
