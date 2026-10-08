// Title "wow" scene (spec 8.1), recorded into one SkPicture per frame:
//   0.30-1.30s  12 bombs drop one by one (80ms stagger) into a hex pile,
//               bouncing (restitution 0.35) with a squash on landing
//   0.90-1.70s  the logo neon-ignites like a sign tube; the "O" is a real
//               bomb whose fuse spark lights up
//   exit        the logo bomb's fuse burns down (250ms) and it detonates:
//               flash, shockwave, particles, the pile blows apart, shake,
//               then a white wipe into the game.
// Reduced motion: everything is in place and fades in over 300ms.

import { BlendMode, BlurStyle, PaintStyle, SkCanvas, Skia, SkPaint, SkPicture } from "@shopify/react-native-skia";
import { fontFor, textWidth } from "../../render/skia/fonts";
import { C, highlightC, baseC, glowC } from "../../render/skia/fx/colorTable";
import { BURST_FLASH, BURST_RING, BurstPool, ParticlePool } from "../../render/skia/fx/pools";
import { SparkDrawer } from "../../render/skia/sparks";
import { SpriteDrawer } from "../../render/skia/spriteDraw";
import { bakeBombSprites, BODY_R, FUSE_TIP, spriteScaleFor } from "../../render/skia/sprites";
import { clamp01, color, easeOutCubic, noise } from "../../render/skia/util";

const PILE = 12;
const GRAVITY = 2600;
const IGNITE_AT = 0.9;
const IGNITE_STEPS: ReadonlyArray<readonly [number, number]> = [[0, 0], [0.08, 1], [0.14, 0], [0.26, 1], [0.32, 0.3], [0.42, 1]];
const BURN = 0.25; // fuse burn-down before the detonation

interface PileBomb {
  color: number;
  tx: number; // resting position
  ty: number;
  y: number;
  vy: number;
  dropAt: number;
  landedAt: number;
  // after the detonation
  vx: number;
  x: number;
  rot: number;
}

export class TitleScene {
  private w = 0;
  private h = 0;
  private wide = false;
  private time = 0;
  private exitAt = -1;
  private pile: PileBomb[] = [];
  private bombK = 1; // pile bomb scale
  private sprites = new SpriteDrawer();
  private sparks = new SparkDrawer();
  private particles = new ParticlePool(160);
  private bursts = new BurstPool(16);
  private glow: SkPaint;
  private stroke: SkPaint;
  private fill: SkPaint;
  private flash: SkPaint;
  private shakeX = 0;
  private shakeY = 0;
  reduced = false;

