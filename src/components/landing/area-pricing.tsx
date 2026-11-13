"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PriceCard = { id: string; name: string; price: string; lines: string[]; featured: boolean };
export type PriceShelf = { key: string; label: string; plans: PriceCard[] };

/** The price list by area: one shelf at a time, the plans of that area side by side. */
export function AreaPricing({ shelves, month, choose, href }: { shelves: PriceShelf[]; month: string; choose: string; href: string }) {
  const [open, setOpen] = useState(shelves[0]?.key ?? "");
  const shelf = shelves.find((s) => s.key === open) ?? shelves[0];
  if (!shelf) return null;
  return (
    <div className="mx-auto mt-14 grid max-w-5xl gap-8">
      <div role="tablist" className="mx-auto flex flex-wrap justify-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
        {shelves.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={s.key === shelf.key}
            onClick={() => setOpen(s.key)}
            className={cn("rounded-full px-4 py-1.5 text-sm font-medium text-white/60 transition-colors hover:text-white", s.key === shelf.key && "bg-primary text-white shadow-[0_0_20px_-4px] shadow-primary")}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className={cn("grid items-stretch gap-5", shelf.plans.length > 1 && "md:grid-cols-2", shelf.plans.length > 2 && "lg:grid-cols-3")}>
        {shelf.plans.map((plan) => (
          <article key={plan.id} className={cn("lift relative flex h-full flex-col rounded-3xl p-7 sm:p-8", plan.featured ? "plan-featured" : "glass")}>
            <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
            <p className="mt-4 flex items-baseline gap-1.5">
              <span className="text-5xl font-semibold tracking-tight text-white">{plan.price}</span>
              <span className="text-white/50">/ {month}</span>
            </p>
            <ul className="mt-7 grid flex-1 content-start gap-2.5 text-sm text-white/80">
              {plan.lines.map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-cyan-300" aria-hidden /> {line}
                </li>
              ))}
            </ul>
            <Button asChild size="lg" variant={plan.featured ? "default" : "outline"} className="mt-8 h-11 rounded-full">
              <Link href={href}>{choose}</Link>
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}
