// Renders the film behind the public pages: a flight over a glowing data landscape.
//
//   node scripts/render-landing-video.mjs <path-to-ffmpeg> <output-folder> [preview <frame>]
//
// ffmpeg needs libaom-av1, libx264 and libwebp. Every motion has a whole number
// of cycles in T, so the last frame meets the first and the loop has no seam.
// Colours are computed in floats and leave as 16 bit: the AV1 files stay 10 bit
// and the dark sky does not break into bands.
import { spawn } from "node:child_process";
import { join } from "node:path";

const [ffmpeg, out, mode, previewFrame] = process.argv.slice(2);
if (!ffmpeg || !out) throw new Error("usage: render-landing-video.mjs <ffmpeg> <output-folder> [preview <frame>]");

const W = 2560, H = 1440, FPS = 30, T = 20, N = FPS * T;
const SCALE = W / 1920;
const TAU = Math.PI * 2;

// The landscape: rows along z, columns along x, repeating after L.
const SP = 0.3, COLS = 360, ROWS = 230, L = 42;
const NEAR = 1.0, CAMY = 2.9, F = 1050 * SCALE, HORIZON = H * 0.5;

function height(x, z, th) {
  const k = TAU / L;
  return (
    0.95 * Math.sin(x * 0.27 + z * k * 2 + th) +
    0.62 * Math.sin(x * 0.11 - z * k * 3 + 1.3 - th) +
    0.38 * Math.sin(x * 0.61 + z * k * 5 + 2.1 + th * 2) +
    0.2 * Math.sin(x * 1.13 - z * k * 9 + 0.7 + th * 3)
  );
}

let seed = 20261104;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let v = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
  return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
}

const R = new Float32Array(W * H), G = new Float32Array(W * H), B = new Float32Array(W * H);

/** A soft point at its exact position, between pixels too: nothing jumps from pixel to pixel. */
const gx = new Float32Array(64), gy = new Float32Array(64);
function splat(px, py, radius, r, g, b) {
  const reach = Math.min(30, Math.ceil(radius * 2.3));
  const ix = Math.floor(px), iy = Math.floor(py);
  if (ix < -reach || iy < -reach || ix > W + reach || iy > H + reach) return;
  const inv = 1 / (radius * radius);
  const size = reach * 2 + 2;
  for (let i = 0; i < size; i++) {
    const dx = ix - reach + i - px, dy = iy - reach + i - py;
    gx[i] = Math.exp(-dx * dx * inv);
    gy[i] = Math.exp(-dy * dy * inv);
  }
  for (let j = 0; j < size; j++) {
    const y = iy - reach + j;
    if (y < 0 || y >= H) continue;
    const row = y * W, wy = gy[j];
    for (let i = 0; i < size; i++) {
      const x = ix - reach + i;
      if (x < 0 || x >= W) continue;
      const w = gx[i] * wy, o = row + x;
      R[o] += r * w; G[o] += g * w; B[o] += b * w;
    }
  }
}

function line(x0, y0, x1, y1, r, g, b) {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
  if (n === 0 || n > 900) return;
  for (let i = 0; i <= n; i++) {
    const x = x0 + (dx * i) / n, y = y0 + (dy * i) / n;
    const ix = x | 0, iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= H - 1) continue;
    const fx = x - ix, fy = y - iy, p = iy * W + ix;
    const a = (1 - fx) * (1 - fy), c = fx * (1 - fy), d = (1 - fx) * fy, e = fx * fy;
    R[p] += r * a; G[p] += g * a; B[p] += b * a;
    R[p + 1] += r * c; G[p + 1] += g * c; B[p + 1] += b * c;
    R[p + W] += r * d; G[p + W] += g * d; B[p + W] += b * d;
    R[p + W + 1] += r * e; G[p + W + 1] += g * e; B[p + W + 1] += b * e;
  }
}

// Sky and glow hold no detail: computed small, enlarged while the frame is put together.
const SW = 320, SH = 180, LOW = SW * SH;
const skyR = new Float32Array(LOW), skyG = new Float32Array(LOW), skyB = new Float32Array(LOW);
const glowR = new Float32Array(LOW), glowG = new Float32Array(LOW), glowB = new Float32Array(LOW);
const scratch = new Float32Array(LOW);

