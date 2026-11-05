"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// A new film goes into a new folder: these files are cached for a year.
const BASE = "/landing/v2";
const TALL_SCREEN = "(max-width: 767px), (orientation: portrait)";
const AV1 = 'video/mp4; codecs="av01.0.12M.10"';

type Connection = { saveData?: boolean; effectiveType?: string };

/** AV1 gives the better picture for the same bytes, where the device plays it smoothly. */
async function playsAv1(width: number, height: number): Promise<boolean> {
  if (!document.createElement("video").canPlayType(AV1)) return false;
  try {
    const info = await navigator.mediaCapabilities.decodingInfo({
      type: "file",
      video: { contentType: AV1, width, height, bitrate: 3_000_000, framerate: 30 },
    });
    return info.smooth && info.powerEfficient;
  } catch {
    return false;
  }
}

/** Which file suits this screen; none on a slow line, with data saving, or for people who avoid motion. */
async function chooseFilm(): Promise<string | null> {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (connection?.saveData || connection?.effectiveType === "2g" || connection?.effectiveType === "slow-2g") return null;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const tall = window.matchMedia(TALL_SCREEN).matches;
  const name = tall ? "tall" : "wide";
  const av1 = await (tall ? playsAv1(810, 1440) : playsAv1(2560, 1440));
  return `${BASE}/${name}.${av1 ? "av1" : "h264"}.mp4`;
}

/** Resolves when the page itself has finished loading: the film never competes with it. */
function pageSettled(): Promise<void> {
  return new Promise((done) => {
    const idle = () => ("requestIdleCallback" in window ? requestIdleCallback(() => done(), { timeout: 800 }) : setTimeout(done, 150));
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  });
}

/**
 * The film behind the public pages. Its first frame is a small picture that
 * shows at once; the film is fetched after the page, takes over without a jump,
 * and only runs while it can be seen.
 */
export function BackdropVideo({ className, priority }: { className?: string; priority?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    let seen: IntersectionObserver | undefined;
    let cancelled = false;
    void (async () => {
      const [film] = await Promise.all([chooseFilm(), pageSettled()]);
      if (!film || cancelled) return;
      seen = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) {
            video.pause();
            return;
          }
          if (!video.getAttribute("src")) video.src = film;
          video.play().catch(() => {});
        },
        { rootMargin: "200px" },
      );
      seen.observe(video);
    })();
    return () => {
      cancelled = true;
      seen?.disconnect();
    };
  }, []);

  return (
    <div className={cn("absolute inset-0", className)} aria-hidden>
      <picture>
        <source media={TALL_SCREEN} srcSet={`${BASE}/poster-tall.webp`} />
        <img src={`${BASE}/poster-wide.webp`} alt="" className="absolute inset-0 size-full object-cover" fetchPriority={priority ? "high" : "auto"} loading={priority ? "eager" : "lazy"} decoding="async" />
      </picture>
      <video
        ref={ref}
        className={cn("absolute inset-0 size-full object-cover transition-opacity duration-700", playing ? "opacity-100" : "opacity-0")}
        muted
        loop
        playsInline
        preload="none"
        tabIndex={-1}
        onPlaying={() => setPlaying(true)}
      />
    </div>
  );
}