  constructor() {
    this.glow = Skia.Paint();
    this.glow.setAntiAlias(true);
    this.glow.setColor(color("#FF3DCB", 0.9));
    this.glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 12, true));
    this.stroke = Skia.Paint();
    this.stroke.setAntiAlias(true);
    this.stroke.setStyle(PaintStyle.Stroke);
    this.stroke.setStrokeWidth(2);
    this.stroke.setColor(color("#22F2FF"));
    this.fill = Skia.Paint();
    this.fill.setAntiAlias(true);
    this.fill.setColor(color("#F5F3FF"));
    this.flash = Skia.Paint();
    this.flash.setColor(color("#FFFFFF"));
    this.flash.setBlendMode(BlendMode.SrcOver);
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.wide = w >= 900;
    // Hex pile resting on the horizon (38% / 45% of the screen height)
    const horizon = h * (this.wide ? 0.45 : 0.38);
    const r = Math.min(this.wide ? 26 : 17, w / 22);
    this.bombK = r / BODY_R;
    const d = r * 2.05;
    const rows = [5, 4, 3];
    this.pile = [];
    let i = 0;
    rows.forEach((count, row) => {
      for (let c = 0; c < count; c++) {
        const tx = w / 2 + (c - (count - 1) / 2) * d;
        const ty = horizon - r - 2 - row * d * 0.86;
        this.pile.push({ color: (i * 5 + row) % 6, tx, ty, y: -60, vy: 0, dropAt: 0.3 + i * 0.08, landedAt: -1, vx: 0, x: tx, rot: 0 });
        i++;
      }
    });
    this.sprites.sprites = bakeBombSprites({ scale: spriteScaleFor(this.bombK * 2.5 * 2), lowQuality: false, colourAssist: false });
  }

  skipIntro() {
    if (this.time < 2.2) this.time = 2.2;
  }

  exit() {
    if (this.exitAt < 0) this.exitAt = this.time;
  }

  // Logo layout: font size fitted to the width
  private logo() {
    const target = this.wide ? 88 : 56;
    const probe = fontFor("display", 100);
    if (!probe) return null;
    const widest = textWidth(probe, "SHOOTER") / 100;
    const size = Math.min(target, (this.w * 0.86) / widest);
    const font = fontFor("display", size);
    if (!font) return null;
    const cy = this.h * (this.wide ? 0.13 : 0.12);
    return { font, size, cy };
  }

  frame(dt: number): SkPicture {
    this.time += dt;
    const t = this.time;
    const exitT = this.exitAt < 0 ? -1 : t - this.exitAt;
    this.updatePile(dt, t, exitT);
    this.particles.update(dt);
    this.bursts.update(dt);

    // Shake (6pt, 300ms) after the detonation
    if (exitT > BURN && exitT < BURN + 0.3 && !this.reduced) {
      const a = 6 * Math.exp(-(exitT - BURN) / 0.1);
      this.shakeX = a * noise(Math.floor(t * 30));
      this.shakeY = a * noise(Math.floor(t * 30) + 99);
    } else {
      this.shakeX = this.shakeY = 0;
    }

    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording({ x: 0, y: 0, width: this.w, height: this.h });
    c.save();
    c.translate(this.shakeX, this.shakeY);
    const fade = this.reduced ? clamp01(t / 0.3) : 1;
    this.drawPile(c, fade);
    this.drawLogo(c, t, exitT, fade);
    this.bursts.draw(c);
    this.particles.draw(c);
    c.restore();
    if (exitT > BURN) {
      // White wipe into the game
      this.flash.setAlphaf(clamp01((exitT - BURN) / 0.3));
      c.drawRect({ x: 0, y: 0, width: this.w, height: this.h }, this.flash);
    }
    const pic = rec.finishRecordingAsPicture();
    rec.dispose();
    return pic;
  }

  private updatePile(dt: number, t: number, exitT: number) {
    for (const b of this.pile) {
      if (exitT > BURN) {
        // Blown apart by the logo bomb
        b.vy += GRAVITY * 0.6 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.rot += b.vx * dt;
        continue;
      }
      if (this.reduced || t > 2.2) {
        b.y = b.ty;
        b.landedAt = b.landedAt < 0 ? 0 : b.landedAt;
        continue;
      }
      if (t < b.dropAt) continue;
      if (b.y < -50 && b.vy === 0) b.y = -40;
      b.vy += GRAVITY * dt;
      b.y += b.vy * dt;
      if (b.y >= b.ty) {
        b.y = b.ty;
        if (b.vy > 140) {
          if (b.landedAt < 0) b.landedAt = t;
          b.vy = -b.vy * 0.35;
        } else b.vy = 0;
      }
    }
  }

  private drawPile(c: SkCanvas, fade: number) {
    for (const layer of [0, 1] as const) {
      for (const b of this.pile) {
        if (b.y < -45) continue;
        const since = b.landedAt < 0 ? 1 : this.time - b.landedAt;
        if (since < 0.18 && b.rot === 0) {
          const s = 1 - since / 0.18;
          this.sprites.drawTransformed(c, b.color, layer, b.x, b.y + 3 * s * this.bombK, 0, this.bombK * (1 + 0.16 * s), this.bombK * (1 - 0.14 * s), fade);
        } else if (b.rot !== 0) {
          this.sprites.drawTransformed(c, b.color, layer, b.x, b.y, b.rot, this.bombK, this.bombK, fade);
        } else {
          this.sprites.draw(c, b.color, layer, b.x, b.y, this.bombK, fade);
        }
      }
    }
  }

  private drawLogo(c: SkCanvas, t: number, exitT: number, fade: number) {
    const L = this.logo();
    if (!L) return;
    const { font, size, cy } = L;
    // Neon ignite flicker
    let alpha = 1;
    if (this.reduced) alpha = fade;
    else if (t < IGNITE_AT) alpha = 0;
    else if (t < IGNITE_AT + 0.42) {
      const k = t - IGNITE_AT;
      for (const [at, a] of IGNITE_STEPS) if (k >= at) alpha = a;
    } else alpha = 0.94 + 0.06 * Math.sin(t * 9) * Math.sin(t * 2.3);
    if (alpha <= 0) return;

    const bombD = size * 0.74;
    const k = bombD / (BODY_R * 2);
    const wB = textWidth(font, "B");
    const wMB = textWidth(font, "MB");
    const gap = size * 0.06;
    const line1 = wB + gap + bombD + gap + wMB;
    const x0 = this.w / 2 - line1 / 2;
    const base1 = cy + size * 0.36;
    const base2 = base1 + size * 1.12;
    const w2 = textWidth(font, "SHOOTER");
    const bombX = x0 + wB + gap + bombD / 2;
    const bombY = cy;

    this.glow.setAlphaf(0.9 * alpha);
    this.stroke.setAlphaf(alpha);
    this.fill.setAlphaf(alpha);
    const draw = (text: string, x: number, y: number) => {
      c.drawText(text, x, y, this.glow, font);
      c.drawText(text, x, y, this.stroke, font);
      c.drawText(text, x, y, this.fill, font);
    };
    draw("B", x0, base1);
    draw("MB", x0 + wB + gap + bombD + gap, base1);
    draw("SHOOTER", this.w / 2 - w2 / 2, base2);

    // The "O": a real bomb (hidden once it detonates)
    if (exitT < BURN) {
      this.sprites.draw(c, 0, 0, bombX, bombY, k, alpha);
      this.sprites.draw(c, 0, 1, bombX, bombY, k, alpha);
      const lit = this.reduced || t > IGNITE_AT + 0.42;
      if (lit) {
        // Burning down: the spark creeps toward the cap and grows
        const burn = exitT < 0 ? 0 : easeOutCubic(exitT / BURN);
        const sx = bombX + FUSE_TIP.x * k * (1 - 0.55 * burn);
        const sy = bombY + FUSE_TIP.y * k * (1 - 0.3 * burn);
        this.sparks.drawAt(c, sx, sy, k * (1 + 0.8 * burn), t, 1);
      }
    } else if (exitT >= BURN && !this.detonated) {
      this.detonate(bombX, bombY, k);
    }
  }

  private detonated = false;

  private detonate(x: number, y: number, k: number) {
    this.detonated = true;
    const r = BODY_R * k;
    this.bursts.spawn(BURST_FLASH, x, y, 0, r * 3.5, 0.2, highlightC(0));
    this.bursts.spawn(BURST_RING, x, y, r * 0.5, r * 7, 0.45, glowC(0), { width: 8 });
    this.bursts.spawn(BURST_RING, x, y, r * 0.3, r * 4.5, 0.35, C.gold, { width: 4, delay: 0.05 });
    const count = this.reduced ? 24 : 70;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 200 + Math.random() * 500;
      this.particles.spawn({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4, size: 3.5,
        drag: 0.93, gravity: 300, colA: i % 3 === 0 ? C.gold : baseC(0), colB: highlightC(0), additive: true, alpha: 1,
      });
    }
    for (const b of this.pile) {
      const dx = b.x - x;
      b.vx = (dx >= 0 ? 1 : -1) * (120 + Math.random() * 380);
      b.vy = -300 - Math.random() * 500;
      b.rot = 0.01;
    }
  }
}
