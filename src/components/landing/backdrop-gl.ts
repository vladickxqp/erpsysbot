// The landscape behind the public pages, drawn live on the graphics card: sharp
// at the screen's own resolution, with nothing to download. Every motion repeats
// after PERIOD seconds and the land after LENGTH units, so it can run for ever.

const PERIOD = 48;
// A whole number of wide grid cells (2.5 units), or the lines would jump when it repeats.
const LENGTH = 100;
const NEAR = 0.6;
const FAR = 130;

const COMMON = /* glsl */ `#version 300 es
precision highp float;
#define TAU 6.28318530718
const float LENGTH = ${LENGTH.toFixed(1)};

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Softens the darkest steps, which a screen would otherwise show as bands.
vec3 finish(vec3 light, vec2 pixel) {
  vec3 shown = 1.0 - exp(-light * 1.35);
  shown = pow(shown, vec3(1.0 / 2.2));
  return shown + (hash(pixel) + hash(pixel + 17.0) - 1.0) / 255.0;
}
`;

const SKY_VERTEX = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 1.0, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `${COMMON}
in vec2 vUv;
out vec4 colour;
uniform float uTheta;
uniform float uHorizon;
uniform vec2 uSize;
uniform float uDensity;

float band(float x, float y, float shift) {
  float wave = x * 2.2 + 0.5 * sin(x * 3.1 + uTheta + shift) + 0.22 * sin(x * 7.3 - uTheta * 2.0);
  float curtain = 0.5 + 0.5 * sin(wave * 2.1 + uTheta + shift + 1.1 * sin(y * 3.0 - uTheta));
  return curtain * curtain * curtain;
}

void main() {
  float aspect = uSize.x / uSize.y;
  float x = (vUv.x - 0.5) * aspect;
  float y = vUv.y - uHorizon;

  vec3 light = mix(vec3(0.0022, 0.0036, 0.0125), vec3(0.0008, 0.0012, 0.0048), smoothstep(0.0, 0.5, y));

  float rise = exp(-pow(max(y, 0.0) / 0.17, 1.4));
  float a = band(x, y, 0.0);
  float b = band(x * 0.7 + 3.0, y, 2.4);
  light += rise * (vec3(0.13, 0.05, 0.62) * a + vec3(0.01, 0.30, 0.52) * b) * 0.21;
  light += exp(-pow(abs(y) / 0.03, 1.1)) * vec3(0.06, 0.26, 0.66) * 0.085;
  light += exp(-(x * x) / 0.55 - (y * y) / 0.022) * vec3(0.08, 0.20, 0.72) * 0.17;

  // Stars: one chance per cell, at a fixed size in screen points.
  vec2 point = gl_FragCoord.xy / uDensity;
  vec2 cell = floor(point / 34.0);
  float chance = hash(cell);
  if (chance > 0.72 && y > 0.02) {
    vec2 centre = (cell + 0.2 + 0.6 * vec2(hash(cell + 3.1), hash(cell + 7.7))) * 34.0;
    float size = 0.55 + 0.75 * hash(cell + 11.3);
    float twinkle = 0.65 + 0.35 * sin(uTheta * floor(1.0 + chance * 7.0) + chance * 60.0);
    float spot = smoothstep(size + 0.7, size - 0.3, length(point - centre));
    light += spot * twinkle * smoothstep(0.02, 0.2, y) * vec3(0.55, 0.65, 0.95) * pow(hash(cell + 5.5), 3.0) * 1.3;
  }

  colour = vec4(finish(light, gl_FragCoord.xy), 1.0);
}
`;

const LAND_VERTEX = /* glsl */ `${COMMON}
layout(location = 0) in vec2 aGrid;
out vec3 vWorld;
out float vDistance;
out vec3 vNormal;
uniform float uTheta;
uniform float uFlown;
uniform vec3 uCamera;
uniform vec2 uFocal;
uniform float uHorizon;
uniform vec2 uDepth;

vec4 waves(float x, float z) {
  const float k = TAU / LENGTH;
  vec4 phase = vec4(
    x * 0.21 + z * k * 3.0 + uTheta,
    x * 0.093 - z * k * 4.0 + 1.3 - uTheta,
    x * 0.47 + z * k * 9.0 + 2.1 + uTheta * 2.0,
    x * 0.91 - z * k * 17.0 + 0.7 + uTheta * 3.0
  );
  return phase;
}

float height(float x, float z) {
  vec4 p = waves(x, z);
  return 1.25 * sin(p.x) + 0.85 * sin(p.y) + 0.42 * sin(p.z) + 0.15 * sin(p.w);
}

void main() {
  const float k = TAU / LENGTH;
  // Rows bunch up near the camera, columns fan out with the view: every triangle stays small on screen.
  float distanceAhead = ${NEAR.toFixed(1)} + (${FAR.toFixed(1)} - ${NEAR.toFixed(1)}) * aGrid.y * aGrid.y;
  float x = aGrid.x * (distanceAhead / uFocal.x * 1.25 + 7.0) + uCamera.x;
  float z = distanceAhead + uFlown;
  float y = height(x, z);

  vec4 p = waves(x, z);
  vec4 c = cos(p);
  float dx = 1.25 * 0.21 * c.x + 0.85 * 0.093 * c.y + 0.42 * 0.47 * c.z + 0.15 * 0.91 * c.w;
  float dz = k * (1.25 * 3.0 * c.x - 0.85 * 4.0 * c.y + 0.42 * 9.0 * c.z - 0.15 * 17.0 * c.w);

  vWorld = vec3(x, y, z);
  vDistance = distanceAhead;
  vNormal = normalize(vec3(-dx, 1.0, -dz));

  float depth = uDepth.x * distanceAhead + uDepth.y;
  gl_Position = vec4(
    (x - uCamera.x) * uFocal.x,
    (y - uCamera.y) * uFocal.y + (uHorizon * 2.0 - 1.0) * distanceAhead,
    depth,
    distanceAhead
  );
}
`;

