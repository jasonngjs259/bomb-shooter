// Frame-rate independent springs and filters (character spec, "Springs").
// Pure maths, no three.js: shared by the engine-side controls, the chase
// camera and the character posture, and checked headless at 30/60/144 fps
// by scripts/arena-controls.ts.

import { TAU, wrapAngle } from "./arenaMath";

export interface SpringState { x: number; v: number }

// Critically damped spring, closed form: exact for a constant target, so
// the curve is identical at any frame rate. 95% settle ~ 4.74 / omega s.
export function cdStep(s: SpringState, target: number, omega: number, dt: number) {
  const d = s.x - target;
  const c = (s.v + omega * d) * dt;
  const e = Math.exp(-omega * dt);
  s.x = target + (d + c) * e;
  s.v = (s.v - omega * c) * e;
}

// Exponential smoothing x += (T - x) * (1 - e^(-rate dt)).
export const expDamp = (x: number, target: number, rate: number, dt: number) => x + (target - x) * (1 - Math.exp(-rate * dt));
export const expDampAngle = (a: number, target: number, rate: number, dt: number) =>
  wrapAngle(a + wrapAngle(target - a) * (1 - Math.exp(-rate * dt)));

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * Math.min(1, Math.max(0, t))) - 1) / 2;
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

// Under-damped spring (lean, settle, flinch): semi-implicit Euler at a fixed
// 120 Hz substep with an accumulator, so 30, 60 and 144 fps agree to within
// one substep.
const SUB = 1 / 120;
export class BouncySpring {
  x = 0;
  v = 0;
  private acc = 0;
  private readonly c: number;
  constructor(private readonly k: number, zeta: number) {
    this.c = 2 * zeta * Math.sqrt(k);
  }
  step(target: number, dt: number) {
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= SUB) {
      this.v += (this.k * (target - this.x) - this.c * this.v) * SUB;
      this.x += this.v * SUB;
      this.acc -= SUB;
    }
    return this.x;
  }
  reset(x = 0) {
    this.x = x;
    this.v = 0;
    this.acc = 0;
  }
}

// 1 euro filter (Casiez et al.): low lag on fast motion, smooth when slow.
// Units of the signal matter for beta; touch yaw is filtered in px.
const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (TAU * cutoff * dt));
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  constructor(private readonly minCutoff = 1.5, private readonly beta = 0.02, private readonly dCutoff = 1) {}
  reset(value: number | null = null) {
    this.x = value;
    this.dx = 0;
  }
  filter(value: number, dt: number) {
    if (this.x === null || dt <= 0) {
      this.x = value;
      return value;
    }
    this.dx += alpha(this.dCutoff, dt) * ((value - this.x) / dt - this.dx);
    this.x += alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (value - this.x);
    return this.x;
  }
}
