// NeonScene: the per-frame orchestrator of the Skia renderer. Each frame it
// reads the engine getters, steps the FX system, and records ONE SkPicture
// (background in screen space, then the board group with shake, then the
// vignette and screen flash). No React involved.

import { PixelRatio } from "react-native";
import { SkCanvas, Skia, SkPicture } from "@shopify/react-native-skia";
import type { SimClock } from "../../game/simClock";
import type { GameEngineView } from "../../game/types";
import { settingsStore } from "../../storage/settings";
import type { BoardLayout } from "../layout";
import { AimGuide } from "./aimGuide";
import { Background } from "./background";
import { BoardFrame, FrameState } from "./boardFrame";
import { BoardBombs, BombsFrame } from "./bombs";
import { Cannon, CannonFrame } from "./cannon";
import { attachFxEvents } from "./fx/fxEvents";
import { FxSystem } from "./fx/FxSystem";
import { QualityMonitor } from "./quality";
import { SpriteDrawer } from "./spriteDraw";
import { bakeBombSprites, spriteScaleFor } from "./sprites";
import { clamp01, easeInQuad, easeOutQuad, Spring, stepSpring } from "./util";

const PARALLAX = 8;

export class NeonScene {
  clock: SimClock | undefined;
  showAim = false;

  private readonly fx: FxSystem;
  private readonly quality = new QualityMonitor();
  private readonly background = new Background();
  private readonly frameLayer: BoardFrame;
  private readonly bombs = new BoardBombs();
  private readonly cannon = new Cannon();
  private readonly aim = new AimGuide();
  private readonly sprites = new SpriteDrawer();
  private readonly detach: () => void;
  private layout: BoardLayout | null = null;
  private wide = false;
  private time = 0;
  private aimAlpha = 0;
  private danger = 0;
  private parallax: Spring = { x: 0, v: 0 };
  private bakeKey = "";

  // Reused per-frame state objects
  private readonly fs: FrameState = {
    time: 0, ceilingBottom: 0, rattle: 0, shotsUntilCeiling: 5, danger: 0, gameOverT: -1,
    railLeft: { t: -1, y: 0 }, railRight: { t: -1, y: 0 }, railFullT: -1, wonT: -1,
  };
  private readonly bf: BombsFrame;
  private readonly cf: CannonFrame;

  constructor(private readonly engine: GameEngineView) {
    this.fx = new FxSystem({
      lowQuality: () => this.quality.low,
      reducedMotion: () => settingsStore.reducedMotion(),
    });
    this.frameLayer = new BoardFrame(engine.getBoardMetrics());
    this.detach = attachFxEvents(engine, this.fx, () => this.clock, () => this.wide);
    this.bf = { slamDy: 0, snap: this.fx.snap, snapT: -1, hidden: false, time: 0, dangerSparks: false };
    this.cf = {
      shooter: engine.getShooter(), bomb: engine.getBomb(), next: engine.getNextBomb(),
      phase: "title", time: 0, scale: 1, lowQuality: false,
    };
  }

  setLayout(layout: BoardLayout) {
    this.layout = layout;
    this.wide = layout.containerWidth >= 1100;
    this.background.resize(layout.containerWidth, layout.containerHeight, this.wide);
  }

  dispose() {
    this.detach();
  }

  private ensureSprites(scale: number) {
    const opts = {
      scale: spriteScaleFor(scale * PixelRatio.get()),
      lowQuality: this.quality.low,
      colourAssist: settingsStore.get().colourAssist,
    };
    const key = `${opts.scale}|${opts.lowQuality}|${opts.colourAssist}`;
    if (key === this.bakeKey && this.sprites.sprites) return;
    this.bakeKey = key;
    this.sprites.sprites = bakeBombSprites(opts);
  }

