/**
 * The ffmpeg command that puts a video together (src/lib/video.ts), as
 * arguments and one filter graph — nothing here runs anything, so it can be
 * read and tested as it is.
 *
 * Each scene becomes a piece of exactly its seconds at the video's size and
 * 30 pictures a second: a picture is fitted, cropped and, when asked, slowly
 * zoomed; a clip is fitted, cropped and held on its last picture if it is
 * shorter; no picture at all is a card in the video's colour. The scene's
 * text is drawn from a file as it is (so no character can break the command
 * or be read as one of ffmpeg's own variables), in
 * DejaVu Sans Bold on a dark plate. The pieces follow each other at once or
 * through black. Under them run the clips' own sound (silence elsewhere),
 * the music — as long as the video, faded out — and the voice track.
 */
import { textMetrics, VIDEO_FORMATS, wrapText, type Scene, type Transition, type VideoFormat } from "@/lib/video";

export type PlanScene = Pick<Scene, "seconds" | "text" | "position" | "effect" | "sound"> & {
  /** The scene's picture or clip; none: a card in the video's colour. */
  file: { path: string; kind: "image" | "video"; hasAudio?: boolean } | null;
};

export type PlanInput = {
  format: VideoFormat;
  scenes: PlanScene[];
  transition: Transition;
  /** #rrggbb: the cards without a picture. */
  color: string;
  /** Volume in percent. */
  music: { path: string; volume: number } | null;
  voice: { path: string } | null;
  /** The font file for the texts. */
  font: string;
  /** A folder for the scenes' texts. */
  workDir: string;
  out: string;
};

export type Plan = { args: string[]; filter: string; texts: { path: string; text: string }[]; seconds: number };

export const FPS = 30;
const FADE = 0.35;
const AUDIO = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";

/** A path as the value of a filter option: forward slashes, colons and quotes escaped. */
const quoted = (p: string) => `'${p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''")}'`;
const even = (n: number) => Math.round(n / 2) * 2;
const seconds = (n: number) => String(Math.round(n * 100) / 100);

export function renderPlan(input: PlanInput): Plan {
  const { width: W, height: H } = VIDEO_FORMATS[input.format];
  const { fontSize, perLine } = textMetrics(W, H);
  const n = input.scenes.length;
  const total = input.scenes.reduce((sum, s) => sum + s.seconds, 0);
  const args: string[] = ["-hide_banner", "-nostdin", "-y"];
  const chains: string[] = [];
  const texts: Plan["texts"] = [];
  let at = 0;

  input.scenes.forEach((scene, i) => {
    const d = scene.seconds;
    const frames = Math.max(1, Math.round(d * FPS));
    const parts: string[] = [];
    if (!scene.file) {
      args.push("-f", "lavfi", "-t", seconds(d), "-i", `color=c=0x${input.color.replace(/^#/, "")}:s=${W}x${H}:r=${FPS}`);
      parts.push(`[${at}:v]format=yuv420p`);
    } else if (scene.file.kind === "image") {
      args.push("-i", scene.file.path);
      const zoom = scene.effect === "zoomIn" ? `1+0.18*on/${frames}` : scene.effect === "zoomOut" ? `1.18-0.18*on/${frames}` : "1";
      // A zoom is worked on a larger picture, so it does not shake.
      const scale = scene.effect === "none" ? 1 : 1.5;
      const bw = even(W * scale);
      const bh = even(H * scale);
      parts.push(
        `[${at}:v]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},setsar=1`,
        `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`,
        "format=yuv420p",
      );
    } else {
      args.push("-t", seconds(d), "-i", scene.file.path);
      parts.push(`[${at}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p`, `tpad=stop_mode=clone:stop_duration=${seconds(d)}`);
    }
    const lines = wrapText(scene.text, perLine);
    if (lines.length) {
      const file = `${input.workDir.replace(/\\/g, "/")}/text-${i}.txt`;
      texts.push({ path: file, text: lines.join("\n") });
      const y = scene.position === "top" ? "h*0.12" : scene.position === "center" ? "(h-text_h)/2" : "h*0.86-text_h";
      parts.push(
        `drawtext=fontfile=${quoted(input.font)}:textfile=${quoted(file)}:expansion=none:text_align=C:fontsize=${fontSize}:fontcolor=white:line_spacing=${Math.round(fontSize * 0.28)}:box=1:boxcolor=black@0.5:boxborderw=${Math.round(fontSize * 0.5)}:x=(w-text_w)/2:y=${y}`,
      );
    }
    if (input.transition === "fade" && n > 1) {
      if (i > 0) parts.push(`fade=t=in:st=0:d=${FADE}`);
      if (i < n - 1) parts.push(`fade=t=out:st=${seconds(Math.max(0, d - FADE))}:d=${FADE}`);
    }
    parts.push(`trim=duration=${seconds(d)}`, "setpts=PTS-STARTPTS");
    chains.push(`${parts.join(",")}[v${i}]`);
    // The clip's own sound, or silence of the same length.
    chains.push(
      scene.file?.kind === "video" && scene.sound && scene.file.hasAudio
        ? `[${at}:a]${AUDIO},apad,atrim=duration=${seconds(d)},asetpts=PTS-STARTPTS[a${i}]`
        : `anullsrc=r=44100:cl=stereo,atrim=duration=${seconds(d)},asetpts=PTS-STARTPTS[a${i}]`,
    );
    at++;
  });

  chains.push(`${input.scenes.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[vout][acat]`);
  const mix = ["[acat]"];
  if (input.music) {
    args.push("-stream_loop", "-1", "-i", input.music.path);
    const volume = Math.min(1, Math.max(0, input.music.volume / 100)).toFixed(2);
    chains.push(`[${at}:a]${AUDIO},volume=${volume},atrim=duration=${seconds(total)},afade=t=out:st=${seconds(Math.max(0, total - 1.5))}:d=1.5[music]`);
    mix.push("[music]");
    at++;
  }
  if (input.voice) {
    args.push("-i", input.voice.path);
    chains.push(`[${at}:a]${AUDIO},atrim=duration=${seconds(total)}[voice]`);
    mix.push("[voice]");
    at++;
  }
  if (mix.length > 1) chains.push(`${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0[aout]`);
  const filter = chains.join(";");
  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    mix.length > 1 ? "[aout]" : "[acat]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "24",
    "-maxrate",
    "4M",
    "-bufsize",
    "8M",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-t",
    seconds(total),
    "-progress",
    "pipe:1",
    "-nostats",
    input.out,
  );
  return { args, filter, texts, seconds: total };
}

/** How far a render is, in percent, from what ffmpeg reports on its progress pipe. */
export function progressOf(report: string, total: number): number | null {
  const all = [...report.matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  if (!all.length || total <= 0) return null;
  return Math.max(0, Math.min(99, Math.round((Number(all[all.length - 1][1]) / 1_000_000 / total) * 100)));
}
