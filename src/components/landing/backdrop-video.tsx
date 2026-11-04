"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** The looping film behind the public pages. Silent, decorative, and only running while it can be seen. */
export function BackdropVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) video.play().catch(() => {});
      else video.pause();
    });
    seen.observe(video);
    return () => seen.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      className={cn("absolute inset-0 size-full object-cover", className)}
      src="/landing/hero.mp4"
      poster="/landing/hero.jpg"
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden
      tabIndex={-1}
    />
  );
}
