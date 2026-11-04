"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fades and lifts its content in, once, when it scrolls into view. */
export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        seen.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    seen.observe(element);
    return () => seen.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("reveal", className)} data-shown={shown || undefined} style={{ "--delay": `${delay}ms` } as React.CSSProperties}>
      {children}
    </div>
  );
}

/** Writes how far the element has travelled through the window (0 to 1) into `--progress`. */
function useScrollProgress(ref: React.RefObject<HTMLElement | null>, measure: (box: DOMRect, height: number) => number) {
  useEffect(() => {
    const element = ref.current;
    if (!element || calm()) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const value = Math.min(1, Math.max(0, measure(element.getBoundingClientRect(), window.innerHeight)));
      element.style.setProperty("--progress", value.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref, measure]);
}

const leavingTop = (box: DOMRect) => -box.top / box.height;
const enteringFromBelow = (box: DOMRect, height: number) => (height - box.top) / (height * 0.8);

/** The opening screen: drifts away and dims as the page moves on. */
export function HeroScroll({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useScrollProgress(ref, leavingTop);
  return (
    <section ref={ref} className={cn("hero", className)}>
      {children}
    </section>
  );
}

/** Stands up from a tilt while it comes into view. */
export function ScrollTilt({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollProgress(ref, enteringFromBelow);
  return (
    <div ref={ref} className={cn("tilt", className)}>
      {children}
    </div>
  );
}
