/**
 * The site's own look: its theme's colours, corners and fonts as CSS
 * variables (set by the layout from src/app/shop/[slug]/theme.ts),
 * independent of the app's theme — a site looks the way its company
 * designed it, for every visitor.
 */
import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Page, header, cards, soft areas, corners. */
export const LOOK = {
  page: "bg-[var(--site-bg)] text-[var(--site-fg)]",
  header: "sticky top-0 z-30 border-b border-[var(--site-border)] bg-[var(--site-bg)]/85 backdrop-blur-md",
  headerText: "text-[var(--site-fg)]",
  card: "border border-[var(--site-border)] bg-[var(--site-card)]",
  hero: "bg-[var(--site-soft)] text-[var(--site-fg)]",
  radius: "rounded-[var(--site-radius)]",
};

export function ShopButton({ className, variant = "primary", ...props }: ComponentProps<"button"> & { variant?: "primary" | "outline" | "ghost" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-[min(var(--site-radius),12px)] px-4 text-sm font-medium transition-opacity disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-[var(--shop-accent)] text-[var(--site-on-accent)] hover:opacity-90",
        variant === "outline" && "border border-[var(--site-border)] bg-[var(--site-card)] text-[var(--site-fg)] hover:bg-[var(--site-soft)]",
        variant === "ghost" && "text-[var(--site-fg)] hover:bg-[var(--site-soft)]",
        className,
      )}
    />
  );
}

export function ShopLinkButton({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-[min(var(--site-radius),12px)] bg-[var(--shop-accent)] px-4 text-sm font-medium text-[var(--site-on-accent)] hover:opacity-90",
        className,
      )}
    />
  );
}

export const fieldClass =
  "h-10 w-full rounded-[min(var(--site-radius),10px)] border border-[var(--site-border)] bg-[var(--site-card)] px-3 text-sm text-[var(--site-fg)] outline-none placeholder:text-[var(--site-muted)] focus:border-[var(--shop-accent)] focus:ring-2 focus:ring-[var(--shop-accent)]/20";

export function ShopField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("grid gap-1.5 text-sm", className)}>
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

/** A company picture as the site may show it. */
export function ShopImage({ slug, id, alt, className }: { slug: string; id: string | null; alt: string; className?: string }) {
  if (!id) return <div className={cn("bg-[var(--site-soft)]", className)} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/shop/${slug}/img/${id}`} alt={alt} loading="lazy" className={cn("object-cover", className)} />;
}

/** Text the company wrote: shown as typed, line breaks kept, never as markup. */
export function PlainText({ text, className }: { text: string; className?: string }) {
  return <div className={cn("whitespace-pre-wrap break-words leading-relaxed", className)}>{text}</div>;
}
