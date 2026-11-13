"use client";

import { useEffect, useRef } from "react";

/**
 * A section that floats in the first time it scrolls into view. What is on
 * screen when the page opens stays as it is, and without JavaScript or with
 * reduced motion everything is simply shown.
 */
export function Reveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    el.setAttribute("data-hidden", "");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        el.removeAttribute("data-hidden");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      el.removeAttribute("data-hidden");
    };
  }, []);
  return (
    <div ref={ref} className="site-reveal">
      {children}
    </div>
  );
}
