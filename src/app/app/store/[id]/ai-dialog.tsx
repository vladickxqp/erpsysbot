"use client";

import { ArrowLeft, Check, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { THEME_PRESETS, themeOf, type SiteKind } from "@/lib/site";
import { cn } from "@/lib/utils";
import { FONT_VARIABLES } from "@/app/shop/[slug]/fonts";
import type { GeneratedSite } from "@/server/site-ai";
import { applySiteAction, generateSiteAction } from "../actions";
import { TYPE_ICON } from "./sections-tab";
import { MiniSite } from "./theme-tab";

const STEPS = ["structure", "texts", "colors", "polish"] as const;

/** The AI builds a whole site from a description; the person sees the proposal and takes it over or not. */
export function AiDialog({ open, onOpenChange, storeId, kind, name }: { open: boolean; onOpenChange: (open: boolean) => void; storeId: string; kind: SiteKind; name: string }) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<GeneratedSite | null>(null);
  const [withCategories, setWithCategories] = useState(true);
  const [generating, startGenerating] = useTransition();
  const [applying, startApplying] = useTransition();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!generating) return;
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 5000);
    return () => clearInterval(timer);
  }, [generating]);

  const generate = () =>
    startGenerating(async () => {
      const r = await generateSiteAction(storeId, prompt);
      if (r.ok) setResult(r.site);
      else toast.error(t(r.error));
    });

  const apply = () => {
    if (!result || !window.confirm(t("sites.ai.replaceAsk"))) return;
    startApplying(async () => {
      const r = await applySiteAction(storeId, {
        theme: result.theme,
        tagline: result.tagline,
        sections: result.sections,
        pages: result.pages,
        categories: result.categories,
        createCategories: kind === "store" && withCategories,
      });
      if (r.ok) {
        toast.success(t("sites.ai.applied"));
        // Everything on the page changed: load it fresh.
        window.location.reload();
      } else toast.error(t(r.error ?? "common.error"));
    });
  };

  const theme = result ? themeOf({ ...(result.theme.preset ? THEME_PRESETS[result.theme.preset] : {}), ...result.theme }) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !generating && !applying && onOpenChange(o)}>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto sm:max-w-3xl", FONT_VARIABLES)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" /> {t("sites.ai.title")}
          </DialogTitle>
        </DialogHeader>

        {generating ? (
          <ol className="grid gap-3 py-6" aria-live="polite">
            {STEPS.map((s, i) => (
              <li key={s} className={cn("flex items-center gap-3 text-sm transition-opacity", i > step && "opacity-40")}>
                {i < step ? <Check className="size-4 text-success" /> : i === step ? <Loader2 className="size-4 animate-spin text-primary" /> : <span className="size-4" />}
                {t(`sites.ai.step.${s}`)}
              </li>
            ))}
          </ol>
        ) : result && theme ? (
          <div className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <MiniSite theme={theme} name={name} tagline={result.tagline} large />
              <div className="grid content-start gap-3 text-sm">
                <span className="font-medium">{t("store.tab.home")}</span>
                <ul className="grid gap-1.5">
                  {result.sections.map((s) => {
                    const Icon = TYPE_ICON[s.type];
                    return (
                      <li key={s.id} className="flex min-w-0 items-center gap-2">
                        <Icon className="size-4 shrink-0 text-primary" />
                        <span className="truncate">{s.title || t(`sites.type.${s.type}`)}</span>
                      </li>
                    );
                  })}
                </ul>
                {result.pages.length > 0 && (
                  <>
                    <span className="pt-1 font-medium">{t("store.tab.pages")}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {result.pages.map((p) => (
                        <Badge key={p.slug} variant="secondary">
                          {p.title}
                        </Badge>
                      ))}
                    </div>
                  </>
                )}
                {kind === "store" && result.categories.length > 0 && (
                  <label className="flex items-start gap-2 pt-1">
                    <Checkbox checked={withCategories} onCheckedChange={(c) => setWithCategories(c === true)} className="mt-0.5" />
                    <span className="grid gap-1">
                      <span className="font-medium">{t("sites.ai.categories")}</span>
                      <span className="text-muted-foreground">{result.categories.join(" · ")}</span>
                    </span>
                  </label>
                )}
              </div>
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="ghost" disabled={applying} onClick={() => setResult(null)}>
                <ArrowLeft className="size-4" /> {t("common.back")}
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={applying} onClick={generate}>
                  <RefreshCw className="size-4" /> {t("sites.ai.again")}
                </Button>
                <Button type="button" disabled={applying} onClick={apply}>
                  {applying ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {t("sites.ai.apply")}
                </Button>
              </div>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim().length >= 10) generate();
            }}
          >
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder={t(`sites.ai.placeholder.${kind}`)}
              aria-label={t("sites.ai.describe")}
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" onClick={() => setPrompt(t(`sites.ai.example.${kind}${n}`))} className="rounded-full border px-3 py-1 text-xs transition hover:border-primary hover:bg-accent">
                  {t(`sites.ai.exampleTitle.${kind}${n}`)}
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={prompt.trim().length < 10}>
                <Sparkles className="size-4" /> {t("sites.ai.generate")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
