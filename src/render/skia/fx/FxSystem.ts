// The FX system: owns every fixed-size pool plus the timers the board
// layers read (recoil, snap squash, slam, rail flashes, screen flash...).
// Engine events are wired to it in fxEvents.ts; the scene calls update()
// once per frame with FX time (frozen during hit-stop) and draws the pools.
//
// Budget (spec section 10): <= 300 live particles (x0.5 on low quality,
// x0.4 with reduced motion), <= 80 per pop, <= 18 shards per pop.

import { SkCanvas } from "@shopify/react-native-skia";
import { FallingBombs, PendingPops } from "./bombFx";
import { C, FIREWORK_COLORS, baseC, glowC, highlightC } from "./colorTable";
import { BURST_FLASH, BURST_RING, BurstPool, ParticlePool, ParticleSpec, ShardPool } from "./pools";
import { Shake } from "./shake";
import { TextPool } from "./texts";
import { SpriteDrawer } from "../spriteDraw";

export const PARTICLE_CAP = 300;

export interface FxEnv {
  lowQuality: () => boolean;
  reducedMotion: () => boolean;
}

export interface SnapState {
  at: number;
  x: number;
  y: number;
  col: number;
  row: number;
  angle: number; // flight direction (degrees, screen space)
}

export interface RailFlash {
  at: number;
  y: number;
}

interface Scheduled {
  at: number;
  fn: () => void;
}

const NEVER = -1e9;

export class FxSystem {
  now = 0; // FX clock (seconds); frozen during hit-stop
  readonly particles = new ParticlePool(PARTICLE_CAP);
  readonly shards = new ShardPool(60);
  readonly bursts = new BurstPool(120);
  readonly texts = new TextPool(24);
  readonly pops = new PendingPops(200);
  readonly falls = new FallingBombs(160);
  readonly shake = new Shake();

  // Timers read by the layers (FX-clock seconds)
  shootAt = NEVER;
  swapAt = NEVER;
  reloadAt = NEVER;
  slamAt = NEVER;
  impactAt = NEVER;
  gameOverAt = NEVER;
  wonAt = NEVER;
  startAt = NEVER; // game start (flash wipe from the title)
  snap: SnapState = { at: NEVER, x: 0, y: 0, col: -1, row: -1, angle: -90 };
  railLeft: RailFlash = { at: NEVER, y: 0 };
  railRight: RailFlash = { at: NEVER, y: 0 };
  railFullAt = NEVER;
  screenFlashAt = NEVER;
  screenFlashAlpha = 0;
  screenFlashDur = 0.08;
  boardHidden = false; // game over: every tile has been taken over by FX
  flightDir = -90; // last in-flight direction (degrees)
  dangerLineY = 0; // for the "+20" when a dropped bomb crosses it

  private scheduled: Scheduled[] = [];
  private spec: ParticleSpec = {
    x: 0, y: 0, vx: 0, vy: 0, life: 0.5, size: 3, drag: 1, gravity: 0, colA: 0, colB: 0, additive: true, alpha: 1,
  };

  constructor(private readonly env: FxEnv) {}

  // ---- Budget helpers ----------------------------------------------------------

  particleScale() {
    return (this.env.lowQuality() ? 0.5 : 1) * (this.env.reducedMotion() ? 0.4 : 1);
  }

  debrisOn() {
    return !this.env.lowQuality() && !this.env.reducedMotion();
  }

  // Shake, or a rail flash instead when reduced motion is on
  shakeOrFlash(amplitude: number, seconds: number) {
    if (this.env.reducedMotion()) this.railFullAt = this.now;
    else this.shake.add(amplitude, seconds);
  }

  flashScreen(alpha: number, seconds: number) {
    this.screenFlashAt = this.now;
    this.screenFlashAlpha = alpha;
    this.screenFlashDur = seconds;
  }

  schedule(delay: number, fn: () => void) {
    this.scheduled.push({ at: this.now + delay, fn });
  }

  // ---- Spawners --------------------------------------------------------------------