const LAND_FRAGMENT = /* glsl */ `${COMMON}
in vec3 vWorld;
in float vDistance;
in vec3 vNormal;
out vec4 colour;
uniform float uTheta;
uniform vec3 uCamera;
uniform float uFlown;
uniform float uDensity;

// Lines stay clean however far away they are: below a pixel they fade to their average.
vec2 lines(vec2 uv, vec2 change, vec2 width) {
  vec2 drawn = clamp(width, change, vec2(0.5));
  vec2 edge = change * 1.5;
  vec2 fold = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  vec2 grid = smoothstep(drawn + edge, drawn - edge, fold);
  grid *= clamp(width / drawn, 0.0, 1.0);
  return mix(grid, width, clamp(change * 2.0 - 1.0, 0.0, 1.0));
}

vec3 tint(float h) {
  float t = clamp((h + 1.9) / 3.8, 0.0, 1.0);
  vec3 low = vec3(0.16, 0.10, 1.00);
  vec3 middle = vec3(0.10, 0.30, 1.00);
  vec3 high = vec3(0.04, 0.78, 1.00);
  return t < 0.55 ? mix(low, middle, t / 0.55) : mix(middle, high, (t - 0.55) / 0.45);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 view = normalize(vec3(uCamera.x - vWorld.x, uCamera.y - vWorld.y, -vDistance));
  float facing = clamp(dot(normal, view), 0.0, 1.0);
  float crest = smoothstep(-0.9, 2.1, vWorld.y);
  float fog = exp(-pow(vDistance / 74.0, 2.4));
  float near = smoothstep(0.7, 5.0, vDistance);
  vec3 hue = tint(vWorld.y);

  // The land itself: dark and solid, so the far hills pass behind the near ones.
  float rim = pow(1.0 - facing, 3.0);
  vec3 light = vec3(0.0010, 0.0018, 0.0064) + hue * (0.0012 + 0.0055 * crest + 0.03 * rim * crest);

  vec2 fine = vWorld.xz / 0.5;
  vec2 fineChange = max(vec2(length(vec2(dFdx(fine.x), dFdy(fine.x))), length(vec2(dFdx(fine.y), dFdy(fine.y)))), vec2(1e-5));
  vec2 fineLines = lines(fine, fineChange, min(vec2(0.016), fineChange * uDensity * 1.05));
  float fineGrid = mix(fineLines.x, 1.0, fineLines.y);

  vec2 wide = fine / 5.0;
  vec2 wideLines = lines(wide, fineChange / 5.0, min(vec2(0.006), fineChange / 5.0 * uDensity * 1.5));
  float wideGrid = mix(wideLines.x, 1.0, wideLines.y);

  float seenWide = smoothstep(0.35, 0.05, max(fineChange.x, fineChange.y) / 5.0 * 8.0);
  float shine = 0.05 + 1.25 * crest * crest;
  vec2 away = 1.0 - abs(fract(wide) * 2.0 - 1.0);
  float halo = exp(-away.x * 26.0) + exp(-away.y * 26.0);
  light += hue * halo * crest * crest * 0.075 * seenWide;
  light += hue * fineGrid * shine * 0.5;
  light += hue * wideGrid * shine * 1.25;

  // A point where lines meet, kept round and at least a pixel wide.
  vec2 node = (fract(fine + 0.5) - 0.5) / fineChange;
  float seen = smoothstep(9.0, 22.0, 1.0 / max(fineChange.x, fineChange.y));
  float radius = 1.05 * uDensity;
  light += hue * smoothstep(radius + 0.8, radius - 0.5, length(node)) * seen * (0.25 + 1.7 * crest);

  // Light running along a few lines, the way data moves through a network.
  float column = floor(wide.x + 0.5);
  float picked = hash(vec2(column, 4.0));
  if (picked > 0.62) {
    float cycles = 1.0 + floor(hash(vec2(column, 9.0)) * 3.0);
    float travel = fract(vWorld.z / ${LENGTH.toFixed(1)} * 2.0 - uTheta / TAU * cycles * 2.0 + picked * 7.0);
    float trail = exp(-travel * 34.0) + 0.12 * exp(-travel * 7.0);
    light += vec3(0.42, 0.93, 1.0) * wideLines.x * trail * 7.0;
  }

  colour = vec4(finish(light * mix(0.25, 1.0, near), gl_FragCoord.xy), fog);
}
`;

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [kind, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(kind);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(shader));
      return null;
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

