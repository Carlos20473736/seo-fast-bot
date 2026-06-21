import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { detectSlidePositionCV, findIconsCV } from "./captcha-cv";

/** Build a raw RGB buffer and encode as PNG via sharp. */
async function makePng(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const p = (y * width + x) * 3;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("detectSlidePositionCV", () => {
  it("finds the X offset of a textured patch via template matching", async () => {
    const W = 260;
    const H = 80;
    const trueX = 150;
    const patchW = 40;
    // Deterministic pseudo-random texture. A flat bar would be ambiguous
    // under normalized cross-correlation, so we use a varied pattern that
    // mimics the real slider piece.
    const tex = (x: number, y: number) => ((x * 37 + y * 17 + ((x ^ y) * 11)) % 200) + 30;
    const bg = await makePng(W, H, (x, y) => {
      if (x >= trueX && x < trueX + patchW) {
        const v = tex(x - trueX, y);
        return [v, v, v];
      }
      return [20, 20, 20];
    });
    // Slide template (same height): the same textured patch at x=0, rest black.
    const slide = await makePng(patchW, H, (x, y) => {
      const v = tex(x, y);
      return [v, v, v];
    });

    const res = await detectSlidePositionCV(bg, slide);
    expect(Math.abs(res.x - trueX)).toBeLessThanOrEqual(2);
    expect(res.confidence).toBeGreaterThan(0.9);
  });
});

describe("findIconsCV", () => {
  it("detects up to three neon blobs and returns their centers", async () => {
    const W = 400;
    const H = 300;
    // Three neon rectangles on a dark background.
    const rects = [
      { x0: 40, y0: 40, x1: 95, y1: 95, color: [0, 255, 255] as [number, number, number] }, // cyan
      { x0: 200, y0: 120, x1: 255, y1: 175, color: [120, 0, 255] as [number, number, number] }, // purple
      { x0: 300, y0: 210, x1: 355, y1: 265, color: [60, 255, 0] as [number, number, number] }, // green
    ];
    const img = await makePng(W, H, (x, y) => {
      for (const r of rects) {
        if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return r.color;
      }
      return [10, 10, 10];
    });

    const found = await findIconsCV(img);
    expect(found.length).toBe(3);
    // Every blob should expose a positive-area crop.
    for (const f of found) {
      expect(f.area).toBeGreaterThan(500);
      expect(f.crop.length).toBeGreaterThan(0);
    }
    // Centers should be close to the rectangle centers (order-independent).
    const centers = found.map((f) => [f.cx, f.cy]);
    const expected = rects.map((r) => [Math.round((r.x0 + r.x1) / 2), Math.round((r.y0 + r.y1) / 2)]);
    for (const [ex, ey] of expected) {
      const match = centers.some(([cx, cy]) => Math.abs(cx - ex) <= 6 && Math.abs(cy - ey) <= 6);
      expect(match).toBe(true);
    }
  });
});
