// Board furniture in board units (spec section 4): backplate with cell dots,
// ceiling slab (hazard stripe, rivets, shot pips, rattle + slam), danger
// line, and the neon side rails (pulse, bounce flashes, win colour chase).

import { BlurStyle, ClipOp, PaintStyle, SkCanvas, SkColor, Skia, SkPaint, SkPath, TileMode, vec } from "@shopify/react-native-skia";
import { CEILING_EVERY_SHOTS } from "../../game/constants";
import { BoardMetrics } from "../../game/types";
import { palette } from "../../ui/theme";
import { colorTable, FIREWORK_COLORS } from "./fx/colorTable";
import { sceneColors } from "./palette";
import { clamp01, color, easeOutQuad, lerp, mixInto } from "./util";

export const SLAB_H = 26; // permanent slab above the board
export const RAIL_X = 5; // rail centre distance outside the walls

export interface FrameState {
  time: number; // real seconds (pulses)
  ceilingBottom: number; // y of the slab's bottom edge incl. slam offset
  rattle: number; // x offset (u)
  shotsUntilCeiling: number;
  danger: number;
  gameOverT: number; // seconds since game over (<0 = not over)
  railLeft: { t: number; y: number }; // t = seconds since flash
  railRight: { t: number; y: number };
  railFullT: number;
  wonT: number;
}

export class BoardFrame {
  private back: SkPaint;
  private dots: SkPaint;
  private dotPaths: SkPath[] = [];
  private slab: SkPaint;
  private slabEdge: SkPaint;
  private stripeA: SkPaint;
  private stripes: SkPath;
  private underline: SkPaint;
  private underGlow: SkPaint;
  private rivet: SkPaint;
  private pip: SkPaint;
  private pipEdge: SkPaint;
  private pipPath: SkPath;
  private danger: SkPaint;
  private dangerGlow: SkPaint;
  private railGlow: SkPaint[];
  private railTube: SkPaint;
  private railCore: SkPaint;
  private scratch = new Float32Array(4) as SkColor;