/** A grid of points: x from -1 to 1, y from 0 to 1, as triangles. */
function landMesh(gl: WebGL2RenderingContext, columns: number, rows: number): { vao: WebGLVertexArrayObject; count: number } {
  const points = new Float32Array((columns + 1) * (rows + 1) * 2);
  let at = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= columns; c++) {
      points[at++] = (c / columns) * 2 - 1;
      points[at++] = r / rows;
    }
  }
  const order = new Uint32Array(columns * rows * 6);
  at = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const a = r * (columns + 1) + c;
      const b = a + columns + 1;
      order.set([a, b, a + 1, a + 1, b, b + 1], at);
      at += 6;
    }
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, order, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: order.length };
}

/** What one picture may cost on the graphics card: leaves room for the page at 60 pictures a second. */
const BUDGET_MS = 11;

/** Phones and tablets run at full speed only where it costs them next to nothing. */
const LIGHT_MS = 6;

/** Below this a screen no longer feels smooth, at the lowest detail not worth showing. */
const SLOW_MS = 38;
const HOPELESS_MS = 50;

/** Share of the screen's own resolution. Below the last step the still picture is sharper. */
const DETAILS = [1, 0.85, 0.7, 0.6, 0.5];
const LOWEST = DETAILS[DETAILS.length - 1];

/** Above this the memory goes into the picture: the lines are smoothed in the shader anyway. */
const EDGE_SMOOTHING_PIXELS = 10_000_000;

/** The share of the screen's resolution this graphics card can fill in time, null when too little. */
export function fitDetail(costMs: number): number | null {
  if (costMs <= BUDGET_MS) return 1;
  const detail = Math.sqrt(BUDGET_MS / costMs);
  return detail < LOWEST ? null : detail;
}

/** The detail to go on with after a run of frames, null when a still picture serves better. */
export function nextDetail(detail: number, typicalMs: number): number | null {
  if (typicalMs <= SLOW_MS) return detail;
  const lower = DETAILS.find((step) => step < detail);
  if (lower !== undefined) return lower;
  return typicalMs > HOPELESS_MS ? null : detail;
}

/** Enough points for the hills to stay round on this many pixels. */
export function meshSize(width: number, height: number): { columns: number; rows: number } {
  return {
    columns: Math.min(1000, Math.max(200, Math.round(width / 4.5))),
    rows: Math.min(720, Math.max(160, Math.round(height / 4))),
  };
}

export type Scene = {
  /** Draws the moment `seconds` into the flight, at the size the canvas has on screen. */
  draw(seconds: number): void;
  /** Draws like `draw` and waits for the card: what one picture costs, in milliseconds. */
  cost(seconds: number): number;
  /** How much of the screen's own resolution is used, from 1 down. */
  setDetail(detail: number): void;
  dispose(): void;
};

