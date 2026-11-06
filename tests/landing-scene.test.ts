import { afterEach, describe, expect, it, vi } from "vitest";
import { animate, fitDetail, meshSize, nextDetail, type Scene } from "@/components/landing/backdrop-gl";

describe("resolution of the landing scene", () => {
  it("uses every pixel of the screen where the graphics card keeps up", () => {
    expect(fitDetail(2)).toBe(1);
    expect(fitDetail(11)).toBe(1);
  });

  it("takes as many pixels as fit into a picture's time", () => {
    const detail = fitDetail(22) as number;
    expect(detail).toBeCloseTo(0.707, 2);
    expect(22 * detail * detail).toBeCloseTo(11, 5);
  });

  it("leaves the sharp still picture where the live one would be blurred", () => {
    expect(fitDetail(44)).toBe(0.5);
    expect(fitDetail(60)).toBeNull();
  });
});

describe("points of the landing scene", () => {
  it("grow with the screen", () => {
    expect(meshSize(1920, 1080)).toEqual({ columns: 427, rows: 270 });
    expect(meshSize(3840, 2160)).toEqual({ columns: 853, rows: 540 });
  });

  it("stay within what a card handles at 8K and enough on a small panel", () => {
    expect(meshSize(7680, 4320)).toEqual({ columns: 1000, rows: 720 });
    expect(meshSize(300, 200)).toEqual({ columns: 200, rows: 160 });
  });
});

describe("detail of the landing scene while it runs", () => {
  it("stays where frames come in time, a 30 Hz screen included", () => {
    expect(nextDetail(1, 16.7)).toBe(1);
    expect(nextDetail(1, 33.4)).toBe(1);
  });

  it("steps down one level at a time on a slow device", () => {
    expect(nextDetail(1, 45)).toBe(0.85);
    expect(nextDetail(0.85, 45)).toBe(0.7);
    expect(nextDetail(0.7, 45)).toBe(0.6);
    expect(nextDetail(0.63, 45)).toBe(0.6);
    expect(nextDetail(0.6, 45)).toBe(0.5);
  });

  it("keeps the lowest level while it is bearable and gives up after that", () => {
    expect(nextDetail(0.5, 45)).toBe(0.5);
    expect(nextDetail(0.5, 60)).toBeNull();
  });
});

describe("the scene finds its resolution by itself", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Runs the loop for a number of frames on a screen with 60 pictures a second. */
  function run(costOfFullPicture: (call: number) => number, frames: number) {
    let next: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      next = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      next = undefined;
    });
    let detail = 1;
    let calls = 0;
    const scene: Scene = {
      draw: () => {},
      cost: () => costOfFullPicture(++calls) * detail * detail,
      setDetail: (value) => {
        detail = value;
      },
      dispose: () => {},
    };
    const events = { started: 0, gaveUp: 0 };
    animate(scene, { small: false, started: () => events.started++, gaveUp: () => events.gaveUp++ }).start();
    for (let frame = 0, now = 1000; frame < frames && next; frame++, now += 16.7) next(now);
    return { detail: () => detail, events };
  }

  it("keeps every pixel on a card that manages them", () => {
    const { detail, events } = run(() => 6, 30);
    expect(detail()).toBe(1);
    expect(events).toEqual({ started: 1, gaveUp: 0 });
  });

  it("starts only after it has settled, so nobody sees it struggle", () => {
    expect(run(() => 6, 3).events.started).toBe(0);
    expect(run(() => 6, 5).events.started).toBe(1);
  });

  it("uses fewer pixels on a card that cannot fill them all", () => {
    const { detail, events } = run(() => 22, 400);
    expect(detail()).toBeCloseTo(0.707, 2);
    expect(events.gaveUp).toBe(0);
  });

  it("gets its pixels back when only the start of the page held the card up", () => {
    const { detail } = run((call) => (call <= 4 ? 25 : 6), 200);
    expect(detail()).toBe(1);
  });

  it("leaves the still picture where nothing fits", () => {
    const { events } = run(() => 80, 30);
    expect(events).toEqual({ started: 0, gaveUp: 1 });
  });
});
