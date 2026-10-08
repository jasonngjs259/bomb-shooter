// Fixed-size FX pools (particles, shell shards, flashes/rings). Struct-of-
// arrays in typed arrays; dead items are swap-removed. Nothing allocates
// after construction, so a big chain reaction causes no GC churn.

import { BlendMode, PaintStyle, SkCanvas, SkColor, Skia, SkPaint, SkPath } from "@shopify/react-native-skia";
import { clamp01, easeOutCubic, mixInto } from "../util";
import { colorTable } from "./colorTable";

const scratch = new Float32Array(4) as SkColor;

// ---- Particles ---------------------------------------------------------------

export interface ParticleSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds
  size: number; // start radius (u), shrinks to 0
  drag: number; // velocity multiplier per 16ms (1 = none)
  gravity: number; // u/s^2
  colA: number; // colour table index at birth
  colB: number; // ... at death
  additive: boolean;
  alpha: number; // start alpha
}

export class ParticlePool {
  readonly cap: number;
  count = 0;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private alpha: Float32Array;
  private colA: Uint8Array;
  private colB: Uint8Array;
  private add: Uint8Array;
  private paint: SkPaint;

  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.colA = new Uint8Array(cap);
    this.colB = new Uint8Array(cap);
    this.add = new Uint8Array(cap);
    this.paint = Skia.Paint();
    this.paint.setAntiAlias(true);
  }

  get free() {
    return this.cap - this.count;
  }

  spawn(p: ParticleSpec): boolean {
    if (this.count >= this.cap) return false;
    const i = this.count++;
    this.x[i] = p.x;
    this.y[i] = p.y;
    this.vx[i] = p.vx;
    this.vy[i] = p.vy;
    this.age[i] = 0;
    this.life[i] = p.life;
    this.size[i] = p.size;
    this.drag[i] = p.drag;
    this.grav[i] = p.gravity;
    this.alpha[i] = p.alpha;
    this.colA[i] = p.colA;
    this.colB[i] = p.colB;
    this.add[i] = p.additive ? 1 : 0;
    return true;
  }

  update(dt: number) {
    if (dt <= 0) return;
    const steps = dt / 0.016;
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.remove(i);
        continue;
      }
      if (this.drag[i] < 1) {
        const k = Math.pow(this.drag[i], steps);
        this.vx[i] *= k;
        this.vy[i] *= k;
      }
      this.vy[i] += this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
  }

  draw(canvas: SkCanvas) {
    if (this.count === 0) return;
    const table = colorTable();
    const paint = this.paint;
    // Two passes so the blend mode is set only twice per frame
    for (let pass = 0; pass < 2; pass++) {
      paint.setBlendMode(pass === 0 ? BlendMode.SrcOver : BlendMode.Plus);
      for (let i = 0; i < this.count; i++) {
        if (this.add[i] !== pass) continue;
        const t = this.age[i] / this.life[i];
        const r = this.size[i] * (1 - t);
        if (r < 0.15) continue;
        paint.setColor(mixInto(scratch, table[this.colA[i]], table[this.colB[i]], t, this.alpha[i] * (1 - t * t)));
        canvas.drawCircle(this.x[i], this.y[i], r, paint);
      }
    }
  }

  clear() {
    this.count = 0;
  }

  private remove(i: number) {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.size[i] = this.size[last];
    this.drag[i] = this.drag[last];
    this.grav[i] = this.grav[last];
    this.alpha[i] = this.alpha[last];
    this.colA[i] = this.colA[last];
    this.colB[i] = this.colB[last];
    this.add[i] = this.add[last];
  }
}

// ---- Shell shards (debris) ---------------------------------------------------

const SHARD_LIFE = 0.7;
const SHARD_GRAVITY = 1400;