/** The scene on this canvas, or null where the graphics card cannot draw it. */
export function createScene(canvas: HTMLCanvasElement, { small }: { small: boolean }): Scene | null {
  const screen = window.devicePixelRatio || 1;
  const nativeWidth = canvas.clientWidth * screen;
  const nativeHeight = canvas.clientHeight * screen;
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: nativeWidth * nativeHeight <= EDGE_SMOOTHING_PIXELS,
    depth: true,
    powerPreference: small ? "low-power" : "high-performance",
  });
  if (!gl) return null;

  const sky = compile(gl, SKY_VERTEX, SKY_FRAGMENT);
  const land = compile(gl, LAND_VERTEX, LAND_FRAGMENT);
  if (!sky || !land) return null;

  const skyAt = (name: string) => gl.getUniformLocation(sky, name);
  const landAt = (name: string) => gl.getUniformLocation(land, name);
  const empty = gl.createVertexArray();
  const { columns, rows } = meshSize(nativeWidth, nativeHeight);
  const mesh = landMesh(gl, columns, rows);
  const [widest, tallest] = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  const largest = Math.min(widest, tallest, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
  const probe = new Uint8Array(4);
  let detail = 1;

  function resize(): number {
    const longest = Math.max(1, canvas.clientWidth, canvas.clientHeight);
    const density = Math.min(window.devicePixelRatio || 1, largest / longest) * detail;
    const width = Math.max(1, Math.round(canvas.clientWidth * density));
    const height = Math.max(1, Math.round(canvas.clientHeight * density));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return density;
  }

  const scene: Scene = {
    setDetail(next) {
      detail = next;
    },
    cost(seconds) {
      const begun = performance.now();
      scene.draw(seconds);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
      return performance.now() - begun;
    },
    draw(seconds) {
      const density = resize();
      const { width, height } = canvas;
      const aspect = width / height;
      const theta = ((seconds % PERIOD) / PERIOD) * Math.PI * 2;
      const flown = ((seconds % PERIOD) / PERIOD) * LENGTH;
      const horizon = aspect < 1 ? 0.56 : 0.6;

      // The same height of view on every screen; wider screens see more to the sides.
      const focalY = 1.95;
      const focal: [number, number] = [focalY / aspect, focalY];
      const camera: [number, number, number] = [1.6 * Math.sin(theta), 4.3 + 0.35 * Math.sin(theta * 2 + 1), 0];

      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.useProgram(sky);
      gl.uniform1f(skyAt("uTheta"), theta);
      gl.uniform1f(skyAt("uHorizon"), horizon);
      gl.uniform2f(skyAt("uSize"), width, height);
      gl.uniform1f(skyAt("uDensity"), density);
      gl.bindVertexArray(empty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(land);
      gl.uniform1f(landAt("uTheta"), theta);
      gl.uniform1f(landAt("uFlown"), flown);
      gl.uniform3f(landAt("uCamera"), ...camera);
      gl.uniform2f(landAt("uFocal"), ...focal);
      gl.uniform1f(landAt("uHorizon"), horizon);
      gl.uniform2f(landAt("uDepth"), (FAR + NEAR) / (FAR - NEAR), (-2 * FAR * NEAR) / (FAR - NEAR));
      gl.uniform1f(landAt("uDensity"), density);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    },
    dispose() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
  return scene;
}

const WARM_UP = 20;
const SAMPLE = 45;
const TRIALS = 4;
const SECOND_LOOKS = 3;

function middle(values: number[]): number {
  return [...values].sort((a, b) => a - b)[values.length >> 1];
}

/**
 * Keeps the scene moving until the returned function is called. It first times
 * a few pictures at the screen's own resolution while the still picture is
 * showing, and settles on what this graphics card can do. `started` comes with
 * the first picture, `gaveUp` when the still picture serves this device better.
 */
export function animate(scene: Scene, { small, started, gaveUp }: { small: boolean; started: () => void; gaveUp: () => void }) {
  let frame = 0;
  let seconds = 0;
  let last = 0;
  let detail = 1;
  let settled = false;
  let halfRate = false;
  let warming = WARM_UP;
  let running = false;
  let secondLooks = SECOND_LOOKS;
  const costs: number[] = [];
  let passes: number[] = [];

  function settle() {
    costs.push(scene.cost(0));
    if (costs.length < TRIALS) return;
    // The first one pays for setting everything up; a busy moment only ever makes one slower.
    const cost = Math.min(...costs.slice(1));
    const fit = fitDetail(cost);
    if (fit === null) {
      stop();
      gaveUp();
      return;
    }
    detail = fit;
    scene.setDetail(fit);
    halfRate = small && cost * fit * fit > LIGHT_MS;
    settled = true;
  }

  /** The start of a page is a busy moment: a card that was only held up gets its pixels back. */
  function lookAgain() {
    secondLooks--;
    const fit = fitDetail(scene.cost(seconds) / (detail * detail));
    if (fit !== null && fit > detail) {
      detail = fit;
      scene.setDetail(fit);
    }
  }

  function tick(now: number) {
    if (!running) return;
    frame = requestAnimationFrame(tick);
    if (!settled) {
      settle();
      return;
    }
    const passed = last ? now - last : 0;
    if (halfRate && passed > 0 && passed < 28) return;
    last = now;
    seconds += Math.min(passed, 100) / 1000;
    scene.draw(seconds);
    if (passed === 0) started();
    if (passed === 0 || passed > 250) return;
    if (warming > 0) {
      warming--;
      return;
    }
    passes.push(passed);
    if (passes.length < SAMPLE) return;
    const next = nextDetail(detail, middle(passes));
    passes = [];
    warming = WARM_UP;
    if (next === null) {
      stop();
      gaveUp();
    } else if (next !== detail) {
      detail = next;
      scene.setDetail(next);
    } else if (detail < 1 && secondLooks > 0) {
      lookAgain();
    }
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
  }

  return { start, stop };
}
