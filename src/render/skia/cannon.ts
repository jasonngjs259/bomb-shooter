// Shooter (spec section 5): turret base with a ring in the current bomb's
// glow, a barrel that springs toward the aim angle with recoil, the current
// and next bombs (reload slide, swap arcs), live fuse sparks, and the bomb
// in flight with its ghost trail and fuse embers.

import { BlendMode, BlurStyle, PaintStyle, SkCanvas, SkColor, Skia, SkPaint, SkPath, TileMode, vec } from "@shopify/react-native-skia";
import { BombState, NextBombState, ShooterState } from "../../game/types";
import { palette } from "../../ui/theme";
import { FxSystem } from "./fx/FxSystem";
import { fontFor, textWidth } from "./fonts";
import { bombColors } from "./palette";
import { SparkDrawer } from "./sparks";
import { SpriteDrawer } from "./spriteDraw";
import { BODY_R, FUSE_TIP } from "./sprites";
import { clamp01, color, easeInOutCubic, easeOutBack, easeOutCubic, easeOutQuad, mixInto, Spring, stepSpring } from "./util";

const BARREL_LEN = 58;
const TRAIL = 10;

export interface CannonFrame {
  shooter: ShooterState;
  bomb: BombState;
  next: NextBombState;
  phase: string;
  time: number; // real seconds
  scale: number; // screen px per unit (label size)
  lowQuality: boolean;
}

export class Cannon {
  private barrel: Spring = { x: 90, v: 0 };
  private ring: SkColor = new Float32Array([0.13, 0.95, 1, 1]) as SkColor;
  private scratch = new Float32Array(4) as SkColor;
  private trail = new Float32Array(TRAIL * 2);
  private trailCount = 0;
  private trailHead = 0;
  private emberAcc = 0;
  private lastX = 0;
  private lastY = 0;
  private sparks = new SparkDrawer();
  private base: SkPaint;
  private ringPaint: SkPaint;
  private barrelPaint: SkPaint;
  private muzzle: SkPaint;
  private muzzleGlow: SkPaint;
  private socket: SkPaint;
  private label: SkPaint;
  private ghost: SkPaint;
  private basePath: SkPath;

