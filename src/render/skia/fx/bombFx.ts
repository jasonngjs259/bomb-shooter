// Bomb-shaped FX entities drawn with the sprite atlas:
//   PendingPops  - popped bombs waiting for their chain-stagger turn; they
//                  pre-flash (scale 1->1.25, tint white over 50ms) and then
//                  call `explode` (flash + ring + particles + debris).
//   FallingBombs - dropped bombs: jiggle 80ms, hop, gravity, spin, fade.
// Both use fixed-capacity slot arrays.

import { BlendMode, SkCanvas, SkColor, Skia, SkPaint } from "@shopify/react-native-skia";
import { bombColors } from "../palette";
import { mixInto } from "../util";
import { SpriteDrawer } from "../spriteDraw";
import { BODY_R } from "../sprites";
import { clamp01, easeOutQuad } from "../util";

const PREFLASH = 0.05;
const PREFLASH_ALPHA = 0.38; // peak tint (additive), toward the bomb's highlight
const tint = new Float32Array(4) as SkColor;

interface Pop {
  x: number;
  y: number;
  color: number;
  wait: number; // seconds until the pre-flash starts
  t: number; // pre-flash progress (s)
  particles: number; // particles to emit when it explodes
  shards: number; // shell shards to emit
}

export type ExplodeFn = (x: number, y: number, color: number, particles: number, shards: number) => void;

export class PendingPops {
  private items: Pop[] = [];
  private free: Pop[];
  private white: SkPaint;

  constructor(cap: number) {
    this.free = Array.from({ length: cap }, () => ({ x: 0, y: 0, color: 0, wait: 0, t: 0, particles: 0, shards: 0 }));
    this.white = Skia.Paint();
    this.white.setAntiAlias(true);
    this.white.setColor(Skia.Color("#FFFFFF"));
    this.white.setBlendMode(BlendMode.Plus);
  }

  get count() {
    return this.items.length;
  }

  add(x: number, y: number, color: number, wait: number, particles: number, shards: number) {
    const p = this.free.pop();
    if (!p) return false;
    p.x = x;
    p.y = y;
    p.color = color;
    p.wait = wait;
    p.t = 0;
    p.particles = particles;
    p.shards = shards;
    this.items.push(p);
    return true;
  }

  update(dt: number, explode: ExplodeFn) {
    let i = 0;
    while (i < this.items.length) {
      const p = this.items[i];
      let step = dt;
      if (p.wait > 0) {
        p.wait -= dt;
        if (p.wait > 0) {
          i++;
          continue;
        }
        step = -p.wait; // carry the remainder into the pre-flash
        p.wait = 0;
      }
      p.t += step;
      if (p.t >= PREFLASH) {
        explode(p.x, p.y, p.color, p.particles, p.shards);
        this.items[i] = this.items[this.items.length - 1];
        this.items.pop();
        this.free.push(p);
        continue;
      }
      i++;
    }
  }

  draw(canvas: SkCanvas, sprites: SpriteDrawer, layer: 0 | 1) {
    for (const p of this.items) {
      const f = p.wait > 0 ? 0 : easeOutQuad(clamp01(p.t / PREFLASH));
      const k = 1 + 0.25 * f;
      sprites.draw(canvas, p.color, layer, p.x, p.y, k);
      if (layer === 1 && f > 0) {
        // Tint toward the bomb's own highlight (slightly whitened), not pure white
        const c = bombColors(p.color);
        this.white.setColor(mixInto(tint, c.highlight, c.highlight, 0, PREFLASH_ALPHA * f));
        canvas.drawCircle(p.x, p.y, BODY_R * k, this.white);
      }
    }
  }

  clear() {
    while (this.items.length) {
      const p = this.items.pop();
      if (p) this.free.push(p);
    }
  }
}

// ---- Falling (dropped) bombs -------------------------------------------------

const JIGGLE = 0.08;
const GRAVITY = 1800;
const MAX_LIFE = 0.9;
const FADE = 0.25;

interface Fall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  age: number;
  color: number;
  crossed: boolean;
}

export class FallingBombs {
  private items: Fall[] = [];
  private free: Fall[];

  constructor(cap: number) {
    this.free = Array.from({ length: cap }, () => ({ x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0, age: 0, color: 0, crossed: false }));
  }

  add(x: number, y: number, color: number) {
    const f = this.free.pop();
    if (!f) return;
    f.x = x;
    f.y = y;
    f.vx = (Math.random() * 2 - 1) * 60;
    f.vy = -120;
    f.rot = 0;
    f.spin = (Math.random() * 2 - 1) * 180;
    f.age = 0;
    f.color = color;
    f.crossed = false;
    this.items.push(f);
  }

  // onCross is called once per bomb when it falls past `lineY`
  update(dt: number, lineY: number, onCross: (x: number, y: number) => void) {
    let i = 0;
    while (i < this.items.length) {
      const f = this.items[i];
      f.age += dt;
      if (f.age >= MAX_LIFE) {
        this.items[i] = this.items[this.items.length - 1];
        this.items.pop();
        this.free.push(f);
        continue;
      }
      if (f.age > JIGGLE) {
        f.vy += GRAVITY * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.rot += f.spin * dt;
        if (!f.crossed && f.y > lineY) {
          f.crossed = true;
          onCross(f.x, f.y);
        }
      }
      i++;
    }
  }

  draw(canvas: SkCanvas, sprites: SpriteDrawer, layer: 0 | 1) {
    for (const f of this.items) {
      const jiggle = f.age < JIGGLE ? Math.sin(f.age * 120) * 2 : 0;
      const alpha = clamp01((MAX_LIFE - f.age) / FADE);
      if (f.rot === 0) sprites.draw(canvas, f.color, layer, f.x + jiggle, f.y, 1, alpha);
      else sprites.drawTransformed(canvas, f.color, layer, f.x, f.y, f.rot, 1, 1, alpha);
    }
  }

  clear() {
    while (this.items.length) {
      const f = this.items.pop();
      if (f) this.free.push(f);
    }
  }
}
