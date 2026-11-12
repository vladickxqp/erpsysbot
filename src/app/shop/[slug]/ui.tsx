/**
 * The store's own look: fixed light colours and the company's two brand
 * colours (CSS variables set by the layout), independent of the app's theme —
 * a store looks the way its company designed it, for every visitor.
 */
import Link from "next/link";
import type { ComponentProps, CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { Design, Template } from "@/lib/store";

export const brandStyle = (design: Design) =>
  ({ "--shop-primary": design.primary, "--shop-accent": design.accent, colorScheme: "light" }) as CSSProperties;

/** Per template: page, header, cards, corners. */
export const LOOK: Record<Template, { page: string; header: string; headerText: string; card: string; hero: string; radius: string }> = {
  clean: {
    page: "bg-white text-slate-900",
    header: "border-b border-slate-200 bg-white",
    headerText: "text-slate-900",
    card: "border border-slate-200 bg-white",
    hero: "bg-slate-50 text-slate-900",
    radius: "rounded-md",
  },
  bold: {
    page: "bg-white text-slate-900",
    header: "bg-[var(--shop-primary)]",
    headerText: "text-white",
    card: "border border-slate-200 bg-white",
    hero: "bg-[var(--shop-primary)] text-white",
    radius: "rounded-none",
  },
  soft: {
    page: "bg-stone-50 text-stone-900",
    header: "bg-stone-50",
    headerText: "text-stone-900",
    card: "bg-white shadow-sm",
    hero: "bg-white text-stone-900",
    radius: "rounded-2xl",
  },
};

export function ShopButton({ className, variant = "primary", ...props }: ComponentProps<"button"> & { variant?: "primary" | "outline" | "ghost" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-opacity disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-[var(--shop-accent)] text-white hover:opacity-90",
        variant === "outline" && "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
        variant === "ghost" && "text-slate-700 hover:bg-slate-100",
        className,
      )}
    />
  );
}

export function ShopLinkButton({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={cn("inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--shop-accent)] px-4 text-sm font-medium text-white hover:opacity-90", className)}
    />
  );
}

export const fieldClass =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--shop-accent)] focus:ring-2 focus:ring-[var(--shop-accent)]/20";

export function ShopField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("grid gap-1.5 text-sm", className)}>
      <span className="font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

/** A company picture as the store may show it. */
export function ShopImage({ slug, id, alt, className }: { slug: string; id: string | null; alt: string; className?: string }) {
  if (!id) return <div className={cn("bg-slate-100", className)} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/shop/${slug}/img/${id}`} alt={alt} loading="lazy" className={cn("object-cover", className)} />;
}

/** Text the company wrote: shown as typed, line breaks kept, never as markup. */
export function PlainText({ text, className }: { text: string; className?: string }) {
  return <div className={cn("whitespace-pre-wrap break-words leading-relaxed", className)}>{text}</div>;
}