function sky(th) {
  for (let j = 0; j < SH; j++) {
    const v = j / (SH - 1);
    for (let i = 0; i < SW; i++) {
      const u = i / (SW - 1);
      const wx = u * 3.2 + 0.35 * Math.sin(v * 3.1 + th) + 0.18 * Math.sin(v * 7.3 - th * 2);
      const a1 = Math.pow(0.5 + 0.5 * Math.sin(wx * 1.7 + th + 1.0 + 0.8 * Math.sin(v * 2.4 - th)), 3);
      const a2 = Math.pow(0.5 + 0.5 * Math.sin(wx * 1.1 - th + 2.6), 3);
      const e = Math.exp(-Math.pow((v - 0.44) / 0.16, 2)) + Math.exp(-Math.pow((v - 0.1) / 0.18, 2)) * 0.12;
      const p = j * SW + i;
      skyR[p] = 0.001 + e * (0.03 * a1 + 0.006 * a2);
      skyG[p] = 0.0022 + e * (0.012 * a1 + 0.03 * a2);
      skyB[p] = 0.0085 + e * (0.105 * a1 + 0.075 * a2);
    }
  }
}

function boxBlur(a, radius) {
  const span = radius * 2 + 1;
  for (let y = 0; y < SH; y++) {
    let sum = 0;
    const row = y * SW;
    for (let x = -radius; x <= radius; x++) sum += a[row + Math.min(SW - 1, Math.max(0, x))];
    for (let x = 0; x < SW; x++) {
      scratch[row + x] = sum / span;
      sum += a[row + Math.min(SW - 1, x + radius + 1)] - a[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < SW; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += scratch[Math.min(SH - 1, Math.max(0, y)) * SW + x];
    for (let y = 0; y < SH; y++) {
      a[y * SW + x] = sum / span;
      sum += scratch[Math.min(SH - 1, y + radius + 1) * SW + x] - scratch[Math.max(0, y - radius) * SW + x];
    }
  }
}

/** Light bleeds around what is bright. */
function glow() {
  const step = W / SW;
  for (let j = 0; j < SH; j++) {
    for (let i = 0; i < SW; i++) {
      let r = 0, g = 0, b = 0;
      for (let y = 0; y < step; y++) {
        const row = (j * step + y) * W + i * step;
        for (let x = 0; x < step; x++) { r += R[row + x]; g += G[row + x]; b += B[row + x]; }
      }
      const q = j * SW + i, n = step * step;
      glowR[q] = r / n; glowG[q] = g / n; glowB[q] = b / n;
    }
  }
  for (const a of [glowR, glowG, glowB]) { boxBlur(a, 3); boxBlur(a, 3); boxBlur(a, 3); }
}

function ramp(h) {
  const t = Math.max(0, Math.min(1, (h + 1.6) / 3.2));
  if (t < 0.55) { const k = t / 0.55; return [0.13 + 0.15 * k, 0.26 + 0.02 * k, 0.86 + 0.08 * k]; }
  const k = (t - 0.55) / 0.45;
  return [0.28 - 0.08 * k, 0.28 + 0.6 * k, 0.94 + 0.04 * k];
}

const PACKETS = [];
for (let i = 0; i < 9; i++) PACKETS.push({ col: Math.round(((i * 37) % COLS) * 0.72 + COLS * 0.14), phase: (i * 0.381) % 1, cycles: 1 + (i % 3) });

const STARS = [];
for (let i = 0; i < 520; i++) {
  STARS.push({ x: random() * W, y: Math.pow(random(), 1.3) * HORIZON * 0.98, size: 0.55 + random() * 0.6, light: 0.012 + Math.pow(random(), 3) * 0.13, phase: random() * TAU, beat: 1 + Math.floor(random() * 3), drift: 4 + random() * 10 });
}

const px = new Float32Array(COLS * ROWS), py = new Float32Array(COLS * ROWS), pz = new Float32Array(COLS * ROWS), ph = new Float32Array(COLS * ROWS);

// Tone curve, indexed by the square root so the darkest values keep their steps.
const CURVE = 1 << 15, CURVE_TOP = 2.2;
const curve = new Float32Array(CURVE + 2);
for (let i = 0; i < CURVE + 2; i++) {
  const v = Math.pow((i / CURVE) * CURVE_TOP, 2);
  curve[i] = 65535 * Math.pow(1 - Math.exp(-v * 1.7), 1 / 1.7);
}
function tone(v) {
  if (v <= 0) return 0;
  const f = (Math.sqrt(v) / CURVE_TOP) * CURVE;
  if (f >= CURVE) return curve[CURVE];
  const i = f | 0, t = f - i;
  return curve[i] + (curve[i + 1] - curve[i]) * t;
}

function frame(n, pixels) {
  const t = n / N, th = TAU * t;
  R.fill(0); G.fill(0); B.fill(0);
  sky(th);

  for (const s of STARS) {
    const light = s.light * (0.65 + 0.35 * Math.sin(th * s.beat + s.phase));
    splat(s.x + s.drift * SCALE * Math.sin(th + s.phase), s.y + s.drift * 0.4 * SCALE * Math.cos(th + s.phase), s.size * SCALE, light * 0.75, light * 0.85, light);
  }

  const flown = t * L;
  const camX = 0.9 * Math.sin(th);
  const camY = CAMY + 0.22 * Math.sin(th * 2 + 1);
  const off = flown % SP;
  const baseRow = Math.round((flown - off) / SP);

  for (let r = 0; r < ROWS; r++) {
    const z = NEAR + r * SP - off;
    const wz = (baseRow + r) * SP;
    for (let c = 0; c < COLS; c++) {
      const x = (c - COLS / 2) * SP;
      const y = height(x, wz, th);
      const p = r * COLS + c;
      ph[p] = y; pz[p] = z;
      const s = F / z;
      px[p] = W / 2 + (x - camX) * s;
      py[p] = HORIZON + (camY - y) * s;
    }
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = r * COLS + c;
      const z = pz[p];
      const far = Math.exp(-z / 24);
      const near = Math.min(1, Math.max(0, (z - 0.6) / 3.5));
      const edge = 1 - Math.pow(Math.abs(c / (COLS - 1) - 0.5) * 2, 4);
      const crest = Math.max(0, (ph[p] + 1.1) / 2.6);
      const b = far * near * edge * (0.035 + 1.15 * crest * crest * crest);
      if (b < 0.0015) continue;
      const [cr, cg, cb] = ramp(ph[p]);
      splat(px[p], py[p], Math.max(0.75, Math.min(2.8, 4.2 / z)) * SCALE, cr * b * 1.25, cg * b * 1.25, cb * b * 1.25);
      const lb = b * 0.12;
      if (c + 1 < COLS) line(px[p], py[p], px[p + 1], py[p + 1], cr * lb, cg * lb, cb * lb);
      if (r + 1 < ROWS) line(px[p], py[p], px[p + COLS], py[p + COLS], cr * lb, cg * lb, cb * lb);
    }
  }

  for (const k of PACKETS) {
    const x = (k.col - COLS / 2) * SP;
    for (let s = 0; s < 90; s++) {
      const u = (((k.phase + t * k.cycles - s * 0.0009) % 1) + 1) % 1;
      const z = 2 + u * 44;
      const y = height(x, flown + z, th) + 0.05;
      const fade = Math.sin(Math.PI * u) * Math.exp(-z / 26) * Math.pow(1 - s / 90, 2.2) * 0.3;
      const sc = F / z;
      splat(W / 2 + (x - camX) * sc, HORIZON + (camY - y) * sc, Math.max(1.2, Math.min(6, 11 / z)) * SCALE, 0.25 * fade, 0.75 * fade, 1.0 * fade);
    }
  }

  glow();

  // Together: sky + glow enlarged, the sharp layer on top, a soft vignette.
  const fxStep = (SW - 1) / (W - 1), fyStep = (SH - 1) / (H - 1);
  for (let y = 0; y < H; y++) {
    const fy = y * fyStep, j = Math.min(SH - 2, fy | 0), ty = fy - j;
    const vy = (y / H - 0.5) * 2, vyy = vy * vy * 0.6;
    for (let x = 0; x < W; x++) {
      const fx = x * fxStep, i = Math.min(SW - 2, fx | 0), tx = fx - i;
      const p = j * SW + i, a = (1 - tx) * (1 - ty), b = tx * (1 - ty), c = (1 - tx) * ty, d = tx * ty;
      const vx = (x / W - 0.5) * 2, vig = 1 - 0.34 * (vx * vx * 0.8 + vyy);
      const o = y * W + x, q = o * 3;
      const lr = skyR[p] * a + skyR[p + 1] * b + skyR[p + SW] * c + skyR[p + SW + 1] * d + (glowR[p] * a + glowR[p + 1] * b + glowR[p + SW] * c + glowR[p + SW + 1] * d) * 1.5;
      const lg = skyG[p] * a + skyG[p + 1] * b + skyG[p + SW] * c + skyG[p + SW + 1] * d + (glowG[p] * a + glowG[p + 1] * b + glowG[p + SW] * c + glowG[p + SW + 1] * d) * 1.5;
      const lb = skyB[p] * a + skyB[p + 1] * b + skyB[p + SW] * c + skyB[p + SW + 1] * d + (glowB[p] * a + glowB[p + 1] * b + glowB[p + SW] * c + glowB[p + SW + 1] * d) * 1.5;
      pixels[q] = tone((R[o] + lr) * vig);
      pixels[q + 1] = tone((G[o] + lg) * vig);
      pixels[q + 2] = tone((B[o] + lb) * vig);
    }
  }
}

const INPUT = ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-"];
const COLOUR = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const WEB = ["-movflags", "+faststart", "-an"];
const AV1 = ["-c:v", "libaom-av1", "-cpu-used", "4", "-row-mt", "1", "-tiles", "2x2", "-g", "150", "-b:v", "0", ...COLOUR, ...WEB];
const H264 = ["-c:v", "libx264", "-preset", "slower", "-profile:v", "high", "-g", "150", ...COLOUR, ...WEB];
const CROP = `crop=810:1440:${(W - 810) / 2}:0`;
const TO709 = "out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int";

function encoder() {
  const graph = [
    "[0:v]split=4[a][b][c][d]",
    `[a]scale=${W}:${H}:${TO709},format=yuv420p10le[wide10]`,
    `[b]scale=1920:1080:${TO709},format=yuv420p[wide8]`,
    `[c]${CROP},scale=810:1440:${TO709},format=yuv420p10le[tall10]`,
    `[d]${CROP},scale=720:1280:${TO709},format=yuv420p[tall8]`,
  ].join(";");
  return spawn(
    ffmpeg,
    [
      ...INPUT,
      "-filter_complex", graph,
      "-map", "[wide10]", ...AV1, "-crf", "36", join(out, "wide.av1.mp4"),
      "-map", "[wide8]", ...H264, "-crf", "25", join(out, "wide.h264.mp4"),
      "-map", "[tall10]", ...AV1, "-crf", "37", join(out, "tall.av1.mp4"),
      "-map", "[tall8]", ...H264, "-crf", "27", join(out, "tall.h264.mp4"),
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
}

function still(args, pixels) {
  return new Promise((done, fail) => {
    const p = spawn(ffmpeg, [...INPUT, "-frames:v", "1", ...args], { stdio: ["pipe", "inherit", "inherit"] });
    p.on("close", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg ${code}`))));
    p.stdin.end(Buffer.from(pixels.buffer));
  });
}

const pixels = new Uint16Array(W * H * 3);
if (mode === "preview") {
  const n = Number(previewFrame ?? 0);
  const started = Date.now();
  frame(n, pixels);
  console.log(`frame ${n}: ${Date.now() - started} ms`);
  await still(["-q:v", "2", join(out, `preview-${n}.jpg`)], pixels);
} else {
  frame(0, pixels);
  // The first frame, so the film takes over without a jump.
  await still(["-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libwebp", "-quality", "80", join(out, "poster-wide.webp")], pixels);
  await still(["-vf", `${CROP},scale=720:1280:flags=lanczos`, "-c:v", "libwebp", "-quality", "78", join(out, "poster-tall.webp")], pixels);

  const p = encoder();
  const closed = new Promise((done) => p.on("close", done));
  const bytes = Buffer.from(pixels.buffer);
  for (let n = 0; n < N; n++) {
    frame(n, pixels);
    if (!p.stdin.write(bytes)) await new Promise((done) => p.stdin.once("drain", done));
    if (n % 60 === 0) console.log(`${n} / ${N}`);
  }
  p.stdin.end();
  console.log(`encoder exit ${await closed}`);
}
