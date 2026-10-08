// Synthwave background, drawn in screen space (spec section 4):
// sky gradient -> twinkling stars -> slatted sun + glow -> horizon glow ->
// floor with a perspective grid that drifts toward the viewer.
// Shaders and the sun path are cached per screen size; per frame we only
// rebuild one grid path and set a few paint values.

import { PaintStyle, PathOp, SkCanvas, SkColor, Skia, SkPaint, SkPath, SkShader, TileMode, vec } from "@shopify/react-native-skia";
import { palette } from "../../ui/theme";
import { sceneColors } from "./palette";
import { clamp01, color, mixInto } from "./util";

const STARS = 60;
const STARS_LOW = 20;
const GRID_SPEED = 0.25; // cells per second
const VERTICALS = 21;

export interface BackgroundFrame {
  time: number; // real seconds
  parallax: number; // px, already spring-smoothed
  heat: number; // 0..1 - grid lerps toward danger
  pulse: number; // 0..1 - extra grid brightness (ceiling slam)
  lowQuality: boolean;
  reducedMotion: boolean;
}

export class Background {
  private w = 0;
  private h = 0;
  private horizon = 0;
  private sunR = 0;
  private sunCy = 0;
  private sky: SkPaint;
  private floor: SkPaint;
  private sun: SkPaint;
  private sunGlow: SkPaint;
  private band: SkPaint;
  private gridV: SkPaint;
  private gridVHot: SkPaint;
  private gridH: SkPaint;
  private star: SkPaint;
  private vignette: SkPaint;
  private flash: SkPaint;
  private sunPath: SkPath = Skia.Path.Make();
  private vPath = Skia.PathBuilder.Make();
  private stars = new Float32Array(STARS * 4); // x(0..1), y(0..1), phase, speed
  private scratch = new Float32Array(4) as SkColor;

  constructor() {
    const p = () => {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      return paint;
    };
    this.sky = p();
    this.floor = p();
    this.floor.setColor(color(palette.bgFloor));
    this.sun = p();
    this.sunGlow = p();
    this.band = p();
    this.gridV = p();
    this.gridV.setStyle(PaintStyle.Stroke);
    this.gridV.setStrokeWidth(1.2);
    this.gridVHot = p();
    this.gridVHot.setStyle(PaintStyle.Stroke);
    this.gridVHot.setStrokeWidth(1.2);
    this.gridH = p();
    this.gridH.setStyle(PaintStyle.Stroke);
    this.star = p();
    this.vignette = p();
    this.flash = p();
    this.flash.setColor(color("#FFFFFF"));
    for (let i = 0; i < STARS; i++) {
      this.stars[i * 4] = Math.random();
      this.stars[i * 4 + 1] = Math.pow(Math.random(), 1.3) * 0.92;
      this.stars[i * 4 + 2] = Math.random() * Math.PI * 2;
      this.stars[i * 4 + 3] = 0.6 + Math.random() * 2.2;
    }
  }

  get horizonY() {
    return this.horizon;
  }

  resize(w: number, h: number, wide: boolean) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.horizon = Math.round(h * (wide ? 0.45 : 0.38));
    const hz = this.horizon;
    const s = sceneColors();

    this.sky.setShader(
      Skia.Shader.MakeLinearGradient(vec(0, 0), vec(0, hz), [color(palette.bgTop), color(palette.bgMid), color(palette.bgHorizon)], [0, 0.62, 1], TileMode.Clamp)
    );
    this.floor.setShader(
      Skia.Shader.MakeLinearGradient(vec(0, hz), vec(0, h), [color("#1A0530"), color(palette.bgFloor)], [0, 0.5], TileMode.Clamp)
    );

    // Sun: centred a little above the horizon so its slatted lower half shows
    const R = Math.min(w * 0.26, 220);
    this.sunR = R;
    this.sunCy = hz - R * 0.42;
    this.sun.setShader(
      Skia.Shader.MakeLinearGradient(vec(0, -R), vec(0, R * 0.35), [color(palette.sunTop), color(palette.sunBottom)], null, TileMode.Clamp)
    );
    const slits = Skia.PathBuilder.Make();
    const heights = [2, 3, 4, 5, 6, 8];
    const k = R / 110;
    heights.forEach((ht, i) => {
      const y = R * 0.06 + i * 10 * k * 1.15;
      slits.addRect({ x: -R - 2, y, width: 2 * R + 4, height: ht * k });
    });
    this.sunPath = Skia.Path.MakeFromOp(Skia.Path.Circle(0, 0, R), slits.build(), PathOp.Difference) ?? Skia.Path.Circle(0, 0, R);
    this.sunGlow.setShader(
      Skia.Shader.MakeRadialGradient(vec(0, 0), R * 1.7, [color(palette.sunBottom, 0.5), color(palette.sunBottom, 0.35), color(palette.sunBottom, 0)], [0, 0.58, 1], TileMode.Clamp)
    );

    this.band.setShader(
      Skia.Shader.MakeLinearGradient(
        vec(0, hz - 14),
        vec(0, hz + 14),
        [color(palette.horizonGlowB, 0), color(palette.horizonGlowB, 0.55), color(palette.horizonGlowA, 0.55), color(palette.horizonGlowA, 0)],
        [0, 0.42, 0.58, 1],
        TileMode.Clamp
      )
    );

