/**
 * The video studio's fixed lists and shapes, shared by the editor and the
 * server. A video is a row of scenes — a picture, a clip or a plain card in
 * the video's colour, each with its seconds and a text on it — with music
 * and a voice track under them, put together into one MP4.
 */

/** Upright for Reels, Shorts and TikTok; across for YouTube; square for feeds. */
export const VIDEO_FORMATS = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
} as const;
export type VideoFormat = keyof typeof VIDEO_FORMATS;
export const FORMAT_NAMES = Object.keys(VIDEO_FORMATS) as VideoFormat[];

export const TEXT_POSITIONS = ["top", "center", "bottom"] as const;
export type TextPosition = (typeof TEXT_POSITIONS)[number];

/** What a picture does while it is shown. */
export const SCENE_EFFECTS = ["none", "zoomIn", "zoomOut"] as const;
export type SceneEffect = (typeof SCENE_EFFECTS)[number];

/** How one scene follows the next: at once, or through black. */
export const TRANSITIONS = ["cut", "fade"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export const VIDEO_STATUSES = ["DRAFT", "RENDERING", "READY", "FAILED"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export type Scene = {
  id: string;
  /** A picture or clip of the company's media; none: a card in the video's colour. */
  mediaId: string | null;
  seconds: number;
  text: string;
  position: TextPosition;
  effect: SceneEffect;
  /** A clip keeps its own sound. */
  sound: boolean;
  /** What to show here, as a note for whoever picks the picture (from the AI's plan). */
  note?: string;
};

export const MAX_SCENES = 30;
export const MIN_SCENE_SECONDS = 1;
export const MAX_SCENE_SECONDS = 30;
/** The whole video, in seconds. */
export const MAX_VIDEO_SECONDS = 180;
export const MAX_SCENE_TEXT = 240;

export const totalSeconds = (scenes: readonly Pick<Scene, "seconds">[]) => scenes.reduce((sum, s) => sum + s.seconds, 0);

/** 75 → "1:15". */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;

/**
 * A text as the lines it takes on the picture: broken at spaces so no line
 * runs past `perLine` characters, at most `maxLines` (the rest is cut with
 * an ellipsis). Line breaks the person typed are kept.
 */
export function wrapText(text: string, perLine: number, maxLines = 6): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      // A word longer than a line is cut into pieces.
      const pieces = word.length > perLine ? (word.match(new RegExp(`.{1,${perLine}}`, "gu")) ?? [word]) : [word];
      for (const piece of pieces) {
        if (line && line.length + 1 + piece.length > perLine) {
          lines.push(line);
          line = piece;
        } else line = line ? `${line} ${piece}` : piece;
      }
    }
    if (line) lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(1, perLine - 1))}…`;
  return kept;
}

/** The size of the letters on a video of this width and height, and how many fit in a line. */
export function textMetrics(width: number, height: number): { fontSize: number; perLine: number } {
  const fontSize = Math.round(Math.min(width, height) * 0.058);
  // DejaVu Sans Bold runs about two thirds of its size per letter; the text keeps a margin on each side.
  return { fontSize, perLine: Math.max(8, Math.floor((width * 0.82) / (fontSize * 0.66))) };
}
