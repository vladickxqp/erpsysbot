"use client";

import { Copy, WandSparkles } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import {
  CONTENT_TYPES,
  CREATIVITY,
  GENERATION_KINDS,
  LANGUAGE_ENDONYMS,
  LENGTHS,
  OUTPUT_LANGUAGES,
  PLATFORMS,
  TONES,
  type ContentType,
  type GenerationKind,
  type Platform,
} from "@/lib/content";
import { cn } from "@/lib/utils";
import { generateAction, keepSuggestionsAction } from "../actions";

type Item = { title: string; text: string; hashtags: string; day: number; keep: boolean };

function Pick<T extends string>({ label, value, options, onChange, text }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void; text: (v: T) => string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {text(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const SOURCE_KINDS: GenerationKind[] = ["repurpose", "variants"];

export function Generator({ defaultLanguage }: { defaultLanguage: string }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<GenerationKind>("ideas");
  const [topic, setTopic] = useState("");
  const [source, setSource] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("friendly");
  const [audience, setAudience] = useState("");
  const [language, setLanguage] = useState<(typeof OUTPUT_LANGUAGES)[number]>(
    (OUTPUT_LANGUAGES as readonly string[]).includes(defaultLanguage) ? (defaultLanguage as (typeof OUTPUT_LANGUAGES)[number]) : "en",
  );
  const [contentType, setContentType] = useState<ContentType>("POST");
  const [platform, setPlatform] = useState<Platform>("INSTAGRAM");
  const [targets, setTargets] = useState<Platform[]>(["INSTAGRAM", "LINKEDIN", "TELEGRAM"]);
  const [length, setLength] = useState<(typeof LENGTHS)[number]>("medium");
  const [creativity, setCreativity] = useState<(typeof CREATIVITY)[number]>("balanced");
  const [items, setItems] = useState<Item[]>([]);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const generate = () =>
    start(async () => {
      const res = await generateAction({
        kind,
        topic,
        source: source || null,
        tone,
        audience: audience || null,
        language,
        contentType,
        platform,
        targets: kind === "repurpose" ? targets : [],
        length,
        creativity,
      });
      if (res.error || !res.items) {
        toast.error(t(res.error ?? "assistant.failed"));
        return;
      }
      setSaved(false);
      setItems(res.items.map((i) => ({ ...i, hashtags: i.hashtags.join(" "), keep: false })));
    });

  const keep = () =>
    start(async () => {
      const chosen = items.filter((i) => i.keep);
      const res = await keepSuggestionsAction(
        chosen.map((i) => ({ title: i.title, text: i.text, hashtags: i.hashtags.split(/\s+/).filter(Boolean), day: i.day })),
        { platform, contentType, plan: kind === "plan" },
      );
      if (res.error) toast.error(t(res.error));
      else {
        toast.success(t("studio.keptDrafts", { count: String(res.count ?? chosen.length) }));
        setSaved(true);
        setItems((list) => list.map((i) => ({ ...i, keep: false })));
      }
    });

  const update = (index: number, patch: Partial<Item>) => setItems((list) => list.map((i, n) => (n === index ? { ...i, ...patch } : i)));
  const chosen = items.filter((i) => i.keep).length;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="h-fit lg:col-span-2">
        <CardContent className="grid gap-4 pt-6">
          <div className="grid gap-1.5">
            <Label>{t("studio.gen.what")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {GENERATION_KINDS.map((k) => (
                <Button key={k} type="button" size="sm" variant={kind === k ? "default" : "outline"} className="rounded-full" onClick={() => setKind(k)} aria-pressed={kind === k}>
                  {t(`studio.gen.kind.${k}`)}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="g-topic">{t("studio.gen.topic")}</Label>
            <Textarea id="g-topic" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={2000} />
          </div>
          {(SOURCE_KINDS.includes(kind) || source) && (
            <div className="grid gap-1.5">
              <Label htmlFor="g-source">{t("studio.gen.source")}</Label>
              <Textarea id="g-source" rows={5} value={source} onChange={(e) => setSource(e.target.value)} maxLength={20000} />
            </div>
          )}
          {kind === "repurpose" ? (
            <div className="grid gap-1.5">
              <Label>{t("studio.gen.targets")}</Label>
              <div className="grid grid-cols-2 gap-1">
                {PLATFORMS.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={targets.includes(p)}
                      onCheckedChange={(v) => setTargets((list) => (v === true ? [...list, p].slice(0, 8) : list.filter((x) => x !== p)))}
                    />
                    {t(`studio.platform.${p}`)}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Pick label={t("studio.platformLabel")} value={platform} options={PLATFORMS} onChange={setPlatform} text={(v) => t(`studio.platform.${v}`)} />
              <Pick label={t("studio.typeLabel")} value={contentType} options={CONTENT_TYPES} onChange={setContentType} text={(v) => t(`studio.type.${v}`)} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Pick label={t("studio.gen.tone")} value={tone} options={TONES} onChange={setTone} text={(v) => t(`studio.gen.tones.${v}`)} />
            <Pick label={t("common.language")} value={language} options={OUTPUT_LANGUAGES} onChange={setLanguage} text={(v) => LANGUAGE_ENDONYMS[v]} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="g-aud">{t("studio.gen.audience")}</Label>
            <Input id="g-aud" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Pick label={t("studio.gen.length")} value={length} options={LENGTHS} onChange={setLength} text={(v) => t(`studio.gen.lengths.${v}`)} />
            <Pick label={t("studio.gen.creativity")} value={creativity} options={CREATIVITY} onChange={setCreativity} text={(v) => t(`studio.gen.creativities.${v}`)} />
          </div>
          <Button onClick={generate} disabled={pending || topic.trim().length < 2 || (kind === "repurpose" && (!source.trim() || !targets.length))}>
            <WandSparkles className="size-4" /> {pending ? t("assistant.thinking") : t("studio.gen.run")}
          </Button>
        </CardContent>
      </Card>

      <div className="grid h-fit gap-3 lg:col-span-3">
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setItems((list) => list.map((i) => ({ ...i, keep: chosen < list.length })))}>
              {chosen < items.length ? t("studio.gen.selectAll") : t("studio.gen.selectNone")}
            </Button>
            <Button size="sm" onClick={keep} disabled={pending || chosen === 0}>
              {t(kind === "plan" ? "studio.gen.keepPlan" : "studio.gen.keep", { count: String(chosen) })}
            </Button>
            {saved && (
              <Button asChild variant="link" size="sm">
                <Link href={kind === "plan" ? "/app/content" : "/app/content?view=list"}>{t("studio.title")}</Link>
              </Button>
            )}
          </div>
        )}
        {items.map((item, n) => (
          <Card key={n} className={cn(item.keep && "ring-2 ring-primary")}>
            <CardContent className="grid gap-2 pt-4">
              <div className="flex items-center gap-2">
                <Checkbox checked={item.keep} onCheckedChange={(v) => update(n, { keep: v === true })} aria-label={t("studio.gen.choose")} />
                {item.day > 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums">{t("studio.gen.day", { n: String(item.day) })}</span>}
                <Input value={item.title} onChange={(e) => update(n, { title: e.target.value })} className="font-medium" aria-label={t("studio.titleLabel")} />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("studio.gen.copy")}
                  onClick={() => {
                    void navigator.clipboard?.writeText([item.title, item.text, item.hashtags].filter(Boolean).join("\n\n"));
                    toast.success(t("studio.gen.copied"));
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              {(item.text || kind !== "hashtags") && (
                <Textarea rows={Math.min(14, Math.max(3, item.text.split("\n").length + 1))} value={item.text} onChange={(e) => update(n, { text: e.target.value })} aria-label={t("studio.text")} />
              )}
              {(item.hashtags || kind === "hashtags") && <Textarea rows={2} value={item.hashtags} onChange={(e) => update(n, { hashtags: e.target.value })} aria-label={t("studio.hashtags")} />}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
