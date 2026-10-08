// Draws bomb sprite instances with one reusable paint and rect (no per-draw
// allocation). Linear filtering: the atlas is baked near the screen scale.

import { FilterMode, MipmapMode, SkCanvas, Skia, SkPaint } from "@shopify/react-native-skia";
import { BombSprites, SPRITE_HALF } from "./sprites";
import { mutRect, setRect } from "./util";

export class SpriteDrawer {
  sprites: BombSprites | null = null;
  private paint: SkPaint;
  private dst = mutRect();

  constructor() {
    this.paint = Skia.Paint();
    this.paint.setAntiAlias(true);
  }

  // Axis-aligned instance centred at (x, y), uniform scale k
  draw(canvas: SkCanvas, colorIndex: number, layer: 0 | 1, x: number, y: number, k = 1, alpha = 1) {
    const s = this.sprites;
    if (!s || alpha <= 0.004) return;
    const half = SPRITE_HALF * k;
    this.paint.setAlphaf(alpha);
    canvas.drawImageRectOptions(
      s.image,
      s.src(colorIndex, layer),
      setRect(this.dst, x - half, y - half, half * 2, half * 2),
      FilterMode.Linear,
      MipmapMode.None,
      this.paint
    );
  }

  // Instance with rotation (degrees) and non-uniform scale (squash/stretch).
  // The scale axes are rotated by `axisDeg` first (squash along velocity).
  drawTransformed(
    canvas: SkCanvas,
    colorIndex: number,
    layer: 0 | 1,
    x: number,
    y: number,
    rotDeg: number,
    sx: number,
    sy: number,
    alpha = 1,
    axisDeg = 0
  ) {
    canvas.save();
    canvas.translate(x, y);
    if (axisDeg !== 0) canvas.rotate(axisDeg, 0, 0);
    canvas.scale(sx, sy);
    if (rotDeg - axisDeg !== 0) canvas.rotate(rotDeg - axisDeg, 0, 0);
    this.draw(canvas, colorIndex, layer, 0, 0, 1, alpha);
    canvas.restore();
  }
}
