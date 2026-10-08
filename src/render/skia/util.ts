// Small math / colour helpers for the Skia renderer. Allocation-free where it
// matters (colours are written into reusable Float32Arrays).

import { Skia, SkColor } from "@shopify/react-native-skia";

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
export const easeInQuad = (t: number) => t * t;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t: number, s = 1.6) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

// Critically-ish damped spring state, stepped with semi-implicit Euler.
export interface Spring {
  x: number;
  v: number;
}

export const stepSpring = (s: Spring, target: number, stiffness: number, damping: number, dt: number) => {
  // Substep for stability with stiff springs and long frames
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (stiffness * (target - s.x) - damping * s.v) * h;
    s.x += s.v * h;
  }
};

// "#RRGGBB" + alpha -> Skia colour (allocates; use for constants only)
export const color = (hex: string, alpha = 1): SkColor => {
  const c = Skia.Color(hex);
  c[3] = alpha;
  return c;
};

// Write lerp(a, b, t) with alpha into `out` (no allocation)
export const mixInto = (out: SkColor, a: SkColor, b: SkColor, t: number, alpha: number): SkColor => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  out[3] = alpha;
  return out;
};

// Deterministic hash noise in [-1, 1] (for shake / rattles)
export const noise = (seed: number) => {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

// Reusable mutable rect object; Skia accepts plain {x,y,width,height}.
export interface MutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const mutRect = (): MutRect => ({ x: 0, y: 0, width: 0, height: 0 });

export const setRect = (r: MutRect, x: number, y: number, w: number, h: number): MutRect => {
  r.x = x;
  r.y = y;
  r.width = w;
  r.height = h;
  return r;
};