  // Advance and record one frame. Returns null until the layout is known.
  frame(realDt: number, simDt: number): SkPicture | null {
    const layout = this.layout;
    if (!layout) return null;
    const e = this.engine;
    const fx = this.fx;
    const s = layout.scale;
    const reduced = settingsStore.reducedMotion();
    const phase = e.getPhase();
    const playing = phase === "ready" || phase === "shooting" || phase === "resolving";
    const fxDt = Math.min(this.clock ? simDt : realDt, 0.05);
    this.time += realDt;
    this.quality.sample(realDt, playing);
    this.ensureSprites(s);

    fx.update(fxDt);
    const shooter = e.getShooter();
    const bomb = e.getBomb();
    const cf = this.cf;
    cf.shooter = shooter;
    cf.bomb = bomb;
    cf.next = e.getNextBomb();
    cf.phase = phase;
    cf.time = this.time;
    cf.scale = s;
    cf.lowQuality = this.quality.low;
    this.cannon.update(fxDt, cf, fx);

    // Background parallax follows the aim (spring 120 / 20)
    const fromVertical = ((90 - shooter.angle) * Math.PI) / 180;
    const target = reduced || !playing ? 0 : -Math.sin(fromVertical) * PARALLAX;
    stepSpring(this.parallax, target, 120, 20, Math.min(realDt, 0.05));

    const dangerTarget = playing || phase === "gameOver" ? e.getDangerLevel() : 0;
    this.danger += (dangerTarget - this.danger) * clamp01(realDt * 4);
    const tImpact = fx.since(fx.impactAt);
    const pulse = tImpact >= 0 && tImpact < 0.25 ? 1 - easeOutQuad(tImpact / 0.25) : 0;

    // Aim guide fades in over 120ms when a shot is ready
    if (this.showAim && phase === "ready") this.aimAlpha = Math.min(1, this.aimAlpha + realDt / 0.12);
    else this.aimAlpha = 0;

    const W = layout.containerWidth;
    const H = layout.containerHeight;
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording({ x: 0, y: 0, width: W, height: H });

    this.background.draw(canvas, {
      time: this.time,
      parallax: this.parallax.x,
      heat: clamp01((this.danger - 0.7) / 0.3),
      pulse,
      lowQuality: this.quality.low,
      reducedMotion: reduced,
    });

    if (phase !== "title") {
      const shake = fx.shake.offset;
      canvas.save();
      canvas.translate(layout.offsetX + shake.x * s, layout.offsetY + shake.y * s);
      canvas.scale(s, s);
      this.drawBoard(canvas, phase, reduced);
      canvas.restore();
      this.background.drawVignette(canvas, this.danger);
    }

    const tFlash = fx.since(fx.screenFlashAt);
    if (tFlash >= 0 && tFlash < fx.screenFlashDur) {
      this.background.drawFlash(canvas, fx.screenFlashAlpha * (1 - tFlash / fx.screenFlashDur));
    }
    const pic = rec.finishRecordingAsPicture();
    rec.dispose();
    return pic;
  }

  private drawBoard(canvas: SkCanvas, phase: string, reduced: boolean) {
    const e = this.engine;
    const fx = this.fx;
    const m = e.getBoardMetrics();
    const tiles = e.getTiles();
    const ceilingRows = e.getCeilingRows().length;

    const tSlam = fx.since(fx.slamAt);
    const slamDy = tSlam >= 0 && tSlam < 0.22 ? -m.rowHeight * (1 - easeInQuad(tSlam / 0.22)) : 0;
    const shots = e.getShotsUntilCeiling();
    const fs = this.fs;
    fs.time = this.time;
    fs.ceilingBottom = ceilingRows * m.rowHeight + slamDy;
    fs.rattle = !reduced && shots === 1 && (phase === "shooting" || phase === "resolving") ? 1.5 * Math.sin(this.time * Math.PI * 2 * 20) : 0;
    fs.shotsUntilCeiling = shots;
    fs.danger = this.danger;
    fs.gameOverT = phase === "gameOver" ? fx.since(fx.gameOverAt) : -1;
    fs.railLeft.t = fx.since(fx.railLeft.at);
    fs.railLeft.y = fx.railLeft.y;
    fs.railRight.t = fx.since(fx.railRight.at);
    fs.railRight.y = fx.railRight.y;
    fs.railFullT = fx.since(fx.railFullAt);
    fs.wonT = phase === "won" ? fx.since(fx.wonAt) : -1;

    // Row parity of the hex grid (it flips when a ceiling row is pushed)
    let parity = 0;
    if (tiles.length > 0) {
      const t = tiles[0];
      const shifted = t.x - t.col * m.tileSize - m.tileSize / 2 > m.tileSize / 4;
      parity = ((shifted ? 1 : 0) + t.row) % 2;
    }

    this.frameLayer.drawBack(canvas, parity);
    this.frameLayer.drawDangerLine(canvas, fs);

    const bf = this.bf;
    bf.slamDy = slamDy;
    bf.snap = fx.snap;
    bf.snapT = fx.since(fx.snap.at);
    bf.hidden = fx.boardHidden;
    bf.time = this.time;
    bf.dangerSparks = this.danger > 0.5 && !this.quality.low;
    for (const layer of [0, 1] as const) {
      this.bombs.draw(canvas, tiles, this.sprites, layer, bf);
      fx.drawBombs(canvas, this.sprites, layer);
    }
    this.bombs.drawDangerSparks(canvas, tiles, bf);
    this.frameLayer.drawSlab(canvas, fs);
    this.frameLayer.drawRails(canvas, fs);

    const bomb = this.cf.bomb;
    this.aim.draw(canvas, this.sprites, {
      path: e.getAimPath(),
      tiles,
      colorIndex: bomb.colorIndex,
      alpha: this.aimAlpha,
      time: this.time,
      reducedMotion: reduced,
    });
    this.cannon.draw(canvas, this.sprites, fx, this.cf);
    fx.drawEffects(canvas, this.layout?.scale ?? 1);
  }
}
