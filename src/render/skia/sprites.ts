// Bomb sprite factory. Each colour is baked ONCE into a CPU raster image
// (design spec section 3, layers 1-9) so the board draws image instances
// instead of rebuilding gradients and blurs per bomb per frame.
//
// Atlas layout: one 80x80u cell per colour (x), two rows (y):
//   row 0 "under": drop shadow + outer glow (drawn for all bombs first, so a
//                  bomb's glow never tints its neighbour's body)
//   row 1 "body":  sphere, rim light, glyph, specular, fuse cap, fuse, spark

import {
  BlendMode,
  BlurStyle,
  PaintStyle,
  SkCanvas,
  SkImage,
  Skia,
  SkPath,
  SkRect,
  StrokeCap,
  TileMode,
  vec,
} from "@shopify/react-native-skia";
import { BOMB_STYLES, BombStyle } from "../../ui/theme";
import { color } from "./util";

export const SPRITE_HALF = 40; // sprite covers the bomb centre +-40u
export const BODY_R = 19; // drawn radius (2u gap between neighbours)
export const FUSE_TIP = { x: 11, y: -27 }; // spark position relative to centre

export interface SpriteOptions {
  scale: number; // pixels per logical unit
  lowQuality: boolean; // smaller glow (spec section 10 low tier)
  colourAssist: boolean; // glyph alpha 0.6 instead of 0.28
}

export interface BombSprites {
  image: SkImage;
  options: SpriteOptions;
  src: (colorIndex: number, layer: 0 | 1) => SkRect;
}

export const glyphPath = (glyph: BombStyle["glyph"]): SkPath => {
  const p = Skia.PathBuilder.Make();
  switch (glyph) {
    case "triangle":
      p.moveTo(0, -4.8).lineTo(4.6, 3.6).lineTo(-4.6, 3.6).close();
      break;
    case "dot":
      p.addCircle(0, 0, 3.6);
      break;
    case "square":
      p.addRect({ x: -3.6, y: -3.6, width: 7.2, height: 7.2 });
      break;
    case "plus":
      p.addRect({ x: -4.5, y: -1.5, width: 9, height: 3 });
      p.addRect({ x: -1.5, y: -4.5, width: 3, height: 9 });
      break;
    case "diamond":
      p.moveTo(0, -5).lineTo(4.4, 0).lineTo(0, 5).lineTo(-4.4, 0).close();
      break;
    case "star":
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 5 : 2.2;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        if (i === 0) p.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else p.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      p.close();
      break;
  }
  return p.build();
};

const drawUnder = (c: SkCanvas, s: BombStyle, low: boolean) => {
  const shadow = Skia.Paint();
  shadow.setAntiAlias(true);
  shadow.setColor(color("#000000", 0.45));
  shadow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 4, true));
  c.drawOval({ x: 3 - 17, y: 6 - 7, width: 34, height: 14 }, shadow);

  const glow = Skia.Paint();
  glow.setAntiAlias(true);
  glow.setColor(color(s.glow, 0.55));
  glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Outer, low ? 5 : 8, true));
  c.drawCircle(0, 0, BODY_R, glow);
};

// Draws the live/baked spark at the fuse tip (also used per frame)
export const drawSparkLayers = (c: SkCanvas, x: number, y: number, k: number) => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setBlendMode(BlendMode.Plus);
  p.setColor(color("#FF8A3D", 0.4));
  c.drawCircle(x, y, 7 * k, p);
  p.setColor(color("#FFE27A", 0.9));
  c.drawCircle(x, y, 3 * k, p);
  p.setColor(color("#FFFFFF", 1));
  c.drawCircle(x, y, 1.5 * k, p);
};

