// In-world text FX: floating "+30" scores, "x3 COMBO!" labels and banner
// words. A small fixed pool of reusable slots; the only allocation is the
// string itself, made once per event.

import { BlendMode, BlurStyle, PaintStyle, SkCanvas, SkColor, Skia, SkPaint } from "@shopify/react-native-skia";
import { clamp01, easeOutBack, easeOutCubic, mixInto } from "../util";
import { colorTable } from "./colorTable";
import { FontFace, fontFor, textWidth } from "../fonts";

export const TEXT_SCORE = 0; // rises 48u over 700ms, hold 400 then fade 300
export const TEXT_COMBO = 1; // scale 0->1.3->1 (260), hold 500, rise 24 + fade 300
export const TEXT_SMALL = 2; // small "+20" for dropped bombs
export const TEXT_BANNER = 3; // big centre word ("BOARD CLEAR!"), long hold

interface Slot {
  active: boolean;
  kind: number;
  text: string;
  x: number;
  y: number;
  age: number;
  delay: number;
  col: number;
  sizePt: number; // on-screen size in points
  width: number; // measured at base size (u), 0 = not measured yet
}

const LIFE = [0.7, 1.06, 0.6, 2.2];
const scratch = new Float32Array(4) as SkColor;

export class TextPool {
  private slots: Slot[];
  private fill: SkPaint;
  private stroke: SkPaint;
  private glow: SkPaint;

  constructor(cap: number) {
    this.slots = Array.from({ length: cap }, () => ({
      active: false, kind: 0, text: "", x: 0, y: 0, age: 0, delay: 0, col: 0, sizePt: 20, width: 0,
    }));
    this.fill = Skia.Paint();
    this.fill.setAntiAlias(true);
    this.stroke = Skia.Paint();
    this.stroke.setAntiAlias(true);
    this.stroke.setStyle(PaintStyle.Stroke);
    this.stroke.setColor(Skia.Color("#0B0420"));
    this.glow = Skia.Paint();
    this.glow.setAntiAlias(true);
    this.glow.setBlendMode(BlendMode.Plus);
    this.glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 6, false));
  }

  spawn(kind: number, text: string, x: number, y: number, col: number, sizePt: number, delay = 0) {
    let slot = this.slots.find((s) => !s.active);
    if (!slot) {
      // Recycle the oldest
      slot = this.slots.reduce((a, b) => (a.age > b.age ? a : b));
    }
    slot.active = true;
    slot.kind = kind;
    slot.text = text;
    slot.x = x;
    slot.y = y;
    slot.age = 0;
    slot.delay = delay;
    slot.col = col;
    slot.sizePt = sizePt;
    slot.width = 0;
  }

  update(dt: number) {
    for (const s of this.slots) {
      if (!s.active) continue;
      if (s.delay > 0) {
        s.delay -= dt;
        continue;
      }
      s.age += dt;
      if (s.age >= LIFE[s.kind]) s.active = false;
    }
  }

  // `scale` = screen points per board unit, so text keeps its point size.
  draw(canvas: SkCanvas, scale: number) {
    const table = colorTable();
    for (const s of this.slots) {
      if (!s.active || s.delay > 0) continue;
      const face: FontFace = s.kind === TEXT_SCORE || s.kind === TEXT_SMALL ? "label" : "display";
      const size = s.sizePt / scale;
      const font = fontFor(face, size);
      if (!font) continue;
      if (s.width === 0) s.width = textWidth(font, s.text);

      let k = 1;
      let dy = 0;
      let alpha = 1;
      const t = s.age;
      if (s.kind === TEXT_SCORE || s.kind === TEXT_SMALL) {
        const life = LIFE[s.kind];
        dy = -(s.kind === TEXT_SCORE ? 48 : 30) * easeOutCubic(clamp01(t / life));
        alpha = t < life - 0.3 ? 1 : clamp01((life - t) / 0.3);
      } else if (s.kind === TEXT_COMBO) {
        k = t < 0.26 ? easeOutBack(t / 0.26, 1.6) : 1;
        if (t > 0.76) {
          const f = clamp01((t - 0.76) / 0.3);
          dy = -24 * easeOutCubic(f);
          alpha = 1 - f;
        }
      } else {
        k = t < 0.35 ? easeOutBack(t / 0.35, 1.6) : 1;
        alpha = t < 1.8 ? 1 : clamp01((2.2 - t) / 0.4);
      }
      if (alpha <= 0.01 || k <= 0.01) continue;

      const c = table[s.col];
      canvas.save();
      canvas.translate(s.x, s.y + dy);
      canvas.scale(k, k);
      const x = -s.width / 2;
      const y = size * 0.36; // visually centre the cap height
      if (s.kind !== TEXT_SMALL) {
        this.glow.setColor(mixInto(scratch, c, c, 0, 0.55 * alpha));
        canvas.drawText(s.text, x, y, this.glow, font);
      }
      this.stroke.setStrokeWidth((s.kind === TEXT_SMALL ? 2 : 3) / scale);
      this.stroke.setAlphaf(alpha);
      canvas.drawText(s.text, x, y, this.stroke, font);
      this.fill.setColor(mixInto(scratch, c, c, 0, alpha));
      canvas.drawText(s.text, x, y, this.fill, font);
      canvas.restore();
    }
  }

  clear() {
    for (const s of this.slots) s.active = false;
  }
}
