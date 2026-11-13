/**
 * The fonts of the websites, served by this app itself: a visitor's browser
 * never asks a font service. Each font is only a name until a site uses it,
 * so a page loads the two fonts of its own pair and nothing else.
 */
import { Lora, Manrope, Nunito, Playfair_Display, PT_Serif, Unbounded } from "next/font/google";
import type { FontPair } from "@/lib/site";

const manrope = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-site-manrope", display: "swap", preload: false });
const playfair = Playfair_Display({ subsets: ["latin", "cyrillic"], variable: "--font-site-playfair", display: "swap", preload: false });
const lora = Lora({ subsets: ["latin", "cyrillic"], variable: "--font-site-lora", display: "swap", preload: false });
const nunito = Nunito({ subsets: ["latin", "cyrillic"], variable: "--font-site-nunito", display: "swap", preload: false });
const unbounded = Unbounded({ subsets: ["latin", "cyrillic"], variable: "--font-site-unbounded", display: "swap", preload: false });
const ptSerif = PT_Serif({ subsets: ["latin", "cyrillic"], weight: ["400", "700"], variable: "--font-site-ptserif", display: "swap", preload: false });

/** The variables of all fonts, set once around a site. */
export const FONT_VARIABLES = [manrope, playfair, lora, nunito, unbounded, ptSerif].map((f) => f.variable).join(" ");

const SANS = "var(--font-inter), ui-sans-serif, system-ui, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

/** Headings and body text of each pair. */
export const FONT_STACKS: Record<FontPair, { heading: string; body: string }> = {
  modern: { heading: `var(--font-site-manrope), ${SANS}`, body: SANS },
  elegant: { heading: `var(--font-site-playfair), ${SERIF}`, body: SANS },
  editorial: { heading: `var(--font-site-lora), ${SERIF}`, body: `var(--font-site-lora), ${SERIF}` },
  friendly: { heading: `var(--font-site-nunito), ${SANS}`, body: `var(--font-site-nunito), ${SANS}` },
  tech: { heading: `var(--font-site-unbounded), ${SANS}`, body: SANS },
  classic: { heading: `var(--font-site-ptserif), ${SERIF}`, body: SANS },
};
