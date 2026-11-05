"use client";

import { ArrowUp, AtSign, Hash, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { directAction, newChannelAction, newerAction, sendAction } from "./actions";

type Channel = { id: string; kind: string; name: string; unread: number };
type Message = { id: string; userId: string | null; who: string; body: string; at: string };

const POLL_MS = 4000;

export function ChatView({ channels, current, initial, members, me }: { channels: Channel[]; current: Channel; initial: Message[]; members: { id: string; name: string }[]; me: string }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [channel, setChannel] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const last = useRef(initial.at(-1)?.at ?? null);

  const pull = () =>
    newerAction(current.id, last.current)
      .then((fresh) => {
        if (!fresh.length) return;
        last.current = fresh.at(-1)!.at;
        setMessages((list) => [...list, ...fresh.filter((m) => !list.some((x) => x.id === m.id))]);
      })
      .catch(() => undefined);

  // Only while the page is in view: a chat in a background tab asks for nothing.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void pull();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [current.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    start(async () => {
      const result = await sendAction(current.id, body);
      if (result.error) {
        setDraft(body);
        toast.error(t(result.error));
      }
      await pull();
    });
  };

  return (
    <div className="grid h-[calc(100dvh-10rem)] gap-4 lg:h-[calc(100dvh-7rem)] lg:grid-cols-[240px_1fr]">
      <aside className="flex min-h-0 flex-col gap-2 max-lg:max-h-40">
        <h1 className="text-2xl font-semibold tracking-tight">{t("hub.chat.title")}</h1>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {channels.map((c) => (
            <Link key={c.id} href={`/app/chat?c=${c.id}`} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted", c.id === current.id && "bg-muted font-medium")}>
              {c.kind === "DIRECT" ? <AtSign className="size-3.5 shrink-0" aria-hidden /> : <Hash className="size-3.5 shrink-0" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.unread > 0 && c.id !== current.id && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{c.unread}</span>}
            </Link>
          ))}
        </div>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const result = await newChannelAction(channel);
              if (result.id) {
                setChannel("");
                router.push(`/app/chat?c=${result.id}`);
                router.refresh();
              } else toast.error(t(result.error ?? "common.error"));
            });
          }}
        >
          <Input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder={t("hub.chat.newChannel")} aria-label={t("hub.chat.newChannel")} maxLength={60} required />
          <Button type="submit" size="icon" variant="outline" disabled={pending} aria-label={t("crm.add")}>
            <Plus className="size-4" />
          </Button>
        </form>
        {members.length > 0 && (
          <Select
            value=""
            onValueChange={(v) =>
              start(async () => {
                const result = await directAction(v);
                if (result.id) {
                  router.push(`/app/chat?c=${result.id}`);
                  router.refresh();
                }
              })
            }
          >
            <SelectTrigger className="w-full" aria-label={t("hub.chat.direct")}>
              <SelectValue placeholder={t("hub.chat.direct")} />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="mb-2 font-medium">{current.kind === "DIRECT" ? current.name : `# ${current.name}`}</div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card p-4">
          {messages.length === 0 && <p className="text-sm text-muted-foreground">{t("hub.chat.empty")}</p>}
          <div className="grid gap-3">
            {messages.map((m) => (
              <div key={m.id} className="text-sm">
                <div className="text-xs text-muted-foreground">
                  <span className={cn("font-medium", m.userId === me ? "text-primary" : "text-foreground")}>{m.who}</span> · {formatDate(m.at, locale, region)} {new Date(m.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                </div>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
            <div ref={end} />
          </div>
        </div>
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={4000}
            className="max-h-40 min-h-11 resize-none"
            placeholder={t("hub.chat.placeholder")}
            aria-label={t("hub.chat.placeholder")}
          />
          <Button type="submit" size="icon" className="size-11 shrink-0" disabled={pending || !draft.trim()} aria-label={t("assistant.send")}>
            <ArrowUp className="size-5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