    const gridShader = (near: SkColor, nearA: number, far: SkColor, farA: number) =>
      Skia.Shader.MakeLinearGradient(vec(0, hz), vec(0, h), [mixInto(new Float32Array(4) as SkColor, far, far, 0, farA), mixInto(new Float32Array(4) as SkColor, near, near, 0, nearA)], null, TileMode.Clamp);
    this.gridV.setShader(gridShader(s.gridNear, 0.6, s.gridFar, 0.15));
    this.gridVHot.setShader(gridShader(s.danger, 0.75, s.danger, 0.2));

    const vr = Math.hypot(w, h) * 0.75;
    this.vignette.setShader(
      Skia.Shader.MakeRadialGradient(vec(w / 2, h / 2), vr, [color(palette.danger, 0), color(palette.danger, 0), color(palette.danger, 1)], [0, 0.6, 1], TileMode.Clamp)
    );
  }

  draw(canvas: SkCanvas, f: BackgroundFrame) {
    const { w, h } = this;
    const hz = this.horizon;
    const s = sceneColors();

    canvas.drawRect({ x: 0, y: 0, width: w, height: hz + 1 }, this.sky);

    // Stars
    const n = f.lowQuality ? STARS_LOW : STARS;
    const still = f.reducedMotion || f.lowQuality;
    for (let i = 0; i < n; i++) {
      const sx = this.stars[i * 4] * w + f.parallax * 0.15;
      const sy = this.stars[i * 4 + 1] * hz;
      const tw = still ? 0.5 : 0.5 + 0.5 * Math.sin(f.time * this.stars[i * 4 + 3] + this.stars[i * 4 + 2]);
      this.star.setColor(mixInto(this.scratch, s.star, s.star, 0, 0.2 + 0.6 * tw));
      canvas.drawCircle(sx, sy, i % 7 === 0 ? 1.4 : 0.9, this.star);
    }

    // Sun + glow
    const sunX = w / 2 + f.parallax * 0.3;
    canvas.save();
    canvas.translate(sunX, this.sunCy);
    canvas.drawCircle(0, 0, this.sunR * 1.7, this.sunGlow);
    canvas.drawPath(this.sunPath, this.sun);
    canvas.restore();

    // Floor + horizon glow
    canvas.drawRect({ x: 0, y: hz, width: w, height: h - hz }, this.floor);
    canvas.drawRect({ x: 0, y: hz - 14, width: w, height: 28 }, this.band);

    this.drawGrid(canvas, f);
  }

  private drawGrid(canvas: SkCanvas, f: BackgroundFrame) {
    const { w, h } = this;
    const hz = this.horizon;
    const s = sceneColors();
    const vx = w / 2 + f.parallax;
    const depth = h - hz;
    const boost = 1 + 0.6 * f.pulse;
    const heat = clamp01(f.heat);

    // Converging lines: one path, gradient stroke (normal + hot cross-fade)
    const builder = this.vPath;
    builder.reset();
    const spread = w * 2.4;
    for (let i = 0; i < VERTICALS; i++) {
      const bx = vx - spread / 2 + (spread * i) / (VERTICALS - 1);
      builder.moveTo(vx + (bx - vx) * 0.02, hz);
      builder.lineTo(bx, h);
    }
    const path = builder.detach();
    if (heat < 1) {
      this.gridV.setAlphaf(clamp01((1 - heat) * boost));
      canvas.drawPath(path, this.gridV);
    }
    if (heat > 0) {
      this.gridVHot.setAlphaf(clamp01(heat * boost));
      canvas.drawPath(path, this.gridVHot);
    }

    // Horizontal lines at y = horizon + depth / z, scrolling toward the viewer
    const drift = f.reducedMotion || f.lowQuality ? 0 : (f.time * GRID_SPEED) % 1;
    for (let i = 1; i <= 16; i++) {
      const z = i - drift;
      if (z <= 0.05) continue;
      const y = hz + (depth * 0.9) / z;
      if (y > h + 2) continue;
      const near = clamp01((y - hz) / depth);
      this.gridH.setStrokeWidth(0.5 + 1.0 * near);
      const alpha = (0.15 + 0.45 * near) * boost;
      mixInto(this.scratch, s.gridFar, s.gridNear, near, clamp01(alpha));
      if (heat > 0) mixInto(this.scratch, this.scratch, s.danger, heat, this.scratch[3]);
      this.gridH.setColor(this.scratch);
      canvas.drawLine(0, y, w, y, this.gridH);
    }
  }

  // Red screen-edge glow for danger (alpha 0.35 * d^2)
  drawVignette(canvas: SkCanvas, danger: number) {
    if (danger <= 0.01) return;
    this.vignette.setAlphaf(0.35 * danger * danger);
    canvas.drawRect({ x: 0, y: 0, width: this.w, height: this.h }, this.vignette);
  }

  drawFlash(canvas: SkCanvas, alpha: number) {
    if (alpha <= 0.004) return;
    this.flash.setAlphaf(alpha);
    canvas.drawRect({ x: 0, y: 0, width: this.w, height: this.h }, this.flash);
  }
}
