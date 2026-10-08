// Procedural DataTextures (no image assets, safe on expo-gl): soft radial
// glow, soft ring, and the colour-assist glyph atlas.

import { ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat, Texture, UnsignedByteType } from "three";

const make = (size: number, w: number, fill: (u: number, v: number) => number): Texture => {
  const data = new Uint8Array(w * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, Math.min(1, fill((x + 0.5) / size, (y + 0.5) / size)));
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new DataTexture(data, w, size, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
};

// Gaussian-ish glow: bright core, long soft tail.
export const makeGlowTexture = () =>
  make(64, 64, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    if (d >= 1) return 0;
    const core = Math.exp(-d * d * 18);
    const tail = (1 - d) * (1 - d) * 0.55;
    return core + tail;
  });

// Soft ring at 80% radius (shockwaves, bounce markers).
export const makeRingTexture = () =>
  make(64, 64, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const x = (d - 0.82) / 0.09;
    return Math.exp(-x * x) * (d < 1 ? 1 : 0);
  });

// Glyph atlas: 6 cells of 64px in one row. Order follows the bomb colours:
// triangle, dot, square, plus, diamond, star.
const inStar = (x: number, y: number) => {
  const a = Math.atan2(y, x);
  const r = Math.hypot(x, y);
  const k = (Math.cos(5 * (a + Math.PI / 2)) + 1) / 2; // 1 at the points
  return r < 0.42 + 0.48 * Math.pow(k, 3);
};

const glyphHit = (g: number, x: number, y: number) => {
  // x, y in -1..1, y up
  switch (g) {
    case 0: // triangle
      return y > -0.7 && y < 0.85 && Math.abs(x) < (0.85 - y) * 0.62;
    case 1:
      return Math.hypot(x, y) < 0.6;
    case 2:
      return Math.abs(x) < 0.62 && Math.abs(y) < 0.62;
    case 3:
      return (Math.abs(x) < 0.25 && Math.abs(y) < 0.85) || (Math.abs(y) < 0.25 && Math.abs(x) < 0.85);
    case 4:
      return Math.abs(x) + Math.abs(y) < 0.85;
    default:
      return inStar(x, y);
  }
};

export const GLYPH_COUNT = 6;

export const makeGlyphAtlas = () =>
  make(64, 64 * GLYPH_COUNT, (u, v) => {
    const g = Math.floor(u);
    const x = (u - g) * 2 - 1;
    const y = v * 2 - 1;
    // 3x3 supersample for smooth edges
    let hits = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (glyphHit(g, x + i / 96, y + j / 96)) hits++;
    return hits / 9;
  });
