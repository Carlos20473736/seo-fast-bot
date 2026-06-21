/**
 * captcha-cv.ts
 *
 * Pure-Node replacement for captcha_solver.py (OpenCV).
 * Runs on the Node-only deploy runtime (no Python / no native cv2).
 *
 * Implements:
 *  - detectSlidePositionCV: grayscale template matching with mask (TM_CCORR_NORMED)
 *  - findIconsCV: HSV color thresholding + morphology (dilate/erode) +
 *    connected-component labeling + bounding boxes, returning cropped PNGs.
 *
 * Image decoding/encoding is done with `sharp`.
 */
import sharp from "sharp";

export interface SlideResult {
  x: number;
  confidence: number;
}

export interface IconBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  area: number;
  crop: Buffer;
}

interface GrayImage {
  data: Uint8Array; // length = width * height
  width: number;
  height: number;
}

interface RgbImage {
  data: Buffer; // RGB, length = width * height * 3
  width: number;
  height: number;
}

async function toGray(buffer: Buffer): Promise<GrayImage> {
  const img = sharp(buffer).grayscale().removeAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  // grayscale still may report channels=3 depending on input; collapse to 1.
  const { width, height, channels } = info;
  const gray = new Uint8Array(width * height);
  if (channels === 1) {
    gray.set(data.subarray(0, width * height));
  } else {
    for (let i = 0, p = 0; i < width * height; i++, p += channels) {
      gray[i] = data[p];
    }
  }
  return { data: gray, width, height };
}

async function toRgb(buffer: Buffer): Promise<RgbImage> {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: data as Buffer, width: info.width, height: info.height };
}

/**
 * Template matching equivalent to OpenCV's cv2.matchTemplate with
 * method=TM_CCORR_NORMED and a binary mask built from the slide
 * (threshold at 10). Returns the X with the highest normalized correlation.
 *
 * The template is slid across BOTH axes (x and y) exactly like OpenCV's
 * cv2.matchTemplate, and only the X offset of the best match is returned
 * (max_loc[0]), matching the original captcha_solver.py.
 */
export async function detectSlidePositionCV(
  bgBuffer: Buffer,
  slideBuffer: Buffer,
): Promise<SlideResult> {
  const bg = await toGray(bgBuffer);
  const sl = await toGray(slideBuffer);

  const tplW = sl.width;
  const tplH = sl.height;

  // Build mask (threshold at 10), exactly like cv2.threshold(sl, 10, 255, BINARY).
  // Precompute, per template row, the masked sum of squares of the template so
  // the CCORR_NORMED denominator matches OpenCV's masked formula:
  //   score = sum(I*T*M) / ( sqrt(sum(I^2*M)) * sqrt(sum(T^2*M)) )
  const mask = new Uint8Array(tplW * tplH);
  let tplSqTotal = 0;
  for (let y = 0; y < tplH; y++) {
    for (let x = 0; x < tplW; x++) {
      const v = sl.data[y * sl.width + x];
      const m = v > 10 ? 1 : 0;
      mask[y * tplW + x] = m;
      if (m) tplSqTotal += v * v;
    }
  }
  const tplNorm = Math.sqrt(tplSqTotal) || 1;

  // matchTemplate slides the template across BOTH axes (x and y), like OpenCV.
  const maxX = bg.width - tplW;
  const maxY = bg.height - tplH;
  let bestX = 0;
  let bestY = 0;
  let bestVal = -Infinity;

  for (let oy = 0; oy <= maxY; oy++) {
    for (let ox = 0; ox <= maxX; ox++) {
      let dot = 0;
      let bgSq = 0;
      for (let y = 0; y < tplH; y++) {
        const bgRow = (oy + y) * bg.width + ox;
        const tplRow = y * tplW;
        const slRow = y * sl.width;
        for (let x = 0; x < tplW; x++) {
          if (!mask[tplRow + x]) continue;
          const bgv = bg.data[bgRow + x];
          const slv = sl.data[slRow + x];
          dot += bgv * slv;
          bgSq += bgv * bgv;
        }
      }
      const denom = Math.sqrt(bgSq) * tplNorm || 1;
      const score = dot / denom; // TM_CCORR_NORMED (masked)
      if (score > bestVal) {
        bestVal = score;
        bestX = ox;
        bestY = oy;
      }
    }
  }

  // The basilisk slider only needs the X offset (max_loc[0] in the Python code).
  void bestY;
  return { x: bestX, confidence: bestVal };
}

