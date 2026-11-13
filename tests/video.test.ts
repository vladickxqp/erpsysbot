import type Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { clock, textMetrics, wrapText, type Scene } from "@/lib/video";
import { deleteDocument, listMedia, storeDocument } from "@/server/documents";
import { createVideo, deleteVideo, getVideo, listVideos, planVideo, renderVideo, saveVideo, videoAvailable, type Encoder, type VideoInput } from "@/server/video";
import { progressOf, renderPlan } from "@/server/video-plan";
import { newCompany, newMember } from "./helpers";

const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
/** The first bytes of an MP4, enough to be taken for one. */
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32]);
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);

const scene = (patch: Partial<Scene> = {}): Scene => ({ id: Math.random().toString(36).slice(2), mediaId: null, seconds: 3, text: "", position: "bottom", effect: "none", sound: true, ...patch });
const input = (patch: Partial<VideoInput> = {}): VideoInput => ({ title: "Clip", format: "portrait", transition: "fade", color: "#112233", scenes: [scene({ text: "Hallo" })], musicId: null, musicVolume: 30, voiceId: null, ...patch });

describe("the words on a video", () => {
  it("are broken into lines that fit, and cut when there are too many", () => {
    expect(wrapText("eins zwei drei vier", 9)).toEqual(["eins zwei", "drei vier"]);
    expect(wrapText("Zeile\n\nneu", 20)).toEqual(["Zeile", "neu"]);
    expect(wrapText("Donaudampfschifffahrt", 8)).toEqual(["Donaudam", "pfschiff", "fahrt"]);
    expect(wrapText("a b c d e f", 1, 3)).toEqual(["a", "b", "c…"]);
    expect(textMetrics(1080, 1920).perLine).toBeGreaterThan(15);
    expect(textMetrics(1920, 1080).perLine).toBeGreaterThan(textMetrics(1080, 1920).perLine);
    expect([clock(0), clock(75), clock(180)]).toEqual(["0:00", "1:15", "3:00"]);
  });
});

