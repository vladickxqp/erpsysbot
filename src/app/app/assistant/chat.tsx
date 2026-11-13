"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FileText,
  FileWarning,
  History,
  MessageSquare,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Receipt,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  TrendingUp,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { archiveConversationAction, decideProposalAction, deleteConversationAction, renameConversationAction, type Proposal } from "./actions";
import { Markdown } from "./markdown";
import { toolLabel } from "./tool-label";

type Message = { id: string; role: "user" | "assistant"; content: string; tools?: string[] | null; failed?: boolean; proposals?: Proposal[] };
type Listed = { id: string; title: string; contextType: string | null; archived: boolean };
type Attached = { file: File; url: string | null };

const ERRORS: Record<string, string> = {
  NOT_CONFIGURED: "assistant.notConfigured",
  LIMIT: "assistant.limit",
  BUSY: "assistant.busy",
  REFUSED: "assistant.refused",
  FAILED: "assistant.failed",
  FORBIDDEN: "common.forbidden",
  FILE_SIZE: "aichat.tooBig",
  FILE_TYPE: "aichat.wrongType",
  FILE_COUNT: "aichat.tooMany",
};

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const READABLE = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

/** Big photos are made smaller before they leave the browser: faster to send, and just as readable. */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_500_000) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

type StreamEvent = { type: "step"; tool: string } | { type: "done"; answer: string; tools: string[]; conversationId: string | null; proposals: Proposal[] } | { type: "error"; error: string };

/** The answer's events as they arrive (server-sent events). */
async function* events(res: Response): AsyncGenerator<StreamEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
      const data = buffer
        .slice(0, end)
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      buffer = buffer.slice(end + 2);
      if (!data) continue;
      try {
        yield JSON.parse(data) as StreamEvent;
      } catch {
        // A broken line is skipped; the end of the stream still says how it went.
      }
    }
  }
}