export class ShardPool {
  readonly cap: number;
  count = 0;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private age: Float32Array;
  private paint: SkPaint;
  private edge: SkPaint;
  private shape: SkPath;

  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.rot = new Float32Array(cap);
    this.spin = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.paint = Skia.Paint();
    this.paint.setAntiAlias(true);
    this.paint.setColor(Skia.Color("#2A2340"));
    this.edge = Skia.Paint();
    this.edge.setAntiAlias(true);
    this.edge.setStyle(PaintStyle.Stroke);
    this.edge.setStrokeWidth(0.8);
    this.edge.setColor(Skia.Color("#6E5FA8"));
    // A curved shell fragment
    this.shape = Skia.PathBuilder.Make().moveTo(-4, -2).quadTo(0, -4.5, 4.5, -1.5).lineTo(2, 2.5).lineTo(-3, 2).close().build();
  }

  spawn(x: number, y: number, vx: number, vy: number, spinDeg: number) {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.rot[i] = Math.random() * 360;
    this.spin[i] = spinDeg;
    this.age[i] = 0;
  }

  update(dt: number) {
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= SHARD_LIFE) {
        const last = --this.count;
        this.x[i] = this.x[last];
        this.y[i] = this.y[last];
        this.vx[i] = this.vx[last];
        this.vy[i] = this.vy[last];
        this.rot[i] = this.rot[last];
        this.spin[i] = this.spin[last];
        this.age[i] = this.age[last];
        continue;
      }
      this.vy[i] += SHARD_GRAVITY * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
  }

  draw(canvas: SkCanvas) {
    for (let i = 0; i < this.count; i++) {
      // Fade over the last 200ms
      const a = clamp01((SHARD_LIFE - this.age[i]) / 0.2);
      this.paint.setAlphaf(a);
      this.edge.setAlphaf(a);
      canvas.save();
      canvas.translate(this.x[i], this.y[i]);
      canvas.rotate(this.rot[i], 0, 0);
      canvas.drawPath(this.shape, this.paint);
      canvas.drawPath(this.shape, this.edge);
      canvas.restore();
    }
  }

  clear() {
    this.count = 0;
  }
}

// ---- Flashes and shockwave rings ----------------------------------------------

export const BURST_FLASH = 0; // filled circle r0->r1, alpha 1->0
export const BURST_RING = 1; // stroked ring r0->r1, width w->0
export const BURST_TICK_RING = 2; // thin ring (UI ripple)

export class BurstPool {
  readonly cap: number;
  count = 0;
  private kind: Uint8Array;
  private col: Uint8Array;
  private x: Float32Array;
  private y: Float32Array;
  private r0: Float32Array;
  private r1: Float32Array;
  private w: Float32Array;
  private age: Float32Array; // negative = delayed start
  private life: Float32Array;
  private alpha: Float32Array;
  private fill: SkPaint;
  private stroke: SkPaint;

  constructor(cap: number) {
    this.cap = cap;
    this.kind = new Uint8Array(cap);
    this.col = new Uint8Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.r0 = new Float32Array(cap);
    this.r1 = new Float32Array(cap);
    this.w = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.fill = Skia.Paint();
    this.fill.setAntiAlias(true);
    this.fill.setBlendMode(BlendMode.Plus);
    this.stroke = Skia.Paint();
    this.stroke.setAntiAlias(true);
    this.stroke.setStyle(PaintStyle.Stroke);
    this.stroke.setBlendMode(BlendMode.Plus);
  }

  spawn(kind: number, x: number, y: number, r0: number, r1: number, life: number, col: number, opts?: { width?: number; delay?: number; alpha?: number }) {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.kind[i] = kind;
    this.col[i] = col;
    this.x[i] = x;
    this.y[i] = y;
    this.r0[i] = r0;
    this.r1[i] = r1;
    this.w[i] = opts?.width ?? 2;
    this.age[i] = -(opts?.delay ?? 0);
    this.life[i] = life;
    this.alpha[i] = opts?.alpha ?? 1;
  }

  update(dt: number) {
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const last = --this.count;
        this.kind[i] = this.kind[last];
        this.col[i] = this.col[last];
        this.x[i] = this.x[last];
        this.y[i] = this.y[last];
        this.r0[i] = this.r0[last];
        this.r1[i] = this.r1[last];
        this.w[i] = this.w[last];
        this.age[i] = this.age[last];
        this.life[i] = this.life[last];
        this.alpha[i] = this.alpha[last];
        continue;
      }
      i++;
    }
  }

  draw(canvas: SkCanvas) {
    const table = colorTable();
    for (let i = 0; i < this.count; i++) {
      if (this.age[i] < 0) continue;
      const t = this.age[i] / this.life[i];
      const e = easeOutCubic(t);
      const r = this.r0[i] + (this.r1[i] - this.r0[i]) * e;
      const c = table[this.col[i]];
      if (this.kind[i] === BURST_FLASH) {
        this.fill.setColor(mixInto(scratch, c, c, 0, this.alpha[i] * (1 - t)));
        canvas.drawCircle(this.x[i], this.y[i], r, this.fill);
      } else {
        const w = this.kind[i] === BURST_RING ? this.w[i] * (1 - e) : this.w[i];
        if (w < 0.1) continue;
        this.stroke.setStrokeWidth(w);
        this.stroke.setColor(mixInto(scratch, c, c, 0, this.alpha[i] * (1 - e)));
        canvas.drawCircle(this.x[i], this.y[i], r, this.stroke);
      }
    }
  }

  clear() {
    this.count = 0;
  }
}
