// Title "wow" scene: a lit-fuse hero bomb that stands in for the logo's "O",
// and 12 bombs that drop in one by one and bounce (restitution 0.35) into a
// hex pile. PLAY detonates it all: the fuse burns down for 250ms, then the
// hero bomb and the pile explode in a ripple and the UI flash-wipes to game.

import { TypedEmitter } from "../../../game/emitter";
import { FxBusEvents } from "../../../fx/bus";
import { titleLayout } from "../../../ui/titleLayout";
import { BoardLayout } from "../../layout";
import { FxDirector } from "../fx/FxDirector";
import { BombBatch } from "./BombBatch";
import { springDecay } from "./easing";

interface PileBomb { rx: number; ry: number; h: number; v: number; start: number; landT: number; c: number; alive: boolean }

const GRAVITY = 2600;

export class TitleScene {
  private t = 0;
  private pile: PileBomb[] = [];
  private detonateT = -1;
  private exploded = false;
  private notified = false;
  private hero = { x: 0, y: 0, k: 1 };
  private pileK = 1;
  private key = "";
  still = false;

  constructor(private fx: FxDirector, private bus: TypedEmitter<FxBusEvents>) {}

  reset() {
    this.t = 0;
    this.detonateT = -1;
    this.exploded = false;
    this.notified = false;
    this.key = "";
  }

  detonate() {
    if (this.detonateT < 0) this.detonateT = this.t;
  }

  // Lay out hero + pile from the container size (only when it changes).
  private place(layout: BoardLayout) {
    const key = `${layout.containerWidth}x${layout.containerHeight}@${layout.scale}`;
    if (key === this.key) return;
    const fresh = this.key === "";
    this.key = key;
    const tl = titleLayout(layout.containerWidth, layout.containerHeight);
    const s = layout.scale;
    const toWorld = (px: number, py: number) => ({ x: (px - layout.offsetX) / s, y: -(py - layout.offsetY) / s });
    const h = toWorld(tl.slotX, tl.logoY);
    this.hero = { x: h.x, y: h.y, k: tl.slotSize / (38 * s) };
    this.pileK = tl.pileBomb / (38 * s);
    const rows = [5, 4, 3];
    const old = this.pile;
    this.pile = [];
    let i = 0;
    rows.forEach((n, r) => {
      for (let c = 0; c < n; c++) {
        const px = layout.containerWidth / 2 + (c - (n - 1) / 2) * tl.pileBomb;
        const py = tl.pileGroundY - tl.pileBomb / 2 - r * tl.pileBomb * 0.86;
        const p = toWorld(px, py);
        const prev = old[i];
        this.pile.push(
          prev && !fresh
            ? { ...prev, rx: p.x, ry: p.y }
            : { rx: p.x, ry: p.y, h: 520 + i * 18, v: 0, start: 0.3 + i * 0.08, landT: -1, c: (i * 5 + r) % 6, alive: true }
        );
        i++;
      }
    });
  }

  update(dt: number, layout: BoardLayout) {
    this.place(layout);
    this.t += dt;
    for (const b of this.pile) {
      if (this.still) {
        b.h = 0;
        continue;
      }
      if (this.t < b.start || (b.h === 0 && b.v === 0)) continue;
      b.v -= GRAVITY * dt;
      b.h += b.v * dt;
      if (b.h <= 0) {
        b.h = 0;
        b.v = Math.abs(b.v) * 0.35 > 90 ? Math.abs(b.v) * 0.35 : 0;
        b.landT = this.t;
      }
    }
    if (this.detonateT >= 0) {
      const dtn = this.t - this.detonateT;
      if (!this.exploded && dtn >= (this.still ? 0 : 0.25)) {
        this.exploded = true;
        this.fx.explode(this.hero.x, this.hero.y, 30, 0, this.fx.n(70), this.fx.opts.debris ? 14 : 0, 2.2 * Math.min(1.6, this.hero.k));
        this.fx.shake(6, 0.3);
        this.bus.emit("screenFlash", { color: "#FFFFFF", alpha: 0.85, duration: 300 });
      }
      for (const b of this.pile) {
        if (!b.alive || !this.exploded) continue;
        const dist = Math.hypot(b.rx - this.hero.x, b.ry - this.hero.y) / (38 * this.pileK);
        if (dtn >= 0.25 + dist * 0.035) {
          b.alive = false;
          this.fx.explode(b.rx, b.ry, 0, b.c, this.fx.n(8), 0, this.pileK);
        }
      }
      if (!this.notified && dtn >= 0.55) {
        this.notified = true;
        this.bus.emit("titleDetonated", {});
      }
    }
  }

  submitBombs(batch: BombBatch) {
    const d = batch.draw;
    const ignite = this.still ? 1 : Math.min(1, Math.max(0, (this.t - 1.3) / 0.12));
    for (const b of this.pile) {
      if (!b.alive || (this.t < b.start && !this.still)) continue;
      const land = b.landT >= 0 ? this.t - b.landT : 99;
      d.x = b.rx; d.y = b.ry + b.h; d.z = 0; d.scale = this.pileK;
      d.rotX = 0; d.rotY = this.still ? 0 : Math.sin(this.t * 0.9 + b.rx) * 0.3; d.rotZ = 0;
      d.squash = land < 0.6 ? 0.2 * springDecay(land, 500, 14) : 0; d.squashAngle = 0;
      d.colorIndex = b.c; d.glow = 0.4; d.tint = 0; d.halo = 1; d.spark = 1; d.shadow = false;
      batch.add();
    }
    if (this.exploded) return;
    const burn = this.detonateT >= 0 ? Math.min(1, (this.t - this.detonateT) / 0.25) : 0;
    const jitter = burn * 2.5;
    d.x = this.hero.x + (Math.random() - 0.5) * jitter;
    d.y = this.hero.y + (Math.random() - 0.5) * jitter;
    d.z = 30; d.scale = this.hero.k * (1 + burn * 0.12);
    d.rotX = 0.15; d.rotY = this.still ? 0 : Math.sin(this.t * 0.7) * 0.45; d.rotZ = -0.12;
    d.squash = 0; d.colorIndex = 0; d.glow = 0.5 + burn * 1.2; d.tint = burn * 0.4; d.halo = 1.3;
    d.spark = ignite * (this.still ? 1 : 0.8 + Math.random() * 0.45) * (1 + burn * 1.8); d.shadow = false;
    batch.add();
  }
}
