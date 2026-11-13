"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** The menu on small screens: opens without JavaScript, closes again on the next page. */
export function MobileMenu({ label, items }: { label: string; items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  return (
    <details ref={ref} className="relative md:hidden">
      <summary aria-label={label} className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md hover:bg-[var(--site-soft)] [&::-webkit-details-marker]:hidden">
        <Menu className="size-5" />
      </summary>
      <nav aria-label={label} className="absolute right-0 top-full z-40 mt-2 grid w-64 gap-1 rounded-xl border border-[var(--site-border)] bg-[var(--site-card)] p-2 text-sm shadow-xl">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="rounded-md px-3 py-2.5 font-medium hover:bg-[var(--site-soft)]">
            {item.label}
          </Link>
        ))}
      </nav>
    </details>
  );
}
