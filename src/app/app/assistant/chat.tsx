"use client";

import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { askAction, clearAction } from "./actions";

type Message = { id: string; role: "user" | "assistant"; content: string; tools?: string[] | null; failed?: boolean };

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

export function Chat({ initial, ask }: { initial: Message[]; ask?: string }) {
  const { t } = useI18n();
  const asked = useRef(false);
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
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
      const result = await askAction(question);
      setMessages((m) => [
        ...m,
        result.answer
          ? { id: `a-${Date.now()}`, role: "assistant", content: result.answer, tools: result.tools }
          : { id: `e-${Date.now()}`, role: "assistant", content: t(ERRORS[result.error ?? "FAILED"]), failed: true },
      ]);
    });
  };

  // A question passed in the link (the dashboard's analysis) is asked once, then dropped from the address.
  useEffect(() => {
    if (!ask || asked.current) return;
    asked.current = true;
    window.history.replaceState(null, "", "/app/assistant");
    send(ask);
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-3xl flex-col lg:h-[calc(100dvh-7rem)]">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("nav.ai")}</h1>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await clearAction();
                setMessages([]);
              })
            }
          >
            <RotateCcw className="size-4" /> {t("assistant.clear")}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto rounded-xl border bg-card p-4">
        {messages.length === 0 ? (
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
              <div
                key={m.id}
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted",
                  m.failed && "bg-destructive/10 text-destructive",
                )}
              >
                {m.role === "assistant" ? <Linked text={m.content} /> : m.content}
                {m.tools && m.tools.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 border-t border-foreground/10 pt-2">
                    {m.tools.map((tool) => (
                      <span key={tool} className="rounded-full bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                        ⚙ {t(`assistant.tool_${tool}`)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
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
  );
}
