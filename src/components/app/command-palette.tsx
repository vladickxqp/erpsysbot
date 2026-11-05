"use client";

import { ArrowRight, Bot, FileText, History, LoaderCircle, Plus, Search, Sparkles, Star, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { savePreferencesAction } from "@/app/app/inbox/actions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/server/search";
import type { NavItem } from "./nav";
import { openQuickTask } from "./quick-task";

const RECENT_KEY = "nexora:recent";
const EVENT = "nexora:palette";
const MAX_RECENT = 6;

export function openPalette(): void {
  window.dispatchEvent(new Event(EVENT));
}

type Entry = { id: string; section: "actions" | "favorites" | "recent" | "navigate" | "results" | "ai"; label: string; hint?: string | null; icon: LucideIcon; run: () => void; star?: string };
type Recent = { href: string; label: string };

function readRecent(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Recent[];
  } catch {
    return [];
  }
}

function remember(entry: Recent): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([entry, ...readRecent().filter((r) => r.href !== entry.href)].slice(0, MAX_RECENT)));
  } catch {
    // Without storage the list of recent places simply stays empty.
  }
}

/** Ctrl+K: go anywhere, start anything, find anything, ask the assistant. Works without a mouse. */
export function CommandPalette({ items, permissions, offModules, favorites, assistant }: { items: NavItem[]; permissions: string[]; offModules: string[]; favorites: string[]; assistant: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [stars, setStars] = useState(favorites);
  const [, start] = useTransition();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => setStars(favorites), [favorites]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setHits([]);
    setActive(0);
    setRecent(readRecent());
  }, [open]);

  // Asks the server only once typing pauses.
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setFailed(false);
    const stop = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/app/search/results?q=${encodeURIComponent(text)}`, { signal: stop.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("search"))))
        .then((b: { hits: SearchHit[] }) => {
          setHits(b.hits);
          setSearching(false);
        })
        .catch((e: Error) => {
          if (e.name === "AbortError") return;
          setFailed(true);
          setSearching(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [q]);

  const go = useCallback(
    (href: string, label: string) => {
      remember({ href, label });
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const toggleStar = useCallback(
    (href: string) => {
      const next = stars.includes(href) ? stars.filter((s) => s !== href) : [href, ...stars].slice(0, 20);
      setStars(next);
      start(async () => {
        await savePreferencesAction({ favorites: next });
        router.refresh();
      });
    },
    [stars, router],
  );

  const entries = useMemo<Entry[]>(() => {
    const text = q.trim().toLowerCase();
    const match = (label: string) => !text || label.toLowerCase().includes(text);
    const can = (p: string, m: string) => permissions.includes(p) && !offModules.includes(m);
    const actions: Entry[] = [];
    const action = (id: string, label: string, run: () => void, icon: LucideIcon = Plus) => actions.push({ id: `a-${id}`, section: "actions", label, icon, run });
    if (can("tasks.manage", "tasks")) {
      action("task", t("hub.tasks.quick"), () => {
        setOpen(false);
        openQuickTask({ title: text && !hits.length ? q.trim() : undefined });
      });
      action("project", t("widgets.quick.project"), () => go("/app/tasks?newProject=1", t("widgets.quick.project")));
    }
    if (can("clients.create", "crm")) action("client", t("widgets.quick.client"), () => go("/app/clients?new=1", t("widgets.quick.client")));
    if (can("invoices.create", "invoices")) action("invoice", t("widgets.quick.invoice"), () => go("/app/invoices/new", t("widgets.quick.invoice")));
    if (can("calendar.manage", "calendar")) action("appointment", t("widgets.quick.appointment"), () => go("/app/calendar?new=1", t("widgets.quick.appointment")));
    const nav = items.filter((i) => match(t(i.label)));
    const byHref = new Map(items.map((i) => [i.href, i]));
    const all: Entry[] = [
      ...actions.filter((a) => match(a.label)),
      ...stars
        .map((href) => byHref.get(href))
        .filter((i): i is NavItem => !!i && match(t(i.label)))
        .map((i): Entry => ({ id: `f-${i.href}`, section: "favorites", label: t(i.label), icon: i.icon, run: () => go(i.href, t(i.label)), star: i.href })),
      ...(text ? [] : recent.map((r): Entry => ({ id: `r-${r.href}`, section: "recent", label: r.label, icon: History, run: () => go(r.href, r.label) }))),
      ...nav.filter((i) => !stars.includes(i.href)).map((i): Entry => ({ id: `n-${i.href}`, section: "navigate", label: t(i.label), icon: i.icon, run: () => go(i.href, t(i.label)), star: i.href })),
      ...hits.map((h): Entry => ({ id: `s-${h.kind}-${h.id}`, section: "results", label: h.title, hint: `${t(`searchPage.kind.${h.kind}`)}${h.hint ? ` · ${h.hint}` : ""}`, icon: FileText, run: () => go(h.href, h.title) })),
    ];
    if (text.length >= 2) all.push({ id: "s-all", section: "results", label: t("hub.palette.allResults", { q: q.trim() }), icon: Search, run: () => go(`/app/search?q=${encodeURIComponent(q.trim())}`, q.trim()) });
    if (assistant && text.length >= 2) all.push({ id: "ai", section: "ai", label: t("hub.palette.ask", { q: q.trim() }), icon: Sparkles, run: () => go(`/app/assistant?ask=${encodeURIComponent(q.trim().slice(0, 500))}`, t("nav.ai")) });
    else if (assistant && !text) all.push({ id: "ai-open", section: "ai", label: t("nav.ai"), icon: Bot, run: () => go("/app/assistant", t("nav.ai")) });
    return all;
  }, [q, hits, recent, stars, items, permissions, offModules, assistant, go, t]);

  useEffect(() => setActive(0), [q, hits.length]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (entries.length ? (i + 1) % entries.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (entries.length ? (i - 1 + entries.length) % entries.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      entries[active]?.run();
    }
  };

  const sections = ["actions", "favorites", "recent", "navigate", "results", "ai"] as const;
  let index = -1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">{t("hub.palette.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("hub.palette.placeholder")}</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          {searching ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden /> : <Search className="size-4 text-muted-foreground" aria-hidden />}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={entries[active] ? `palette-${entries[active].id}` : undefined}
            aria-label={t("hub.palette.title")}
            placeholder={t("hub.palette.placeholder")}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">Esc</kbd>
        </div>
        <div ref={list} id="palette-list" role="listbox" aria-label={t("hub.palette.title")} className="max-h-[60vh] overflow-y-auto p-1.5">
          {failed && <p className="px-2 py-1.5 text-sm text-destructive">{t("common.error")}</p>}
          {q.trim().length >= 2 && !searching && !failed && hits.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">{t("searchPage.nothing")}</p>}
          {sections.map((section) => {
            const group = entries.filter((e) => e.section === section);
            if (!group.length) return null;
            return (
              <div key={section} role="group" aria-label={t(`hub.palette.${section}`)} className="mb-1">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{t(`hub.palette.${section}`)}</div>
                {group.map((entry) => {
                  index += 1;
                  const at = index;
                  const Icon = entry.icon;
                  return (
                    <div
                      key={entry.id}
                      id={`palette-${entry.id}`}
                      data-index={at}
                      role="option"
                      aria-selected={at === active}
                      onMouseMove={() => at !== active && setActive(at)}
                      onClick={entry.run}
                      className={cn("group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm", at === active && "bg-accent text-accent-foreground")}
                    >
                      <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                      <span className="min-w-0 truncate">{entry.label}</span>
                      {entry.hint && <span className="min-w-0 truncate text-xs text-muted-foreground">{entry.hint}</span>}
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        {entry.star && (
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label={t("hub.palette.favorite")}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleStar(entry.star!);
                            }}
                            className={cn("rounded p-0.5", stars.includes(entry.star) ? "text-warning" : "text-muted-foreground opacity-0 group-hover:opacity-100")}
                          >
                            <Star className="size-3.5" fill={stars.includes(entry.star) ? "currentColor" : "none"} />
                          </button>
                        )}
                        {at === active && <ArrowRight className="size-3.5 opacity-60" aria-hidden />}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