describe("the command that puts a video together", () => {
  const plan = renderPlan({
    format: "portrait",
    transition: "fade",
    color: "#1d4ed8",
    font: "/app/assets/fonts/DejaVuSans-Bold.ttf",
    workDir: "/tmp/v",
    out: "/tmp/v/out.mp4",
    music: { path: "/u/music.mp3", volume: 30 },
    voice: { path: "/u/voice.m4a" },
    scenes: [
      { file: null, seconds: 2, text: "100 % 'echt': {wow}", position: "center", effect: "none", sound: false },
      { file: { path: "/u/photo.png", kind: "image" }, seconds: 3, text: "Ein längerer Text, der über mehrere Zeilen laufen muss", position: "bottom", effect: "zoomIn", sound: false },
      { file: { path: "/u/clip.mp4", kind: "video", hasAudio: true }, seconds: 2.5, text: "", position: "top", effect: "none", sound: true },
      { file: { path: "/u/still.mp4", kind: "video", hasAudio: false }, seconds: 1, text: "", position: "top", effect: "none", sound: true },
    ],
  });

  it("gives every scene its input, its length and its sound", () => {
    expect(plan.seconds).toBe(8.5);
    const args = plan.args.join(" ");
    expect(args).toContain("-f lavfi -t 2 -i color=c=0x1d4ed8:s=1080x1920:r=30");
    expect(args).toContain("-i /u/photo.png");
    expect(args).toContain("-t 2.5 -i /u/clip.mp4");
    expect(args).toContain("-stream_loop -1 -i /u/music.mp3");
    expect(args).toContain("-map [vout] -map [aout]");
    expect(args).toContain("-t 8.5");
    expect(plan.args[plan.args.length - 1]).toBe("/tmp/v/out.mp4");
    // A zoom over the whole scene, the clip held to its length, sound from the clip that has some and silence elsewhere.
    expect(plan.filter).toContain("zoompan=z='1+0.18*on/90'");
    expect(plan.filter).toContain("tpad=stop_mode=clone:stop_duration=2.5");
    expect(plan.filter).toContain("[2:a]aresample=44100");
    expect(plan.filter.match(/anullsrc/g)).toHaveLength(3);
    expect(plan.filter).toContain("concat=n=4:v=1:a=1[vout][acat]");
    expect(plan.filter).toContain("volume=0.30");
    expect(plan.filter).toContain("[acat][music][voice]amix=inputs=3:duration=first:normalize=0[aout]");
    // Through black between scenes: no fade into the first, none out of the last.
    expect(plan.filter.match(/,fade=t=in/g)).toHaveLength(3);
    expect(plan.filter.match(/,fade=t=out:st=/g)).toHaveLength(3);
  });

  it("draws the words from files, as they are", () => {
    expect(plan.texts.map((t) => t.path)).toEqual(["/tmp/v/text-0.txt", "/tmp/v/text-1.txt"]);
    expect(plan.texts[0].text).toBe("100 % 'echt': {wow}");
    expect(plan.texts[1].text.split("\n").length).toBeGreaterThan(1);
    expect(plan.filter).toContain("textfile='/tmp/v/text-0.txt':expansion=none:text_align=C");
    expect(plan.filter).not.toContain("echt");
    expect(plan.filter.match(/drawtext=/g)).toHaveLength(2);
  });

  it("needs no mixing without music and voice, and reads how far ffmpeg is", () => {
    const quiet = renderPlan({ format: "square", transition: "cut", color: "#000000", font: "f.ttf", workDir: "C:\\tmp\\v", out: "o.mp4", music: null, voice: null, scenes: [{ file: null, seconds: 2, text: "A", position: "top", effect: "none", sound: true }] });
    expect(quiet.args.join(" ")).toContain("-map [vout] -map [acat]");
    expect(quiet.filter).not.toContain("amix");
    expect(quiet.filter).not.toContain(",fade=");
    expect(quiet.filter).toContain("textfile='C\\:/tmp/v/text-0.txt'");
    expect(progressOf("frame=10\nout_time_us=2000000\nprogress=continue\nout_time_us=4250000\n", 8.5)).toBe(50);
    expect(progressOf("out_time_us=99000000\n", 8.5)).toBe(99);
    expect(progressOf("frame=1\n", 8.5)).toBeNull();
  });
});