  constructor() {
    const p = () => {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      return paint;
    };
    this.base = p();
    this.base.setShader(Skia.Shader.MakeLinearGradient(vec(0, -18), vec(0, 18), [color("#2A1F52"), color(palette.slab)], null, TileMode.Clamp));
    this.ringPaint = p();
    this.ringPaint.setStyle(PaintStyle.Stroke);
    this.ringPaint.setStrokeWidth(3);
    this.barrelPaint = p();
    this.barrelPaint.setShader(Skia.Shader.MakeLinearGradient(vec(-11, 0), vec(11, 0), [color("#3A2C6B"), color("#5A4A9B"), color(palette.slab)], [0, 0.35, 1], TileMode.Clamp));
    this.muzzle = p();
    this.muzzleGlow = p();
    this.muzzleGlow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 6, true));
    this.socket = p();
    this.socket.setStyle(PaintStyle.Stroke);
    this.socket.setStrokeWidth(1.5);
    this.socket.setColor(color("#7C5CFF", 0.5));
    this.label = p();
    this.label.setColor(color(palette.textSecondary));
    this.ghost = p();
    this.ghost.setBlendMode(BlendMode.Plus);
    // Half-disc base, flat side down, centred on the pivot
    this.basePath = Skia.PathBuilder.Make().addArc({ x: -36, y: -18, width: 72, height: 72 }, 180, 180).close().build();
  }

  update(dt: number, f: CannonFrame, fx: FxSystem) {
    // Barrel follows the aim with a spring, clamped to +-80 degrees
    const target = Math.min(170, Math.max(10, f.shooter.angle));
    stepSpring(this.barrel, target, 400, 30, dt);
    // Ring colour crossfades to the current glow (~150ms)
    const glow = bombColors(f.bomb.colorIndex).glow;
    mixInto(this.ring, this.ring, glow, clamp01(dt / 0.05), 1);

    // Flight trail + embers
    const b = f.bomb;
    if (b.inFlight) {
      if (this.trailCount > 0) {
        const dx = b.x - this.lastX;
        const dy = b.y - this.lastY;
        if (dx * dx + dy * dy > 0.01) fx.flightDir = (Math.atan2(dy, dx) * 180) / Math.PI;
      }
      this.trail[this.trailHead * 2] = b.x;
      this.trail[this.trailHead * 2 + 1] = b.y;
      this.trailHead = (this.trailHead + 1) % TRAIL;
      this.trailCount = Math.min(TRAIL, this.trailCount + 1);
      this.lastX = b.x;
      this.lastY = b.y;
      this.emberAcc += dt;
      while (this.emberAcc >= 0.03) {
        this.emberAcc -= 0.03;
        fx.ember(b.x + FUSE_TIP.x, b.y + FUSE_TIP.y, b.colorIndex);
      }
    } else {
      this.trailCount = 0;
      this.emberAcc = 0;
    }
  }

  draw(canvas: SkCanvas, sprites: SpriteDrawer, fx: FxSystem, f: CannonFrame) {
    const { shooter: s, bomb, next } = f;
    const tShoot = fx.since(fx.shootAt);
    const recoil = tShoot < 0.06 ? -8 * easeOutQuad(tShoot / 0.06) : tShoot < 0.24 ? -8 * (1 - easeOutBack((tShoot - 0.06) / 0.18, 1.6)) : 0;
    const squash = tShoot < 0.06 ? 1 - 0.06 * (tShoot / 0.06) : tShoot < 0.22 ? 0.94 + 0.06 * easeOutCubic((tShoot - 0.06) / 0.16) : 1;

    // Next-bomb socket + label
    canvas.drawCircle(next.x, next.y, 18 * 1.05, this.socket);
    const font = fontFor("label", 11 / f.scale);
    if (font) {
      const w = textWidth(font, "NEXT");
      canvas.drawText("NEXT", next.x - w / 2, next.y + 22 + 11 / f.scale, this.label, font);
    }

    // Barrel (behind the current bomb)
    canvas.save();
    canvas.translate(s.x, s.y);
    canvas.rotate(90 - this.barrel.x, 0, 0);
    canvas.translate(0, -recoil);
    canvas.drawRRect({ rect: { x: -11, y: -BARREL_LEN, width: 22, height: BARREL_LEN }, rx: 6, ry: 6 }, this.barrelPaint);
    this.muzzleGlow.setColor(this.ring);
    canvas.drawRRect({ rect: { x: -13, y: -BARREL_LEN - 3, width: 26, height: 6 }, rx: 3, ry: 3 }, this.muzzleGlow);
    this.muzzle.setColor(this.ring);
    canvas.drawRRect({ rect: { x: -13, y: -BARREL_LEN - 3, width: 26, height: 6 }, rx: 3, ry: 3 }, this.muzzle);
    canvas.restore();

    // Turret base (squashes on fire) + glow ring
    canvas.save();
    canvas.translate(s.x, s.y + 18);
    canvas.scale(1, squash);
    canvas.translate(0, -18);
    canvas.drawPath(this.basePath, this.base);
    this.ringPaint.setColor(this.ring);
    canvas.drawPath(this.basePath, this.ringPaint);
    canvas.restore();

    // Current + next bombs, with reload slide and swap arcs
    const tReload = fx.since(fx.reloadAt);
    const tSwap = fx.since(fx.swapAt);
    let cx = s.x;
    let cy = s.y;
    let ck = 1;
    let nx = next.x;
    let ny = next.y;
    let nk = 0.75;
    if (tSwap >= 0 && tSwap < 0.22) {
      const e = easeInOutCubic(tSwap / 0.22);
      const mx = (s.x + next.x) / 2;
      const r = (s.x - next.x) / 2;
      // Current came from the socket over the top; next goes under
      const th = Math.PI * (1 - e);
      cx = mx + r * Math.cos(th);
      cy = s.y - 38 * Math.sin(th);
      ck = 0.75 + 0.25 * e;
      nx = mx - r * Math.cos(th);
      ny = s.y + 38 * Math.sin(th) * 0.5;
      nk = 1 - 0.25 * e;
    } else if (tReload >= 0 && tReload < 0.2) {
      const e = easeOutCubic(clamp01(tReload / 0.16));
      cx = next.x + (s.x - next.x) * e;
      ck = 0.75 + 0.25 * e;
      nk = 0.75 * easeOutBack(clamp01(tReload / 0.2), 1.6);
    }

    const showCurrent = bomb.visible && !bomb.inFlight;
    const live = f.phase === "ready" || f.phase === "shooting" || f.phase === "resolving";
    if (live) {
      sprites.draw(canvas, next.colorIndex, 0, nx, ny, nk);
      sprites.draw(canvas, next.colorIndex, 1, nx, ny, nk);
      if (!f.lowQuality) this.sparks.draw(canvas, nx, ny, nk, f.time, 7);
    }
    if (showCurrent && live) {
      sprites.draw(canvas, bomb.colorIndex, 0, cx, cy, ck * 1.08, 0.8); // extra glow
      sprites.draw(canvas, bomb.colorIndex, 0, cx, cy, ck);
      sprites.draw(canvas, bomb.colorIndex, 1, cx, cy, ck);
      this.sparks.draw(canvas, cx, cy, ck, f.time, 3);
    }

    // Bomb in flight + ghost trail
    if (bomb.inFlight && bomb.visible) {
      const glow = bombColors(bomb.colorIndex).glow;
      for (let i = 0; i < this.trailCount; i++) {
        // i = 0 newest
        const idx = (this.trailHead - 1 - i + TRAIL * 2) % TRAIL;
        const k = 1 - i / TRAIL;
        this.ghost.setColor(mixInto(this.scratch, glow, glow, 0, 0.5 * k * k));
        canvas.drawCircle(this.trail[idx * 2], this.trail[idx * 2 + 1], BODY_R * (0.3 + 0.55 * k), this.ghost);
      }
      sprites.draw(canvas, bomb.colorIndex, 0, bomb.x, bomb.y);
      sprites.draw(canvas, bomb.colorIndex, 1, bomb.x, bomb.y);
      this.sparks.draw(canvas, bomb.x, bomb.y, 1, f.time, 5);
    }
  }
}
