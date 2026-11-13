"use client";

import { useEffect, useRef } from "react";
import type { AnimationName, Speed } from "@/lib/site";

/**
 * A section that comes into view the first time it scrolls in: faded,
 * from a side, zoomed, blurred or tilted (site.css), at its speed and
 * after its delay; with `stagger` its entries follow one after another.
 * What is on screen when the page opens stays as it is, and without
 * JavaScript or with reduced motion everything is simply shown.
 */
export function Reveal({
  children,
  animation = "up",
  speed = "normal",
  delay = 0,
  stagger = false,
  className,
}: {
  children: React.ReactNode;
  animation?: Exclude<AnimationName, "none">;
  speed?: Speed;
  delay?: number;
  stagger?: boolean;
  className?: string;
}) {
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
        el.setAttribute("data-shown", "");
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
    <div
      ref={ref}
      className={className ? `site-reveal ${className}` : "site-reveal"}
      data-anim={animation}
      data-speed={speed}
      data-stagger={stagger ? "" : undefined}
      style={delay ? ({ "--site-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