describe("videos of the studio", () => {
  it("are made, checked and kept by those who manage content", async () => {
    const ctx = await newCompany("Film GmbH");
    const viewer = await newMember(ctx, "VIEWER");
    await expect(createVideo(viewer, { title: "Nein" })).rejects.toMatchObject({ permission: "content.manage" });
    const video = await createVideo(ctx, { title: "Erster Clip", format: "landscape" });
    expect(video).toMatchObject({ title: "Erster Clip", format: "landscape", status: "DRAFT", seconds: 3 });
    expect(video.scenes).toMatchObject([{ text: "Erster Clip", mediaId: null, position: "center" }]);

    const photo = await storeDocument(ctx, { name: "foto.png", bytes: PNG });
    const song = await storeDocument(ctx, { name: "lied.mp3", bytes: MP3 });
    const paper = await storeDocument(ctx, { name: "x.txt", bytes: new TextEncoder().encode("kein Bild") });
    const other = await newCompany("Fremd GmbH");
    const foreign = await storeDocument(other, { name: "fremd.png", bytes: PNG });

    const saved = await saveVideo(ctx, video.id, input({ scenes: [scene({ mediaId: photo.id, seconds: 2.26, text: "  Hallo  ", effect: "zoomIn" }), scene({ seconds: 4 })], musicId: song.id }));
    expect(saved).toMatchObject({ seconds: 6.5, musicId: song.id, status: "DRAFT" });
    expect(saved.scenes[0]).toMatchObject({ mediaId: photo.id, seconds: 2.5, text: "Hallo", effect: "zoomIn" });
    await expect(saveVideo(ctx, video.id, input({ scenes: [scene({ mediaId: foreign.id })] }))).rejects.toMatchObject({ code: "MEDIA" });
    await expect(saveVideo(ctx, video.id, input({ scenes: [scene({ mediaId: paper.id })] }))).rejects.toMatchObject({ code: "MEDIA" });
    await expect(saveVideo(ctx, video.id, input({ musicId: photo.id }))).rejects.toMatchObject({ code: "MEDIA" });
    await expect(saveVideo(ctx, video.id, input({ scenes: Array.from({ length: 7 }, () => scene({ seconds: 30 })) }))).rejects.toMatchObject({ code: "TOO_LONG" });
    await expect(saveVideo(other, video.id, input())).rejects.toThrow();

    expect((await listVideos(viewer)).map((v) => v.title)).toEqual(["Clip"]);
    await deleteVideo(ctx, video.id);
    expect(await listVideos(ctx)).toEqual([]);
  });

  it("are rendered after the request: the file lands in the media library, a failure is told", async () => {
    const ctx = await newCompany("Render GmbH");
    const photo = await storeDocument(ctx, { name: "foto.png", bytes: PNG });
    const gone = await storeDocument(ctx, { name: "weg.png", bytes: PNG });
    const video = await createVideo(ctx, { title: "Mein/Video" });
    await saveVideo(ctx, video.id, input({ title: "Mein/Video", scenes: [scene({ mediaId: photo.id, text: "Bild" }), scene({ mediaId: gone.id, text: "Weg" })] }));
    await deleteDocument(ctx, gone.id);

    const seen: { inputs: string; texts: string[] } = { inputs: "", texts: [] };
    // The encoder waits until the test has looked at the render under way.
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake: Encoder = async (plan, progress) => {
      seen.inputs = plan.args.join(" ");
      for (const t of plan.texts) seen.texts.push(await readFile(t.path, "utf8"));
      progress(40);
      await gate;
      await writeFile(plan.args[plan.args.length - 1], MP4);
    };
    const { finished } = await renderVideo(ctx, video.id, fake);
    expect((await getVideo(ctx, video.id)).status).toBe("RENDERING");
    await expect(renderVideo(ctx, video.id, fake)).rejects.toMatchObject({ code: "BUSY" });
    release();
    await finished;
    const done = await getVideo(ctx, video.id);
    expect(done).toMatchObject({ status: "READY", progress: 100, error: null });
    expect(seen.texts).toEqual(["Bild", "Weg"]);
    // The picture that was deleted became a card instead of stopping the video.
    expect(seen.inputs).toContain("color=c=0x112233");
    const library = await listMedia(ctx, { kind: "video" });
    expect(library.map((m) => [m.id, m.name])).toEqual([[done.outputId, "Mein Video.mp4"]]);

    const { finished: second } = await renderVideo(ctx, video.id, async () => {
      throw new Error("Unknown encoder 'libx264'");
    });
    await second;
    expect(await getVideo(ctx, video.id)).toMatchObject({ status: "FAILED", error: "Unknown encoder 'libx264'", outputId: done.outputId });
    if (!(await videoAvailable())) await expect(renderVideo(ctx, video.id)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("are planned by the AI within the studio's limits", async () => {
    const ctx = await newCompany("Plan GmbH");
    let system = "";
    const answer = async (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
      system = String(params.system);
      const scenes = [{ text: "Kennst du das?", seconds: 2.2, note: "Nahaufnahme" }, { text: "So geht es besser", seconds: 99, note: "" }, ...Array.from({ length: 40 }, () => ({ text: "mehr", seconds: 6, note: "x" }))];
      return { id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: JSON.stringify({ title: "Besser arbeiten", scenes }) }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 7 } } as unknown as Anthropic.Beta.BetaMessage;
    };
    const video = await planVideo(ctx, { topic: "Tipps für ruhiges Arbeiten", format: "square", seconds: 30 }, answer);
    expect(system).toContain("German");
    expect(system).toContain("about 30 seconds");
    expect(video).toMatchObject({ title: "Besser arbeiten", format: "square", status: "DRAFT" });
    expect(video.scenes.length).toBeLessThanOrEqual(30);
    expect(video.seconds).toBeLessThanOrEqual(180);
    expect(video.scenes[0]).toMatchObject({ text: "Kennst du das?", seconds: 2, note: "Nahaufnahme", mediaId: null });
    expect(video.scenes[1]).toMatchObject({ seconds: 30 });
    expect(video.scenes[1].note).toBeUndefined();
  });
});