  // Radial (or coned) burst of particles. Returns how many spawned.
  burst(x: number, y: number, count: number, o: {
    speedMin: number; speedMax: number; lifeMin: number; lifeMax: number; size: number;
    colA: number; colB: number; drag?: number; gravity?: number; additive?: boolean;
    dir?: number; spread?: number; alpha?: number;
  }) {
    const s = this.spec;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const a = o.dir === undefined ? Math.random() * Math.PI * 2 : o.dir + (Math.random() * 2 - 1) * (o.spread ?? 0);
      const v = o.speedMin + Math.random() * (o.speedMax - o.speedMin);
      s.x = x;
      s.y = y;
      s.vx = Math.cos(a) * v;
      s.vy = Math.sin(a) * v;
      s.life = o.lifeMin + Math.random() * (o.lifeMax - o.lifeMin);
      s.size = o.size * (0.7 + Math.random() * 0.6);
      s.drag = o.drag ?? 1;
      s.gravity = o.gravity ?? 0;
      s.colA = o.colA;
      s.colB = o.colB;
      s.additive = o.additive ?? true;
      s.alpha = o.alpha ?? 1;
      if (!this.particles.spawn(s)) break;
      n++;
    }
    return n;
  }

  // One bomb exploding: flash, shockwave ring, particles, shell shards
  explode = (x: number, y: number, color: number, particles: number, shards: number) => {
    this.bursts.spawn(BURST_FLASH, x, y, 0, 36, 0.12, highlightC(color), { alpha: 0.6 });
    this.bursts.spawn(BURST_RING, x, y, 10, 70, 0.32, glowC(color), { width: 6, alpha: 0.9 });
    this.burst(x, y, particles, {
      speedMin: 180, speedMax: 420, lifeMin: 0.35, lifeMax: 0.65, size: 3, drag: 0.92,
      colA: baseC(color), colB: highlightC(color),
    });
    if (this.debrisOn()) {
      for (let i = 0; i < shards; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 120 + Math.random() * 220;
        const spin = (360 + Math.random() * 360) * (Math.random() < 0.5 ? -1 : 1);
        this.shards.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v - 220, spin);
      }
    }
  };

  sparks(x: number, y: number, count: number, color: number, dir?: number, spread?: number, speedMin = 250, speedMax = 450, life = 0.2) {
    this.burst(x, y, Math.max(1, Math.round(count * this.particleScale())), {
      speedMin, speedMax, lifeMin: life * 0.8, lifeMax: life * 1.2, size: 2.2,
      colA: C.white, colB: glowC(color), dir, spread, drag: 0.94,
    });
  }

  firework(x: number, y: number) {
    const col = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    this.bursts.spawn(BURST_FLASH, x, y, 0, 30, 0.15, col);
    this.bursts.spawn(BURST_RING, x, y, 6, 80, 0.45, col, { width: 3 });
    this.burst(x, y, Math.round(40 * this.particleScale()), {
      speedMin: 120, speedMax: 380, lifeMin: 0.6, lifeMax: 1.1, size: 2.6, drag: 0.95, gravity: 220,
      colA: C.white, colB: col,
    });
  }

  dust(x0: number, x1: number, y: number, count: number) {
    const n = Math.round(count * this.particleScale());
    for (let i = 0; i < n; i++) {
      const x = x0 + Math.random() * (x1 - x0);
      this.burst(x, y, 1, {
        speedMin: 30, speedMax: 110, lifeMin: 0.4, lifeMax: 0.5, size: 3.2, drag: 0.93, gravity: 60,
        colA: C.dust, colB: C.dust, additive: false, alpha: 0.6, dir: Math.PI / 2, spread: 1.2,
      });
    }
  }

  ember(x: number, y: number, color: number) {
    this.burst(x, y, 1, {
      speedMin: 10, speedMax: 50, lifeMin: 0.22, lifeMax: 0.28, size: 2,
      colA: C.sparkMid, colB: glowC(color), gravity: 120,
    });
  }

  // ---- Frame -------------------------------------------------------------------------

  update(dt: number) {
    this.now += dt;
    if (this.scheduled.length) {
      // Run due callbacks (they may schedule more)
      const due = this.scheduled.filter((s) => s.at <= this.now);
      if (due.length) {
        this.scheduled = this.scheduled.filter((s) => s.at > this.now);
        due.forEach((s) => s.fn());
      }
    }
    this.particles.update(dt);
    this.shards.update(dt);
    this.bursts.update(dt);
    this.texts.update(dt);
    this.pops.update(dt, this.explode);
    this.falls.update(dt, this.dangerLineY, (x, y) => {
      this.texts.spawn(2, "+20", x, y, C.gold, 16);
    });
    this.shake.update(dt);
  }

  // Bombs owned by FX (pending pops, falling) - drawn in the bomb passes
  drawBombs(canvas: SkCanvas, sprites: SpriteDrawer, layer: 0 | 1) {
    this.pops.draw(canvas, sprites, layer);
    this.falls.draw(canvas, sprites, layer);
  }

  drawEffects(canvas: SkCanvas, scale: number) {
    this.shards.draw(canvas);
    this.bursts.draw(canvas);
    this.particles.draw(canvas);
    this.texts.draw(canvas, scale);
  }

  since(t: number) {
    return this.now - t;
  }

  reset() {
    this.particles.clear();
    this.shards.clear();
    this.bursts.clear();
    this.texts.clear();
    this.pops.clear();
    this.falls.clear();
    this.shake.clear();
    this.scheduled = [];
    this.boardHidden = false;
    this.gameOverAt = NEVER;
    this.wonAt = NEVER;
    this.slamAt = NEVER;
    this.impactAt = NEVER;
  }
}
