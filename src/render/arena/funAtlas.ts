// Procedural icon + digit atlas for the Arena fun pass (no image assets, safe
// on expo-gl): one row of 64 px cells. Each texel stores the glyph fill in R
// and fill-or-outline coverage in A, so AtlasSprites draws a tinted glyph with
// a dark ~3 px outline that reads on any background.
// Cells: pickup icons (rainbow, mega bomb, snowflake, zap), lock, star,
// clock, then the digits 0-9 (rounded 7-segment, the countdown look).

import { ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat, Texture, UnsignedByteType } from "three";

export const CELL = {
  rainbow: 0, mega: 1, freeze: 2, lightning: 3, lock: 4, star: 5, clock: 6, digit0: 7,
} as const;
export const ATLAS_CELLS = 17;
const PX = 64;

// distance from p to segment a-b
const seg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
};

const inPoly = (x: number, y: number, p: number[]) => {
  let inside = false;
  for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++) {
    const xi = p[i * 2], yi = p[i * 2 + 1], xj = p[j * 2], yj = p[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const BOLT = [0.18, 0.92, -0.5, -0.06, -0.04, -0.06, -0.2, -0.92, 0.5, 0.1, 0.04, 0.1];

const inStar = (x: number, y: number, r0 = 0.4, r1 = 0.52) => {
  const a = Math.atan2(y, x);
  const k = (Math.cos(5 * (a - Math.PI / 2)) + 1) / 2;
  return Math.hypot(x, y) < r0 + r1 * Math.pow(k, 3);
};

// 7-segment digits (bit i = segment a..g)
const DIGIT: number[] = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
const W = 0.42, H = 0.78, T = 0.13;
const SEGMENTS: [number, number, number, number][] = [
  [-W, H, W, H], // a
  [W, H, W, 0], // b
  [W, 0, W, -H], // c
  [-W, -H, W, -H], // d
  [-W, 0, -W, -H], // e
  [-W, H, -W, 0], // f
  [-W, 0, W, 0], // g
];

function glyph(cell: number, x: number, y: number): boolean {
  switch (cell) {
    case CELL.rainbow: {
      if (y < -0.32) return false;
      const r = Math.hypot(x, y + 0.32);
      return (r > 0.3 && r < 0.46) || (r > 0.55 && r < 0.71) || (r > 0.8 && r < 0.96);
    }
    case CELL.mega: {
      if (Math.hypot(x + 0.1, y + 0.18) < 0.6) return true;
      if (seg(x, y, 0.22, 0.28, 0.48, 0.58) < 0.09) return true;
      return inStar((x - 0.62) / 0.42, (y - 0.72) / 0.42);
    }
    case CELL.freeze: {
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + (k * Math.PI) / 3;
        const c = Math.cos(a), s = Math.sin(a);
        if (seg(x, y, -c * 0.88, -s * 0.88, c * 0.88, s * 0.88) < 0.085) return true;
        for (const sg of [1, -1]) {
          const mx = sg * c * 0.52, my = sg * s * 0.52;
          for (const b of [0.75, -0.75]) {
            const ba = a + (sg > 0 ? 0 : Math.PI) + b;
            if (seg(x, y, mx, my, mx + Math.cos(ba) * 0.3, my + Math.sin(ba) * 0.3) < 0.07) return true;
          }
        }
      }
      return false;
    }
    case CELL.lightning:
      return inPoly(x, y, BOLT);
    case CELL.lock: {
      if (Math.abs(x) < 0.52 && y > -0.8 && y < 0.08) return Math.hypot(x, y + 0.36) > 0.12 || y < -0.5;
      const r = Math.hypot(x, y - 0.08);
      return y >= 0.08 && r > 0.24 && r < 0.4;
    }
    case CELL.star:
      return inStar(x, y);
    case CELL.clock: {
      const r = Math.hypot(x, y);
      if (r > 0.68 && r < 0.86) return true;
      return seg(x, y, 0, 0, 0, 0.5) < 0.08 || seg(x, y, 0, 0, 0.36, -0.12) < 0.08;
    }
    default: {
      const bits = DIGIT[cell - CELL.digit0] ?? 0;
      const sx = x - y * 0.12; // slight italic
      for (let i = 0; i < 7; i++) {
        if (!(bits & (1 << i))) continue;
        const [ax, ay, bx, by] = SEGMENTS[i];
        if (seg(sx, y, ax, ay, bx, by) < T) return true;
      }
      return false;
    }
  }
}

const OUTLINE = 0.13; // in glyph units (-1..1 per cell)
const DIRS = Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2) * OUTLINE, Math.sin((i / 12) * Math.PI * 2) * OUTLINE]);

export function makeFunAtlas(): Texture {
  const w = PX * ATLAS_CELLS;
  const data = new Uint8Array(w * PX * 4);
  for (let py = 0; py < PX; py++) {
    for (let px = 0; px < w; px++) {
      const cell = Math.floor(px / PX);
      const x = (((px % PX) + 0.5) / PX) * 2.3 - 1.15; // a little margin for the outline
      const y = ((py + 0.5) / PX) * 2.3 - 1.15;
      let fill = 0;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (glyph(cell, x + i / 90, y + j / 90)) fill++;
      fill /= 9;
      let out = fill;
      if (out < 1) for (const [dx, dy] of DIRS) if (glyph(cell, x + dx, y + dy)) { out = 1; break; }
      const i = (py * w + px) * 4;
      data[i] = Math.round(fill * 255);
      data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(fill, out * 0.92) * 255);
    }
  }
  const tex = new DataTexture(data, w, PX, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
