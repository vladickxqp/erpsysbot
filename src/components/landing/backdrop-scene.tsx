"use client";

import { useEffect, useRef, useState } from "react";
import { animate, createScene } from "@/components/landing/backdrop-gl";
import { cn } from "@/lib/utils";

// A new picture goes into a new folder: these files are cached for a year.
const BASE = "/landing/v4";
const TALL_SCREEN = "(max-width: 767px), (orientation: portrait)";
const WIDE_SIZES = [1920, 2560, 3840, 7680];
const TALL_SIZES = [720, 1440, 2160];
const sizes = (name: string, widths: number[]) => widths.map((width) => `${BASE}/${name}-${width}.webp ${width}w`).join(", ");

/** Resolves when the page itself has finished loading: the scene never competes with it. */
function pageSettled(): Promise<void> {
  return new Promise((done) => {
    const idle = () => ("requestIdleCallback" in window ? requestIdleCallback(() => done(), { timeout: 800 }) : setTimeout(done, 150));
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  });
}

/**
 * The landscape behind the public pages. A picture of it, as large as the screen
 * needs, shows at once; the live scene takes over at the screen's own resolution
 * and only runs while it can be seen. The picture stays for people who avoid
 * motion and where the device is too slow.
 */
export function BackdropScene({ className, priority }: { className?: string; priority?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let dispose = () => {};

    void pageSettled().then(() => {
      if (cancelled) return;
      let runner: ReturnType<typeof animate> | undefined;
      const seen = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) {
            runner?.stop();
            return;
          }
          if (!runner) {
            const small = window.matchMedia("(pointer: coarse)").matches;
            const scene = createScene(canvas, { small });
            if (!scene) {
              seen.disconnect();
              return;
            }
            runner = animate(scene, { small, started: () => setLive(true), gaveUp: () => hide() });
            dispose = () => {
              runner?.stop();
              seen.disconnect();
              canvas.removeEventListener("webglcontextlost", hide);
              scene.dispose();
            };
          }
          runner.start();
        },
        { rootMargin: "200px" },
      );
      const hide = () => {
        runner?.stop();
        seen.disconnect();
        setLive(false);
      };
      canvas.addEventListener("webglcontextlost", hide);
      dispose = () => {
        seen.disconnect();
        canvas.removeEventListener("webglcontextlost", hide);
      };
      seen.observe(canvas);
    });

    return () => {
      cancelled = true;
      dispose();
    };
  }, []);

  return (
    <div className={cn("absolute inset-0", className)} aria-hidden>
      <picture>
        <source media={TALL_SCREEN} srcSet={sizes("tall", TALL_SIZES)} sizes="100vw" />
        <img src={`${BASE}/wide-1920.webp`} srcSet={sizes("wide", WIDE_SIZES)} sizes="100vw" alt="" className="absolute inset-0 size-full object-cover" fetchPriority={priority ? "high" : "auto"} loading={priority ? "eager" : "lazy"} decoding="async" />
      </picture>
      <canvas ref={ref} className={cn("absolute inset-0 size-full transition-opacity duration-700", live ? "opacity-100" : "opacity-0")} />
    </div>
  );
}
