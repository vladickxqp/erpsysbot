"use client";

import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";
import {
  ANIMATIONS,
  BUTTON_STYLES,
  CONTAINERS,
  FONT_PAIRS,
  HEADER_STYLES,
  HEADING_WEIGHTS,
  HOVERS,
  PRESET_NAMES,
  presetTheme,
  RADII,
  RADIUS_PX,
  SPEEDS,
  themeVars,
  type AnimationName,
  type ButtonStyle,
  type Theme,
} from "@/lib/site";
import { cn } from "@/lib/utils";
import { FONT_STACKS, FONT_VARIABLES } from "@/app/shop/[slug]/fonts";
import { saveThemeAction } from "../actions";
import { ColorField, Field, ImagePick, Segmented, useSave, type Images } from "./editor-ui";

type Props = { storeId: string; name: string; theme: Theme; logoId: string | null; tagline: string; images: Images };

export function ThemeTab({ storeId, name, theme, logoId, tagline, images }: Props) {
  const { t } = useI18n();
  const { pending, run } = useSave();
  const [v, setV] = useState({ ...theme, logoId, tagline });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });

  return (
    <div className={cn("grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]", FONT_VARIABLES)}>
      <div className="grid min-w-0 content-start gap-6">
        <Card>
          <CardContent className="grid gap-3 pt-6">
            <span className="text-sm font-medium">{t("sites.theme.presets")}</span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PRESET_NAMES.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={v.preset === p}
                  onClick={() => set({ preset: p, ...presetTheme(p) })}
                  className={cn("grid gap-2 rounded-lg border p-2 text-left text-sm transition hover:shadow-md", v.preset === p && "border-primary ring-2 ring-primary/30")}
                >
                  <MiniSite theme={{ ...v, preset: p, ...presetTheme(p) }} name={t(`sites.preset.${p}`)} />
                  <span className="px-1 font-medium">{t(`sites.preset.${p}`)}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-6 pt-6">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t("sites.theme.mode")}</legend>
              <div className="flex gap-2">
                {(["light", "dark"] as const).map((mode) => (
                  <Button key={mode} type="button" variant={v.mode === mode ? "secondary" : "outline"} aria-pressed={v.mode === mode} onClick={() => set({ mode })}>
                    {mode === "light" ? <Sun className="size-4" /> : <Moon className="size-4" />} {t(`sites.theme.${mode}`)}
                  </Button>
                ))}
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t("sites.theme.font")}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {FONT_PAIRS.map((font) => (
                  <button
                    key={font}
                    type="button"
                    aria-pressed={v.font === font}
                    onClick={() => set({ font })}
                    className={cn("grid gap-1 rounded-lg border px-3 py-2 text-left transition hover:bg-accent", v.font === font && "border-primary ring-2 ring-primary/30")}
                  >
                    <span className="text-2xl font-bold" style={{ fontFamily: FONT_STACKS[font].heading }}>
                      Aa
                    </span>
                    <span className="text-xs text-muted-foreground" style={{ fontFamily: FONT_STACKS[font].body }}>
                      {t(`sites.font.${font}`)}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t("sites.theme.radius")}</legend>
              <div className="flex flex-wrap gap-2">
                {RADII.map((radius) => (
                  <button
                    key={radius}
                    type="button"
                    aria-pressed={v.radius === radius}
                    onClick={() => set({ radius })}
                    className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition hover:bg-accent", v.radius === radius && "border-primary ring-2 ring-primary/30")}
                  >
                    <span className="size-5 border-2 border-current" style={{ borderRadius: radius === "none" ? 0 : `min(${RADIUS_PX[radius]}, 10px)` }} />
                    {t(`sites.radius.${radius}`)}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField label={t("store.primary")} value={v.primary} onChange={(primary) => set({ primary })} />
              <ColorField label={t("store.accent")} value={v.accent} onChange={(accent) => set({ accent })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-6 pt-6">
            <span className="text-sm font-medium">{t("look.theme.details")}</span>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("look.theme.animation")}>
                <Select value={v.animation} onValueChange={(animation) => set({ animation: animation as AnimationName })}>
                  <SelectTrigger className="w-full" aria-label={t("look.theme.animation")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANIMATIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {t(`look.animations.${a}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Segmented label={t("look.speed")} value={v.speed} options={SPEEDS} words="look.speeds" onChange={(speed) => speed && set({ speed })} />
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t("look.theme.buttons")}</legend>
              <div className="flex flex-wrap gap-2">
                {BUTTON_STYLES.map((style) => (
                  <button
                    key={style}
                    type="button"
                    aria-pressed={v.buttons === style}
                    onClick={() => set({ buttons: style })}
                    className={cn("grid justify-items-center gap-2 rounded-lg border px-3 py-2 text-xs transition hover:bg-accent", v.buttons === style && "border-primary ring-2 ring-primary/30")}
                  >
                    <span aria-hidden className={cn("px-3 py-1 text-[11px] font-semibold", BUTTON_LOOK[style])} style={{ borderRadius: style === "pill" ? 999 : style === "sharp" ? 0 : `min(${RADIUS_PX[v.radius]}, 12px)` }}>
                      Aa
                    </span>
                    {t(`look.buttons.${style}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <Segmented label={t("look.theme.headings")} value={v.headingWeight} options={HEADING_WEIGHTS} words="look.weights" onChange={(headingWeight) => headingWeight && set({ headingWeight })} />
              <label className="flex h-8 items-center gap-2 text-sm">
                <Checkbox checked={v.uppercase} onCheckedChange={(c) => set({ uppercase: c === true })} /> {t("look.theme.uppercase")}
              </label>
            </div>
            <Segmented label={t("look.theme.header")} value={v.header} options={HEADER_STYLES} words="look.headers" onChange={(header) => header && set({ header })} />
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              <Segmented label={t("look.theme.container")} value={v.container} options={CONTAINERS} words="look.containers" onChange={(container) => container && set({ container })} />
              <Segmented label={t("look.theme.hover")} value={v.hover} options={HOVERS} words="look.hovers" onChange={(hover) => hover && set({ hover })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <Field label={t("store.logo")}>
              <ImagePick value={v.logoId} onChange={(id) => set({ logoId: id })} images={images} label={t("store.logo")} />
            </Field>
            <Field label={t("store.tagline")}>
              <Input value={v.tagline} onChange={(e) => set({ tagline: e.target.value })} maxLength={160} />
            </Field>
          </CardContent>
        </Card>

        <div>
          <Button type="button" disabled={pending} onClick={() => run(() => saveThemeAction(storeId, { ...v, animate: v.animation !== "none" }))}>
            {t("common.save")}
          </Button>
        </div>
      </div>

      <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <MiniSite theme={v} name={name} tagline={v.tagline} large />
      </div>
    </div>
  );
}

/** How each button style looks in the small pictures. */
const BUTTON_LOOK: Record<ButtonStyle, string> = {
  solid: "bg-primary text-primary-foreground shadow",
  pill: "bg-primary text-primary-foreground shadow",
  outline: "border-2 border-primary text-primary",
  sharp: "bg-primary uppercase tracking-wider text-primary-foreground shadow-[2px_2px_0_0_rgba(0,0,0,0.3)]",
};
const WEIGHT: Record<Theme["headingWeight"], number> = { medium: 500, bold: 700, black: 900 };

/** The site in miniature, in the theme's colours, fonts, corners, headings and buttons — for choosing before saving. */
export function MiniSite({ theme, name, tagline, large }: { theme: Theme; name: string; tagline?: string; large?: boolean }) {
  const fonts = FONT_STACKS[theme.font];
  const heading = { fontFamily: fonts.heading, fontWeight: WEIGHT[theme.headingWeight], textTransform: theme.uppercase ? "uppercase" : undefined } as React.CSSProperties;
  const outline = theme.buttons === "outline";
  return (
    <div
      aria-hidden
      style={{ ...themeVars(theme), fontFamily: fonts.body } as React.CSSProperties}
      className={cn("overflow-hidden rounded-md border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-fg)]", large ? "text-sm shadow-xl" : "text-[9px]")}
    >
      <div className={cn("flex items-center border-b border-[var(--site-border)]", theme.header === "centered" ? "justify-center" : "justify-between", large ? "px-4 py-3" : "px-2 py-1.5")}>
        <span className="truncate" style={heading}>
          {name}
        </span>
        {theme.header !== "centered" && (
          <span className="flex gap-1">
            <span className={cn("rounded-full bg-current opacity-30", large ? "h-1.5 w-8" : "h-1 w-3")} />
            <span className={cn("rounded-full bg-current opacity-30", large ? "h-1.5 w-8" : "h-1 w-3")} />
          </span>
        )}
      </div>
      <div
        className={cn("grid justify-items-center gap-2 text-center text-[var(--site-on-primary)]", large ? "px-6 py-12" : "px-2 py-4")}
        style={{ backgroundImage: "linear-gradient(120deg, var(--shop-primary), var(--shop-accent))" }}
      >
        <span className={cn("leading-tight", large ? "text-3xl" : "text-xs")} style={heading}>
          {name}
        </span>
        {large && tagline && <span className="max-w-xs opacity-85">{tagline}</span>}
        <span
          className={cn(
            "font-semibold",
            outline ? "border-2 border-current" : "bg-[var(--shop-accent)] text-[var(--site-on-accent)] shadow",
            theme.buttons === "sharp" && "uppercase tracking-wider",
            large ? "mt-2 px-5 py-2" : "px-2 py-0.5",
          )}
          style={{ borderRadius: theme.buttons === "pill" ? 999 : theme.buttons === "sharp" ? 0 : "min(var(--site-radius), 12px)" }}
        >
          →
        </span>
      </div>
      <div className={cn("grid grid-cols-3 bg-[var(--site-soft)]", large ? "gap-3 p-4" : "gap-1 p-1.5")}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={cn("grid gap-1 rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-card)]", large ? "p-3" : "p-1")}>
            <span className={cn("rounded-full bg-[var(--shop-accent)]", large ? "size-5" : "size-2")} />
            <span className={cn("rounded-full bg-current opacity-60", large ? "h-1.5 w-3/4" : "h-0.5 w-3/4")} />
            {large && <span className="h-1.5 w-1/2 rounded-full bg-current opacity-25" />}
          </div>
        ))}
      </div>
    </div>
  );
}
