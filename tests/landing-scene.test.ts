import { describe, expect, it } from "vitest";
import { nextDetail } from "@/components/landing/backdrop-gl";

describe("detail of the landing scene", () => {
  it("stays where frames come in time, a 30 Hz screen included", () => {
    expect(nextDetail(1, 16.7)).toBe(1);
    expect(nextDetail(1, 33.4)).toBe(1);
  });

  it("steps down one level at a time on a slow device", () => {
    expect(nextDetail(1, 45)).toBe(0.85);
    expect(nextDetail(0.85, 45)).toBe(0.7);
    expect(nextDetail(0.7, 45)).toBe(0.55);
  });

  it("keeps the lowest level while it is bearable and gives up after that", () => {
    expect(nextDetail(0.55, 45)).toBe(0.55);
    expect(nextDetail(0.55, 60)).toBeNull();
  });
});