const drawBody = (c: SkCanvas, s: BombStyle, assist: boolean, glyph: SkPath) => {
  const p = Skia.Paint();
  p.setAntiAlias(true);

  // 3. Body: radial gradient from the upper-left
  p.setShader(
    Skia.Shader.MakeRadialGradient(vec(-6, -7), 28, [color(s.highlight), color(s.base), color(s.shade)], [0, 0.45, 1], TileMode.Clamp)
  );
  c.drawCircle(0, 0, BODY_R, p);
  p.setShader(null);

  // 4. Rim light, bottom-right
  const rim = Skia.Paint();
  rim.setAntiAlias(true);
  rim.setStyle(PaintStyle.Stroke);
  rim.setStrokeWidth(2);
  rim.setShader(
    Skia.Shader.MakeLinearGradient(vec(-14, -14), vec(14, 14), [color(s.highlight, 0), color(s.highlight, 0.8)], null, TileMode.Clamp)
  );
  c.drawCircle(0, 0, BODY_R - 1, rim);

  // 5. Colour-assist glyph
  p.setColor(color("#FFFFFF", assist ? 0.6 : 0.28));
  c.drawPath(glyph, p);

  // 6. Specular highlight + glint
  const spec = Skia.Paint();
  spec.setAntiAlias(true);
  spec.setColor(color("#FFFFFF", 0.85));
  spec.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 1.5, true));
  c.save();
  c.translate(-7, -9);
  c.rotate(-30, 0, 0);
  c.drawOval({ x: -4, y: -2.5, width: 8, height: 5 }, spec);
  c.restore();
  p.setColor(color("#FFFFFF", 0.9));
  c.drawCircle(-2, -12, 1.2, p);

  // 7. Fuse cap (tilted 20 degrees right)
  c.save();
  c.translate(4, -19.5);
  c.rotate(20, 0, 0);
  p.setColor(color("#2A2340"));
  c.drawRRect({ rect: { x: -4, y: -2.5, width: 8, height: 5 }, rx: 1.5, ry: 1.5 }, p);
  const edge = Skia.Paint();
  edge.setAntiAlias(true);
  edge.setStyle(PaintStyle.Stroke);
  edge.setStrokeWidth(1);
  edge.setColor(color("#6E5FA8"));
  c.drawLine(-3.5, -2.5, 3.5, -2.5, edge);
  c.restore();

  // 8. Fuse
  const fuse = Skia.PathBuilder.Make().moveTo(6, -22).quadTo(6.5, -26.5, FUSE_TIP.x, FUSE_TIP.y).build();
  const rope = Skia.Paint();
  rope.setAntiAlias(true);
  rope.setStyle(PaintStyle.Stroke);
  rope.setStrokeWidth(2);
  rope.setStrokeCap(StrokeCap.Round);
  rope.setColor(color("#C9B48A"));
  c.drawPath(fuse, rope);

  // 9. Static spark (animated sparks are drawn live on top)
  drawSparkLayers(c, FUSE_TIP.x, FUSE_TIP.y, 0.8);
};

export const bakeBombSprites = (options: SpriteOptions): BombSprites => {
  const cellPx = Math.ceil(SPRITE_HALF * 2 * options.scale);
  const cols = BOMB_STYLES.length;
  const surface = Skia.Surface.Make(cellPx * cols, cellPx * 2);
  if (!surface) throw new Error("Could not create sprite surface");
  const c = surface.getCanvas();
  c.clear(color("#000000", 0));
  BOMB_STYLES.forEach((style, i) => {
    const glyph = glyphPath(style.glyph);
    for (const layer of [0, 1] as const) {
      c.save();
      c.translate(i * cellPx + cellPx / 2, layer * cellPx + cellPx / 2);
      c.scale(options.scale, options.scale);
      if (layer === 0) drawUnder(c, style, options.lowQuality);
      else drawBody(c, style, options.colourAssist, glyph);
      c.restore();
    }
  });
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  // A raster copy can be drawn from any thread / canvas
  const image = snapshot.makeNonTextureImage() ?? snapshot;

  const rects: SkRect[] = [];
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < cols; i++) rects.push({ x: i * cellPx, y: layer * cellPx, width: cellPx, height: cellPx });
  }
  return {
    image,
    options,
    src: (colorIndex, layer) => rects[layer * cols + (((colorIndex % cols) + cols) % cols)],
  };
};

// Pick a bake scale for the current screen scale (pixels per unit), rounded
// so small resizes don't trigger re-bakes.
export const spriteScaleFor = (pxPerUnit: number) => Math.min(4, Math.max(1, Math.ceil(pxPerUnit * 2) / 2));
