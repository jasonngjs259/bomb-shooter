// Aim guide (spec section 6): marching additive dots along the engine's aim
// polyline (<= 2 bounces, <= 900u), bounce markers, a ghost bomb at the
// landing cell with a rotating dashed ring, and a shimmer outline on the
// bombs that the shot would pop.

import { BlendMode, PaintStyle, SkCanvas, SkColor, Skia, SkPaint } from "@shopify/react-native-skia";
import { AimPath, RenderTile } from "../../game/types";
import { bombColors } from "./palette";
import { SpriteDrawer } from "./spriteDraw";
import { clamp01, color, mixInto } from "./util";

const SPACING = 14;
const SKIP = 30;
const MAX_LEN = 900;
const MAX_BOUNCES = 2;
const NEIGHBOUR = 44; // hex neighbours are 39.4-40u apart

export interface AimFrame {
  path: AimPath;
  tiles: RenderTile[];
  colorIndex: number;
  alpha: number; // fade-in 0..1
  time: number;
  reducedMotion: boolean;
}

export class AimGuide {
  private dot: SkPaint;
  private ring: SkPaint;
  private dashed: SkPaint;
  private shimmer: SkPaint;
  private scratch = new Float32Array(4) as SkColor;
  private cacheTiles: RenderTile[] | null = null;
  private cacheKey = "";
  private cluster: RenderTile[] = [];

  constructor() {
    this.dot = Skia.Paint();
    this.dot.setAntiAlias(true);
    this.dot.setBlendMode(BlendMode.Plus);
    this.ring = Skia.Paint();
    this.ring.setAntiAlias(true);
    this.ring.setStyle(PaintStyle.Stroke);
    this.ring.setStrokeWidth(1.5);
    this.ring.setColor(color("#FFFFFF", 0.7));
    this.dashed = Skia.Paint();
    this.dashed.setAntiAlias(true);
    this.dashed.setStyle(PaintStyle.Stroke);
    this.dashed.setStrokeWidth(1.5);
    this.dashed.setColor(color("#FFFFFF", 0.6));
    this.dashed.setPathEffect(Skia.PathEffect.MakeDash([6, 5], 0));
    this.shimmer = Skia.Paint();
    this.shimmer.setAntiAlias(true);
    this.shimmer.setStyle(PaintStyle.Stroke);
    this.shimmer.setStrokeWidth(2);
    this.shimmer.setColor(color("#FFFFFF", 0.5));
  }

  draw(canvas: SkCanvas, sprites: SpriteDrawer, f: AimFrame) {
    if (f.alpha <= 0.01) return;
    const pts = f.path.points;
    const glow = bombColors(f.colorIndex).glow;
    const march = f.reducedMotion ? 0 : (f.time * 40) % SPACING;

    // Dots
    let travelled = 0;
    let next = SKIP + march;
    const segs = Math.min(pts.length - 1, MAX_BOUNCES + 1);
    for (let i = 1; i <= segs && travelled < MAX_LEN; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      while (next <= travelled + len && next <= MAX_LEN) {
        const t = (next - travelled) / len;
        const k = clamp01(next / MAX_LEN);
        this.dot.setColor(mixInto(this.scratch, glow, glow, 0, (0.9 - 0.75 * k) * f.alpha));
        canvas.drawCircle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 3.5 - 1.5 * k, this.dot);
        next += SPACING;
      }
      travelled += len;
    }

    // Bounce markers (interior points), 4-ray tick rotating 90 deg/s
    const spin = f.reducedMotion ? 0 : f.time * 90;
    this.ring.setAlphaf(0.7 * f.alpha);
    for (let i = 1; i < Math.min(pts.length - 1, MAX_BOUNCES + 1); i++) {
      const p = pts[i];
      canvas.drawCircle(p.x, p.y, 6, this.ring);
      canvas.save();
      canvas.translate(p.x, p.y);
      canvas.rotate(spin, 0, 0);
      for (let r = 0; r < 4; r++) {
        canvas.drawLine(0, -8, 0, -14, this.ring);
        canvas.rotate(90, 0, 0);
      }
      canvas.restore();
    }

    // Ghost landing bomb + rotating dashed ring + would-pop shimmer
    const target = f.path.target;
    if (!target) return;
    sprites.draw(canvas, f.colorIndex, 1, target.x, target.y, 1, 0.35 * f.alpha);
    this.dashed.setAlphaf(0.6 * f.alpha);
    canvas.save();
    canvas.translate(target.x, target.y);
    canvas.rotate(f.reducedMotion ? 0 : (f.time * 60) % 360, 0, 0);
    canvas.drawCircle(0, 0, 22, this.dashed);
    canvas.restore();

    const cluster = this.wouldPop(f.tiles, target.x, target.y, target.col, target.row, f.colorIndex);
    if (cluster.length > 0) {
      const pulse = 0.5 + 0.5 * Math.sin((f.time * Math.PI * 2) / 0.6);
      this.shimmer.setAlphaf((0.25 + 0.35 * pulse) * f.alpha);
      for (const t of cluster) canvas.drawCircle(t.x, t.y, 20, this.shimmer);
    }
  }

  // Same-colour tiles connected to the landing cell, if the shot would pop
  // them (3+ including the shot). Cached per tiles snapshot + target.
  private wouldPop(tiles: RenderTile[], x: number, y: number, col: number, row: number, colorIndex: number): RenderTile[] {
    const key = `${col},${row},${colorIndex}`;
    if (tiles === this.cacheTiles && key === this.cacheKey) return this.cluster;
    this.cacheTiles = tiles;
    this.cacheKey = key;
    const same = tiles.filter((t) => t.state === "idle" && t.colorIndex === colorIndex);
    const found: RenderTile[] = [];
    const seen = new Set<number>();
    const queue: { x: number; y: number }[] = [{ x, y }];
    while (queue.length) {
      const p = queue.pop();
      if (!p) break;
      for (const t of same) {
        if (seen.has(t.id)) continue;
        if ((t.x - p.x) ** 2 + (t.y - p.y) ** 2 < NEIGHBOUR * NEIGHBOUR) {
          seen.add(t.id);
          found.push(t);
          queue.push(t);
        }
      }
    }
    this.cluster = found.length + 1 >= 3 ? found : [];
    return this.cluster;
  }
}