  constructor(private readonly m: BoardMetrics) {
    const p = (style: PaintStyle = PaintStyle.Fill) => {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      paint.setStyle(style);
      return paint;
    };
    this.back = p();
    this.back.setColor(color("#0E0628", 0.72));
    this.dots = p();
    this.dots.setColor(color("#FFFFFF", 0.05));
    for (let parity = 0; parity < 2; parity++) {
      const path = Skia.PathBuilder.Make();
      for (let row = 0; row < m.rows; row++) {
        for (let col = 0; col < m.columns; col++) {
          const x = col * m.tileSize + m.tileSize / 2 + ((row + parity) % 2 ? m.tileSize / 2 : 0);
          path.addCircle(x, row * m.rowHeight + m.tileSize / 2, 1.5);
        }
      }
      this.dotPaths.push(path.build());
    }

    this.slab = p();
    this.slab.setShader(
      Skia.Shader.MakeLinearGradient(vec(0, -SLAB_H), vec(0, m.rowHeight), [color("#2E2260"), color("#221849")], null, TileMode.Mirror)
    );
    this.slabEdge = p(PaintStyle.Stroke);
    this.slabEdge.setStrokeWidth(1.5);
    this.slabEdge.setColor(color(palette.slabEdge));
    this.stripeA = p();
    this.stripeA.setColor(color(palette.magenta));
    const stripes = Skia.PathBuilder.Make();
    for (let x = -12; x < m.width + 12; x += 12) {
      stripes.moveTo(x, 8).lineTo(x + 6, 8).lineTo(x + 14, 0).lineTo(x + 8, 0).close();
    }
    this.stripes = stripes.build();
    this.underline = p();
    this.underline.setColor(color(palette.magenta));
    this.underGlow = p();
    this.underGlow.setColor(color(palette.magenta, 0.8));
    this.underGlow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 8, true));
    this.rivet = p();
    this.rivet.setColor(color(palette.rivet));
    this.pip = p();
    this.pipEdge = p(PaintStyle.Stroke);
    this.pipEdge.setStrokeWidth(1);
    this.pipEdge.setColor(color(palette.magenta, 0.6));
    this.pipPath = Skia.PathBuilder.Make().moveTo(0, -4.5).lineTo(4.5, 0).lineTo(0, 4.5).lineTo(-4.5, 0).close().build();

    this.danger = p(PaintStyle.Stroke);
    this.danger.setStrokeWidth(2);
    this.danger.setPathEffect(Skia.PathEffect.MakeDash([8, 6], 0));
    this.dangerGlow = p(PaintStyle.Stroke);
    this.dangerGlow.setStrokeWidth(7);

    // Rail glows: horizontal gradient strips, built once in board units
    this.railGlow = [-RAIL_X, m.width + RAIL_X].map((x) => {
      const paint = p();
      paint.setShader(
        Skia.Shader.MakeLinearGradient(vec(x - 14, 0), vec(x + 14, 0), [color(palette.rail, 0), color(palette.rail, 0.6), color(palette.rail, 0)], null, TileMode.Clamp)
      );
      return paint;
    });
    this.railTube = p(PaintStyle.Stroke);
    this.railTube.setStrokeWidth(4);
    this.railCore = p(PaintStyle.Stroke);
    this.railCore.setStrokeWidth(1.5);
    this.railCore.setColor(color("#FFFFFF"));
  }

  drawBack(canvas: SkCanvas, parity: number) {
    const m = this.m;
    canvas.drawRRect({ rect: { x: -RAIL_X - 4, y: -SLAB_H - 4, width: m.width + 2 * RAIL_X + 8, height: m.height + SLAB_H + 8 }, rx: 18, ry: 18 }, this.back);
    canvas.drawPath(this.dotPaths[parity & 1], this.dots);
  }

  drawSlab(canvas: SkCanvas, f: FrameState) {
    const m = this.m;
    const bottom = f.ceilingBottom;
    const top = -SLAB_H;
    canvas.save();
    canvas.translate(f.rattle, 0);
    canvas.drawRect({ x: 0, y: top, width: m.width, height: bottom - top }, this.slab);
    canvas.drawLine(0, top + 1, m.width, top + 1, this.slabEdge);
    // Pushed-in ceiling rows: riveted metal panels with seams
    for (let y = 0; y < bottom - 9; y += m.rowHeight) {
      canvas.drawLine(0, y, m.width, y, this.slabEdge);
      for (let x = 14; x < m.width; x += (m.width - 28) / 6) canvas.drawCircle(x, y + 12, 1.8, this.rivet);
    }

    // Hazard stripe band + neon underline
    canvas.save();
    canvas.clipRect({ x: 0, y: bottom - 8, width: m.width, height: 8 }, ClipOp.Intersect, true);
    canvas.translate(0, bottom - 8);
    canvas.drawPath(this.stripes, this.stripeA);
    canvas.restore();
    canvas.drawRect({ x: 0, y: bottom - 1, width: m.width, height: 3 }, this.underGlow);
    canvas.drawRect({ x: 0, y: bottom - 1, width: m.width, height: 2 }, this.underline);

    // Rivets and shot pips on the permanent slab face
    const faceY = top + 11;
    for (let i = 0; i < 5; i++) canvas.drawCircle(18 + (i * (m.width - 36)) / 4, faceY, 2, this.rivet);
    const fired = CEILING_EVERY_SHOTS - f.shotsUntilCeiling;
    const lastShot = f.shotsUntilCeiling === 1;
    const blinkOn = Math.floor(f.time * 8) % 2 === 0; // 4Hz
    const s = sceneColors();
    for (let i = 0; i < CEILING_EVERY_SHOTS; i++) {
      const x = m.width / 2 + (i - (CEILING_EVERY_SHOTS - 1) / 2) * 16;
      canvas.save();
      canvas.translate(x, faceY);
      if (lastShot) {
        this.pip.setColor(blinkOn ? s.danger : s.slabEdge);
        canvas.drawPath(this.pipPath, this.pip);
      } else if (i < fired) {
        this.pip.setColor(s.magenta);
        canvas.drawPath(this.pipPath, this.pip);
      }
      canvas.drawPath(this.pipPath, this.pipEdge);
      canvas.restore();
    }
    canvas.restore();
  }

  drawDangerLine(canvas: SkCanvas, f: FrameState) {
    const y = this.m.deadlineY;
    const s = sceneColors();
    let alpha: number;
    if (f.gameOverT >= 0.12 && f.gameOverT < 1.02) {
      // Game over: flashes solid three times (300ms each)
      alpha = Math.floor((f.gameOverT - 0.12) / 0.15) % 2 === 0 ? 1 : 0.15;
    } else {
      const period = lerp(1.2, 0.4, f.danger);
      const pulse = 0.75 + 0.25 * Math.sin((f.time * Math.PI * 2) / period);
      alpha = (0.25 + 0.6 * f.danger) * pulse;
    }
    this.dangerGlow.setColor(mixInto(this.scratch, s.danger, s.danger, 0, alpha * 0.22));
    canvas.drawLine(0, y, this.m.width, y, this.dangerGlow);
    this.danger.setColor(mixInto(this.scratch, s.danger, s.danger, 0, alpha));
    canvas.drawLine(0, y, this.m.width, y, this.danger);
  }

  drawRails(canvas: SkCanvas, f: FrameState) {
    const m = this.m;
    const y0 = -SLAB_H;
    const y1 = m.height;
    const base = 0.7 + 0.1 * Math.sin((f.time * Math.PI * 2) / 2.4);
    const full = f.railFullT >= 0 && f.railFullT < 0.25 ? 1 - easeOutQuad(f.railFullT / 0.25) : 0;
    const chase = f.wonT >= 0 && f.wonT < 1.2;
    const table = colorTable();
    const s = sceneColors();

    for (let side = 0; side < 2; side++) {
      const x = side === 0 ? -RAIL_X : m.width + RAIL_X;
      const a = clamp01(base + (1 - base) * full);
      this.railGlow[side].setAlphaf(a);
      canvas.drawRect({ x: x - 14, y: y0, width: 28, height: y1 - y0 }, this.railGlow[side]);

      if (chase) {
        // Palette colour chase: 12 segments cycling through the firework colours
        const seg = (y1 - y0) / 12;
        for (let i = 0; i < 12; i++) {
          const ci = FIREWORK_COLORS[(i + Math.floor(f.wonT * 14)) % FIREWORK_COLORS.length];
          this.railTube.setColor(table[ci]);
          canvas.drawLine(x, y0 + i * seg, x, y0 + (i + 1) * seg, this.railTube);
        }
      } else {
        this.railTube.setColor(mixInto(this.scratch, s.cyan, s.cyan, 0, a));
        canvas.drawLine(x, y0, x, y1, this.railTube);
      }
      this.railCore.setAlphaf(clamp01(0.6 + 0.4 * full));
      canvas.drawLine(x, y0, x, y1, this.railCore);

      // Bounce flash: a 40u segment, alpha 1 -> base over 250ms
      const flash = side === 0 ? f.railLeft : f.railRight;
      if (flash.t >= 0 && flash.t < 0.25) {
        const k = 1 - easeOutQuad(flash.t / 0.25);
        this.railTube.setStrokeWidth(8);
        this.railTube.setColor(mixInto(this.scratch, s.white, s.cyan, 0.3, k));
        canvas.drawLine(x, flash.y - 20, x, flash.y + 20, this.railTube);
        this.railTube.setStrokeWidth(4);
      }
    }
  }
}