/** Convert a single RGB pixel to OpenCV-style HSV (H in 0..179, S/V in 0..255). */
function rgbToHsvCv(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rf) h = 60 * (((gf - bf) / d) % 6);
    else if (max === gf) h = 60 * ((bf - rf) / d + 2);
    else h = 60 * ((rf - gf) / d + 4);
  }
  if (h < 0) h += 360;
  const hCv = Math.round(h / 2); // OpenCV uses H/2 to fit 0..179
  const s = max === 0 ? 0 : Math.round((d / max) * 255);
  const v = Math.round(max * 255);
  return [hCv, s, v];
}

function inRange(
  h: number,
  s: number,
  v: number,
  lo: [number, number, number],
  hi: [number, number, number],
): boolean {
  return (
    h >= lo[0] && h <= hi[0] && s >= lo[1] && s <= hi[1] && v >= lo[2] && v <= hi[2]
  );
}

/** Morphological dilation/erosion with a 3x3 square kernel. */
function morph(mask: Uint8Array, w: number, h: number, op: "dilate" | "erode", iterations: number): Uint8Array {
  let cur = mask;
  const target = op === "dilate" ? 1 : 0;
  const set = op === "dilate" ? 1 : 0;
  for (let it = 0; it < iterations; it++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            if (cur[ny * w + nx] === target) {
              hit = true;
              break;
            }
          }
        }
        if (op === "dilate") {
          next[idx] = hit ? 1 : cur[idx];
        } else {
          // erode: keep 1 only if no background neighbour
          next[idx] = hit ? 0 : cur[idx];
        }
      }
    }
    cur = next;
    void set;
  }
  return cur;
}

interface Component {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
}

/** Connected-component labeling (4/8 connectivity) over a binary mask. */
function connectedComponents(mask: Uint8Array, w: number, h: number): Component[] {
  const labels = new Int32Array(w * h).fill(0);
  const comps: Component[] = [];
  const stack: number[] = [];
  let next = 1;
  for (let i = 0; i < w * h; i++) {
    if (mask[i] !== 1 || labels[i] !== 0) continue;
    next++;
    const label = next;
    stack.length = 0;
    stack.push(i);
    labels[i] = label;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p - px) / w;
      area++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] === 1 && labels[q] === 0) {
            labels[q] = label;
            stack.push(q);
          }
        }
      }
    }
    comps.push({ minX, minY, maxX, maxY, area });
  }
  return comps;
}

/**
 * Find neon icons, equivalent to find_icons_opencv in the Python script:
 * HSV thresholds (cyan/blue/purple/green), dilate x4, erode x2, contours,
 * filter by area>500 and 20<w,h<200, then top-3 by area with a +/-10px crop.
 */
export async function findIconsCV(imgBuffer: Buffer): Promise<IconBox[]> {
  const { data, width, height } = await toRgb(imgBuffer);

  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < width * height; i++, p += 3) {
    const [h, s, v] = rgbToHsvCv(data[p], data[p + 1], data[p + 2]);
    const isCyan = inRange(h, s, v, [80, 100, 150], [100, 255, 255]);
    const isBlue = inRange(h, s, v, [100, 100, 150], [135, 255, 255]);
    const isPurple = inRange(h, s, v, [135, 80, 150], [170, 255, 255]);
    const isGreen = inRange(h, s, v, [35, 100, 150], [80, 255, 255]);
    mask[i] = isCyan || isBlue || isPurple || isGreen ? 1 : 0;
  }

  let m = morph(mask, width, height, "dilate", 4);
  m = morph(m, width, height, "erode", 2);

  const comps = connectedComponents(m, width, height);

  const candidates: { cx: number; cy: number; w: number; h: number; area: number; box: [number, number, number, number] }[] = [];
  for (const c of comps) {
    const w = c.maxX - c.minX + 1;
    const h = c.maxY - c.minY + 1;
    if (c.area > 500 && w > 20 && h > 20 && w < 200 && h < 200) {
      const cx = c.minX + Math.floor(w / 2);
      const cy = c.minY + Math.floor(h / 2);
      const margin = 10;
      const x1 = Math.max(0, c.minX - margin);
      const y1 = Math.max(0, c.minY - margin);
      const x2 = Math.min(width, c.maxX + 1 + margin);
      const y2 = Math.min(height, c.maxY + 1 + margin);
      candidates.push({ cx, cy, w, h, area: c.area, box: [x1, y1, x2 - x1, y2 - y1] });
    }
  }

  candidates.sort((a, b) => b.area - a.area);
  const top = candidates.slice(0, 3);

  const result: IconBox[] = [];
  for (const cand of top) {
    const [left, top_, w, h] = cand.box;
    const crop = await sharp(imgBuffer)
      .extract({ left, top: top_, width: w, height: h })
      .png()
      .toBuffer();
    result.push({ cx: cand.cx, cy: cand.cy, w: cand.w, h: cand.h, area: cand.area, crop });
  }
  return result;
}
