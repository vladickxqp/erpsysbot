import type { CSSProperties } from "react";
import { themeVars, type Theme } from "@/lib/site";
import { FONT_STACKS } from "./fonts";

/** The site's theme as the CSS variables its parts read (src/app/shop/[slug]/ui.tsx, site.css). */
export function themeStyle(theme: Theme): CSSProperties {
  const fonts = FONT_STACKS[theme.font];
  return {
    ...themeVars(theme),
    "--site-heading-font": fonts.heading,
    "--site-body-font": fonts.body,
    colorScheme: theme.mode,
  } as CSSProperties;
}
