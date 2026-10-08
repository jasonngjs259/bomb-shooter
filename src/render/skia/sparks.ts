// Live fuse sparks (spec section 3, layer 9). Only the current + next bombs
// and, in danger, the bottom-row bombs get a flickering spark; everything
// else shows the static spark baked into the sprite.

import { BlendMode, SkCanvas, Skia, SkPaint } from "@shopify/react-native-skia";
import { FUSE_TIP } from "./sprites";
import { color, noise } from "./util";

export class SparkDrawer {
  private halo: SkPaint;
  private mid: SkPaint;
  private core: SkPaint;

  constructor() {
    const mk = (hex: string, a: number) => {
      const p = Skia.Paint();
      p.setAntiAlias(true);
      p.setBlendMode(BlendMode.Plus);
      p.setColor(color(hex, a));
      return p;
    };
    this.halo = mk("#FF8A3D", 0.4);
    this.mid = mk("#FFE27A", 0.9);
    this.core = mk("#FFFFFF", 1);
  }

  // Flicker scale 0.8..1.25, re-randomised every 50ms per seed
  flicker(time: number, seed: number) {
    return 0.8 + 0.45 * (0.5 + 0.5 * noise(Math.floor(time * 20) * 7.13 + seed * 3.7));
  }

  // Spark at the fuse tip of a bomb centred at (x, y) drawn at scale k
  draw(canvas: SkCanvas, x: number, y: number, k: number, time: number, seed: number) {
    this.drawAt(canvas, x + FUSE_TIP.x * k, y + FUSE_TIP.y * k, k, time, seed);
  }

  // Spark centred exactly at (sx, sy)
  drawAt(canvas: SkCanvas, sx: number, sy: number, k: number, time: number, seed: number) {
    const f = this.flicker(time, seed);
    canvas.drawCircle(sx, sy, 7 * k * f * 1.15, this.halo);
    canvas.drawCircle(sx, sy, 3 * k * f, this.mid);
    canvas.drawCircle(sx, sy, 1.5 * k * f, this.core);
  }
}