const shown = (value: unknown): string => (typeof value === "string" ? value : Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ") : JSON.stringify(value));

type Row = Record<string, unknown>;
/** One line of a proposal, with everything it holds. */
const rowText = (row: Row) =>
  Object.entries(row)
    .filter(([key, value]) => key !== "title" && key !== "description" && value !== undefined && value !== "")
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${shown(value)}`)
    .join(" · ");

const STATUS_TONE: Record<string, string> = {
  PROPOSED: "bg-warning/15 text-warning",
  RUNNING: "bg-primary/10 text-primary",
  DONE: "bg-success/15 text-success",
  REJECTED: "bg-muted text-muted-foreground",
  FAILED: "bg-destructive/10 text-destructive",
};

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
    <div className={cn("ml-10 rounded-2xl border bg-card p-4 text-sm shadow-sm", proposal.status === "PROPOSED" && "border-warning/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{toolLabel(t, proposal.tool)}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[proposal.status] ?? "bg-muted")}>{t(`hub.ai.status_${proposal.status}`)}</span>
      </div>
      <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-4">
        {fields.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key.replaceAll("_", " ")}</dt>
            <dd className="mb-1 max-h-60 min-w-0 overflow-y-auto break-words whitespace-pre-wrap sm:mb-0">{shown(value)}</dd>
          </div>
        ))}
      </dl>
      {rows && (
        <ol className="mt-3 grid max-h-72 list-decimal gap-1 overflow-y-auto pl-5 text-xs">
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
        <div className="mt-4 flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => decide(true)}>
            <Check className="size-4" /> {t("hub.ai.confirm")}
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(false)}>
            <X className="size-4" /> {t("hub.ai.reject")}
          </Button>
        </div>
      )}
      {proposal.status === "DONE" && link && (
        <Link href={link} className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
          {t("hub.ai.openResult")}
        </Link>
      )}
      {proposal.status === "FAILED" && proposal.error && <p className="mt-3 text-xs text-destructive">{proposal.error}</p>}
    </div>
  );
}

function Avatar({ big = false }: { big?: boolean }) {
  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet-500 text-white shadow-sm", big ? "size-14" : "size-8")}>
      <Sparkles className={big ? "size-7" : "size-4"} />
    </div>
  );
}

const SUGGESTIONS: { key: "s1" | "s2" | "s3"; icon: LucideIcon }[] = [
  { key: "s1", icon: TrendingUp },
  { key: "s2", icon: FileWarning },
  { key: "s3", icon: UserPlus },
];

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
  userName,
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
  userName: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const asked = useRef(false);
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [conversationId, setConversationId] = useState(current?.id ?? null);
  const [sending, setSending] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [title, setTitle] = useState<string | null>(null);
  const [q, setQ] = useState(query);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const toBottom = (smooth = true) => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });

  // New messages pull the view down, unless the person scrolled up to read.
  useLayoutEffect(() => {
    if (atBottom) toBottom(messages.length > initial.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sending, step]);

  // The box grows with what is written, up to a limit.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [draft]);

  // A question passed in a link waits in the box: only the person sends it, so no link can speak for them.
  useEffect(() => {
    if (!ask || asked.current) return;
    asked.current = true;
    window.history.replaceState(null, "", "/app/assistant");
    setDraft(ask);
  }, [ask]);

  // Previews are given back to the browser when the chat closes.
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => () => filesRef.current.forEach((f) => f.url && URL.revokeObjectURL(f.url)), []);

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    const fitting = incoming.filter((f) => READABLE.includes(f.type));
    if (fitting.length < incoming.length) toast.error(t("aichat.wrongType"));
    const sized = fitting.filter((f) => f.size <= (f.type.startsWith("image/") ? 3 * MAX_BYTES : MAX_BYTES));
    if (sized.length < fitting.length) toast.error(t("aichat.tooBig"));
    setFiles((now) => {
      const room = MAX_FILES - now.length;
      if (sized.length > room) toast.error(t("aichat.tooMany"));
      return [...now, ...sized.slice(0, Math.max(0, room)).map((file) => ({ file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null }))];
    });
  };

  const removeFile = (index: number) =>
    setFiles((now) => {
      const gone = now[index];
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return now.filter((_, i) => i !== index);
    });

  const fail = (code: string) => setMessages((m) => [...m, { id: `e-${Date.now()}`, role: "assistant", content: t(ERRORS[code] ?? "assistant.failed"), failed: true }]);

  const send = async (text: string) => {
    const question = text.trim();
    if ((!question && !files.length) || sending) return;
    const attached = files;
    setFiles([]);
    setDraft("");
    setAtBottom(true);
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: [question, attached.length ? `📎 ${attached.map((a) => a.file.name).join(", ")}` : ""].filter(Boolean).join("\n") }]);
    setSending(true);
    setStep(null);
    let finished = false;
    try {
      const form = new FormData();
      form.set("question", question);
      if (conversationId) form.set("conversationId", conversationId);
      else if (context) form.set("context", context);
      for (const a of attached) {
        const file = await shrink(a.file);
        form.append("files", file, file.name);
      }
      const res = await fetch("/app/assistant/ask", { method: "POST", body: form });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        finished = true;
        fail(body?.error ?? "FAILED");
        return;
      }
      for await (const event of events(res)) {
        if (event.type === "step") setStep(event.tool);
        if (event.type === "error") {
          finished = true;
          fail(event.error);
        }
        if (event.type === "done") {
          finished = true;
          if (event.conversationId && event.conversationId !== conversationId) {
            setConversationId(event.conversationId);
            window.history.replaceState(null, "", `/app/assistant?c=${event.conversationId}`);
          }
          setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: event.answer, tools: event.tools, proposals: event.proposals }]);
        }
      }
      if (!finished) fail("FAILED");
    } catch {
      if (!finished) fail("FAILED");
    } finally {
      attached.forEach((a) => a.url && URL.revokeObjectURL(a.url));
      setSending(false);
      setStep(null);
      router.refresh();
    }
  };

  const act = (work: () => Promise<{ error?: string }>, then?: () => void) =>
    start(async () => {
      const result = await work();
      if (result.error) toast.error(t(result.error));
      else then?.();
      router.refresh();
    });

  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(t("aichat.copied")))
      .catch(() => toast.error(t("common.error")));

  const pendingProposals = proposals.filter((p) => !messages.some((m) => m.proposals?.some((x) => x.id === p.id)));
  const empty = messages.length === 0 && pendingProposals.length === 0;

  return (
    <div className="grid h-[calc(100dvh-10rem)] gap-4 lg:h-[calc(100dvh-7rem)] lg:grid-cols-[264px_1fr]">
      <aside className="hidden min-h-0 flex-col gap-3 rounded-2xl border bg-card/60 p-3 lg:flex">
        <Button asChild className="justify-start">
          <Link href="/app/assistant">
            <MessageSquarePlus className="size-4" /> {t("hub.ai.newChat")}
          </Link>
        </Button>
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/app/assistant?q=${encodeURIComponent(q)}${archived ? "&archived=1" : ""}`);
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("hub.ai.searchChats")} aria-label={t("hub.ai.searchChats")} className="pl-8" />
        </form>
        <nav className="-mr-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
          {conversations.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">{t("hub.ai.noChats")}</p>}
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/app/assistant?c=${c.id}`}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                c.id === conversationId && "bg-primary/10 font-medium text-primary hover:bg-primary/15 hover:text-primary",
              )}
            >
              <MessageSquare className="size-4 shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{c.title}</span>
            </Link>
          ))}
        </nav>
        <div className="grid gap-0.5 border-t pt-2 text-sm">
          <Link href={archived ? "/app/assistant" : "/app/assistant?archived=1"} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Archive className="size-4" aria-hidden /> {t(archived ? "hub.ai.active" : "hub.ai.archive")}
          </Link>
          <Link href="/app/assistant/history" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <History className="size-4" aria-hidden /> {t("hub.ai.history")}
          </Link>
          <Link href="/app/assistant/settings" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Settings2 className="size-4" aria-hidden /> {t("hub.ai.memoryAgents")}
          </Link>
        </div>
      </aside>

      <section
        className="relative flex min-h-0 min-w-0 flex-col"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex items-center gap-2 pb-2">
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
            <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">{current?.title ?? t("nav.ai")}</h1>
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

        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
          }}
        >
          {empty ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-2 py-8 text-center">
              <Avatar big />
              <div className="grid gap-1">
                <div className="text-2xl font-semibold tracking-tight">{t("aichat.hello", { name: userName.split(" ")[0] })}</div>
                <div className="text-muted-foreground">{t("assistant.empty")}</div>
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map(({ key, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => send(t(`assistant.${key}`))}
                    className="flex items-center gap-3 rounded-xl border bg-card p-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
                  >
                    <Icon className="size-4 shrink-0 text-primary" /> {t(`assistant.${key}`)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => picker.current?.click()}
                  className="flex items-center gap-3 rounded-xl border bg-card p-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <Receipt className="size-4 shrink-0 text-primary" /> {t("aichat.receipts")}
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto grid w-full max-w-3xl gap-5 px-1 py-4">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-primary-foreground shadow-sm">
                    {m.content}
                  </div>
                ) : (
                  <div key={m.id} className="grid gap-3">
                    <div className="group flex items-start gap-2">
                      <Avatar />
                      <div className="min-w-0 max-w-[85%]">
                        <div className={cn("rounded-2xl rounded-tl-md px-4 py-3 text-sm leading-relaxed", m.failed ? "bg-destructive/10 text-destructive" : "bg-muted/70")}>
                          {m.failed ? m.content : <Markdown text={m.content} />}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1 pl-1">
                          {m.tools?.map((tool) => (
                            <span key={tool} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              {toolLabel(t, tool)}
                            </span>
                          ))}
                          {!m.failed && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7 opacity-60 transition-opacity group-hover:opacity-100"
                              aria-label={t("aichat.copy")}
                              onClick={() => copy(m.content)}
                            >
                              <Copy className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    {m.proposals?.map((p) => <ProposalCard key={p.id} proposal={p} />)}
                  </div>
                ),
              )}
              {pendingProposals.map((p) => (
                <ProposalCard key={p.id} proposal={p} />
              ))}
              {sending && (
                <div className="flex items-start gap-2" aria-live="polite">
                  <Avatar />
                  <div className="flex items-center gap-3 rounded-2xl rounded-tl-md bg-muted/70 px-4 py-3 text-sm text-muted-foreground">
                    <span className="flex gap-1" aria-hidden>
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="size-1.5 animate-bounce rounded-full bg-primary/70" style={{ animationDelay: `${i * 150}ms` }} />
                      ))}
                    </span>
                    {step ? `${toolLabel(t, step)} …` : t("assistant.thinking")}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {!atBottom && !empty && (
          <Button size="icon" variant="outline" className="absolute bottom-32 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md" aria-label={t("aichat.down")} onClick={() => toBottom()}>
            <ArrowDown className="size-4" />
          </Button>
        )}

        <form
          className="mx-auto mt-2 w-full max-w-3xl"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <div className="rounded-2xl border bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring/30">
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {files.map((f, i) => (
                  <div key={`${f.file.name}-${i}`} className="flex max-w-56 items-center gap-2 rounded-lg border bg-muted/50 py-1 pr-1 pl-1 text-xs">
                    {f.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.url} alt="" className="size-8 rounded object-cover" />
                    ) : (
                      <span className="flex size-8 items-center justify-center rounded bg-background">
                        <FileText className="size-4 text-muted-foreground" />
                      </span>
                    )}
                    <span className="min-w-0 truncate">{f.file.name}</span>
                    <Button type="button" size="icon" variant="ghost" className="size-6 shrink-0" aria-label={t("aichat.remove")} onClick={() => removeFile(i)}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Textarea
              ref={box}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault();
                  addFiles(e.clipboardData.files);
                }
              }}
              placeholder={t("assistant.placeholder")}
              rows={1}
              maxLength={4000}
              className="max-h-48 min-h-12 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
              aria-label={t("assistant.placeholder")}
            />
            <div className="flex items-center justify-between px-2 pb-2">
              <Button type="button" size="icon" variant="ghost" className="rounded-full" aria-label={t("aichat.attach")} disabled={sending || files.length >= MAX_FILES} onClick={() => picker.current?.click()}>
                <Paperclip className="size-4" />
              </Button>
              <input
                ref={picker}
                type="file"
                multiple
                accept={READABLE.join(",")}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button type="submit" size="icon" className="size-9 rounded-full" disabled={sending || (!draft.trim() && !files.length)} aria-label={t("assistant.send")}>
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
        </form>

        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary backdrop-blur-[1px]">
            {t("aichat.drop")}
          </div>
        )}
      </section>
    </div>
  );
}
