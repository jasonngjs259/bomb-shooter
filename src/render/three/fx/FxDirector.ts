// Turns engine events into timed effects (spec section 7): muzzle flash,
// trail, bounce sparks, snap squash + neighbour jelly, chain-staggered pops
// (pre-flash, flash, shockwave, particles, debris), falling dropped bombs,
// ceiling slam, game-over and win sequences, screen shake and hit-stop.
// All state lives in fixed pools mutated in update(); nothing per-frame
// allocates. World space: x = board x, y = -board y.

import { Color, Vector3 } from "three";
import { SimClock } from "../../../game/clock";
import { GameEngineView } from "../../../game/types";
import { FxBusEvents } from "../../../fx/bus";
import { TypedEmitter } from "../../../game/emitter";
import { BombBatch } from "../world/BombBatch";
import { bombBase, bombGlow, bombHighlight, color, colorAt, HEX } from "../palette";
import { clamp01, easeOutCubic, easeOutQuad, springDecay } from "../world/easing";
import { Debris } from "./Debris";
import { Particles } from "./Particles";
import { SpriteBatch } from "./SpriteBatch";

export interface FxOptions {
  particleScale: number; // quality x reduced motion
  debris: boolean;
  shake: boolean;
  still: boolean; // reduced motion
}

interface Pop { x: number; y: number; z: number; c: number; start: number; done: boolean; parts: number; debris: number; size: number; preflash: boolean }
interface Faller { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; wx: number; wy: number; age: number; c: number; crossed: boolean }
interface Anim { ring: boolean; x: number; y: number; z: number; t0: number; dur: number; r0: number; r1: number; col: Color; a0: number }
interface Shake { t0: number; amp: number; dur: number }
interface Jelly { x: number; y: number; t0: number; angle: number }

const compact = <T>(arr: T[], keep: (v: T) => boolean) => {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[j++] = arr[i];
  arr.length = j;
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class FxDirector {
  t = 0; // FX clock (sim seconds)
  opts: FxOptions = { particleScale: 1, debris: true, shake: true, still: false };
  shakeX = 0;
  shakeY = 0;
  slamOffset = 0; // board units, negative = drawn higher
  railFlashL = 0;
  railFlashR = 0;
  gridPulse = 1;
  dangerFlash = 0; // 0..1 overrides danger line alpha
  chase = -1; // win rail colour chase progress (s), -1 = off
  slamBottom = 0; // board y of the slab edge (set by the world, for dust)
  private gridPulseT = 99;
  readonly hidden = new Set<number>();
  private pops: Pop[] = [];
  private fallers: Faller[] = [];
  private anims: Anim[] = [];
  private shakes: Shake[] = [];
  private jellies: Jelly[] = [];
  private bounceFlashes: { y: number; left: boolean; t0: number }[] = [];
  private trail: number[] = []; // x,y pairs (world), newest last
  private lastBomb = { x: 0, y: 0, inFlight: false };
  private flightAngle = Math.PI / 2;
  private emberAcc = 0;
  private slamT0 = -99;
  private slamHit = true;
  private snapAt = { x: 0, y: 0 };
  private deadline = 442;
  private width = 460;
  private readonly white = color(HEX.white);
  private readonly spark = color(HEX.spark);
  private readonly dust = color(HEX.dust);
  private readonly ember = color(HEX.sparkHalo);
  private readonly cyan = color(HEX.cyan);
  private readonly tmpC = new Color();
  // pop flash colour per bomb colour: glow mixed 35% towards highlight
  private readonly flashColors = bombGlow.map((g, i) => g.clone().lerp(colorAt(bombHighlight, i), 0.35));
  private readonly offs: (() => void)[] = [];

  constructor(
    private particles: Particles,
    private debris: Debris,
    private glow: SpriteBatch,
    private rings: SpriteBatch,
    private clock: SimClock,
    private bus: TypedEmitter<FxBusEvents>,
    private muzzle: (out: Vector3) => Vector3
  ) {}

  attach(engine: GameEngineView) {
    const m = engine.getBoardMetrics();
    this.deadline = m.deadlineY;
    this.width = m.width;
    const mv = new Vector3();
    this.offs.push(
      engine.on("shoot", ({ angle, colorIndex }) => {
        const p = this.muzzle(mv);
        const a = (angle * Math.PI) / 180;
        this.anim(false, p.x, p.y, 8, 0.09, 0, 64, colorAt(bombGlow, colorIndex), 1);
        this.anim(false, p.x, p.y, 9, 0.07, 0, 36, this.white, 1);
        for (let i = 0; i < this.n(6); i++) {
          const da = a + rand(-25, 25) * (Math.PI / 180);
          const v = rand(300, 500);
          this.particles.spawn({ x: p.x, y: p.y, z: 6, vx: Math.cos(da) * v, vy: Math.sin(da) * v, life: 0.18, size0: 5, c0: this.white, c1: colorAt(bombGlow, colorIndex), drag: 0.92 });
        }
        this.flightAngle = a;
        this.trail.length = 0;
      }),
      engine.on("wallBounce", ({ x, y }) => {
        const c = colorAt(bombGlow, engine.getBomb().colorIndex);
        for (let i = 0; i < this.n(8); i++) {
          const da = (x < this.width / 2 ? 0 : Math.PI) + rand(-1.2, 1.2);
          const v = rand(250, 450);
          this.particles.spawn({ x, y: -y, z: 4, vx: Math.cos(da) * v, vy: Math.sin(da) * v, life: 0.2, size0: 4.5, c0: this.white, c1: c, drag: 0.9 });
        }
        this.bounceFlashes.push({ y: -y, left: x < this.width / 2, t0: this.t });
      }),
      engine.on("snap", ({ x, y }) => {
        this.snapAt = { x, y: -y };
        this.jellies.push({ x, y: -y, t0: this.t, angle: this.flightAngle });
      }),
      engine.on("pop", ({ tiles, score, combo, centre }) => {
        const n = tiles.length;
        const parts = Math.max(2, Math.floor(Math.min(10, 80 / n) * this.opts.particleScale));
        let debrisLeft = this.opts.debris ? 18 : 0;
        for (const tile of tiles) {
          const ring = Math.round(Math.hypot(tile.x - this.snapAt.x, -tile.y - this.snapAt.y) / 38);
          const d = Math.min(3, debrisLeft);
          debrisLeft -= d;
          this.pops.push({ x: tile.x, y: -tile.y, z: 0, c: tile.colorIndex, start: this.t + ring * 0.035, done: false, parts, debris: d, size: 1, preflash: true });
        }
        // Last pop of the board: slow motion for the finale
        if (engine.getTiles().every((t) => t.state !== "idle")) this.clock.slow(0.35, 300);
        const big = n >= 8;
        this.shake(big ? 6 : 2, big ? 0.22 : 0.12);
        if (combo >= 3 || big) this.clock.freeze(60);
        this.bus.emit("floatText", { x: centre.x, y: centre.y, text: `+${score}`, kind: "score" });
        if (combo >= 2) {
          this.bus.emit("floatText", { x: centre.x, y: centre.y - 30, text: `x${combo} COMBO!`, kind: "combo", combo });
          if (combo >= 4) this.bus.emit("screenFlash", { color: "#FFFFFF", alpha: 0.15, duration: 80 });
        }
      }),
      engine.on("drop", ({ tiles }) => {
        for (const tile of tiles) {
          this.fallers.push({
            x: tile.x, y: -tile.y, z: 0, vx: rand(-60, 60), vy: 120, vz: rand(120, 320),
            rx: 0, ry: 0, wx: rand(-3.1, 3.1), wy: rand(-3.1, 3.1), age: 0, c: tile.colorIndex, crossed: false,
          });
        }
      }),
      engine.on("ceilingDrop", () => {
        this.slamT0 = this.t;
        this.slamHit = false;
      }),
      engine.on("gameOver", () => {
        this.clock.freeze(120);
        this.dangerFlash = 1;
        const tiles = engine.getTiles().filter((t) => t.state === "idle");
        const maxRow = tiles.reduce((m2, t) => Math.max(m2, t.row), 0);
        for (const t of tiles) {
          const delay = Math.min(1.4, (maxRow - t.row) * 0.05 + 0.35);
          this.pops.push({ x: t.x, y: -t.y, z: 0, c: t.colorIndex, start: this.t + delay, done: false, parts: Math.max(1, Math.round(4 * this.opts.particleScale)), debris: 0, size: 1, preflash: true });
          this.hidden.add(t.id);
        }
        this.shake(14, 0.5);
      }),
      engine.on("won", () => {
        this.chase = 0;
        for (let i = 0; i < 5; i++) {
          const x = rand(60, this.width - 60);
          const y = -rand(40, this.deadline * 0.5);
          this.firework(x, y, this.t + 0.25 + i * 0.36, i);
        }
      }),
      engine.on("phaseChanged", ({ phase, previous }) => {
        if (phase === "ready") {
          this.hidden.clear();
          this.dangerFlash = 0;
          if (previous === "gameOver" || previous === "won") this.pops.length = this.fallers.length = 0;
        }
      })
    );
  }

  detach() {
    this.offs.forEach((off) => off());
    this.offs.length = 0;
  }

  clearAll() {
    this.pops.length = this.fallers.length = this.anims.length = this.jellies.length = 0;
    this.particles.clear();
    this.debris.clear();
    this.hidden.clear();
  }

  // Scaled particle count.
  n(base: number) {
    return Math.max(1, Math.round(base * this.opts.particleScale));
  }

  anim(ring: boolean, x: number, y: number, z: number, dur: number, r0: number, r1: number, col: Color, a0: number, delay = 0) {
    if (this.anims.length > 120) return;
    this.anims.push({ ring, x, y, z, t0: this.t + delay, dur, r0, r1, col, a0 });
  }

  shake(amp: number, dur: number) {
    if (!this.opts.shake) {
      // reduced motion: rail flash instead of shaking
      this.railFlashL = this.railFlashR = Math.max(this.railFlashL, Math.min(1, amp / 8));
      return;
    }
    this.shakes.push({ t0: this.t, amp, dur });
  }

  // Full explosion at a world point (pops, title bomb, fireworks share it).
  explode(x: number, y: number, z: number, c: number, parts: number, debris: number, size = 1) {
    const hi = colorAt(bombHighlight, c);
    const gc = colorAt(bombGlow, c);
    // flash tinted with the bomb's own glow colour at lower alpha (a full
    // highlight-colour flash read as a big white disc)
    this.anim(false, x, y, z + 22, 0.12, 0, 95 * size, colorAt(this.flashColors, c), 0.55);
    // shockwave ring: additive, so keep the peak low - overlapping rings
    // from a chain used to bleach neighbouring bombs to white
    this.anim(true, x, y, z + 20, 0.32, 20 * size, 115 * size, gc, 0.45);
    for (let i = 0; i < parts; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(180, 420) * Math.sqrt(size);
      this.particles.spawn({
        x, y, z: z + 10, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rand(-40, 160),
        life: rand(0.35, 0.65), size0: 7 * size, size1: 0, c0: colorAt(bombBase, c), c1: hi, drag: 0.92,
      });
    }
    for (let i = 0; i < debris; i++) this.debris.spawn(x, y, z, 260 * size, gc);
  }

  private firework(x: number, y: number, at: number, i: number) {
    const c = i % 6;
    this.pops.push({ x, y, z: 30, c, start: at, done: false, parts: Math.round(40 * this.opts.particleScale), debris: 0, size: 1.3, preflash: false });
  }

  // Tile motion from snap jelly: writes squash + nudge into the bomb draw.
  applyJelly(x: number, y: number, draw: { x: number; y: number; squash: number; squashAngle: number }) {
    for (const j of this.jellies) {
      const age = this.t - j.t0;
      const dx = x - j.x;
      const dy = y - j.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 4) {
        draw.squash = 0.18 * springDecay(age, 500, 14);
        draw.squashAngle = j.angle;
      } else if (d2 < 46 * 46 && !this.opts.still) {
        const d = Math.sqrt(d2);
        const k = 3 * Math.max(0, 1 - age / 0.2) * Math.sin(Math.min(1, age / 0.05) * Math.PI * 0.5);
        draw.x += (dx / d) * k;
        draw.y += (dy / d) * k;
      }
    }
  }

  update(dt: number, bomb: { x: number; y: number; inFlight: boolean; colorIndex: number }) {
    this.t += dt;
    const t = this.t;
    // trail + embers while in flight
    if (bomb.inFlight) {
      const wx = bomb.x;
      const wy = -bomb.y;
      if (this.lastBomb.inFlight) {
        const dx = wx - this.lastBomb.x;
        const dy = wy - this.lastBomb.y;
        if (dx * dx + dy * dy > 1) this.flightAngle = Math.atan2(dy, dx);
      }
      this.trail.push(wx, wy);
      if (this.trail.length > 20) this.trail.splice(0, 2);
      this.emberAcc += dt;
      while (this.emberAcc > 0.03) {
        this.emberAcc -= 0.03;
        this.particles.spawn({ x: wx + rand(-4, 4), y: wy + 26, z: 6, vx: rand(-30, 30), vy: rand(20, 80), life: 0.25, size0: 4, c0: this.spark, c1: this.ember, drag: 0.95 });
      }
    } else if (this.trail.length > 0 && dt > 0) {
      this.trail.splice(0, 2);
    }
    this.lastBomb.x = bomb.x;
    this.lastBomb.y = -bomb.y;
    this.lastBomb.inFlight = bomb.inFlight;

    // pops: explode when their pre-flash ends
    for (const p of this.pops) {
      if (!p.done && t >= p.start + (p.preflash ? 0.05 : 0)) {
        p.done = true;
        this.explode(p.x, p.y, p.z, p.c, p.parts, p.debris, p.size);
      }
    }
    compact(this.pops, (p) => !p.done);

    // dropped bombs: jiggle 80ms, then hop + gravity + tumble toward camera
    for (const f of this.fallers) {
      f.age += dt;
      if (f.age < 0.08) continue;
      f.vy -= 1800 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      f.rx += f.wx * dt;
      f.ry += f.wy * dt;
      if (!f.crossed && -f.y > this.deadline) {
        f.crossed = true;
        this.bus.emit("floatText", { x: f.x, y: this.deadline - 10, text: "+20", kind: "drop" });
      }
    }
    compact(this.fallers, (f) => f.age < 0.9);
    compact(this.jellies, (j) => t - j.t0 < 0.6);
    compact(this.anims, (a) => t - a.t0 < a.dur);
    compact(this.bounceFlashes, (b) => t - b.t0 < 0.25);

    // ceiling slam: down 34u in 220ms (easeInQuad), impact effects
    const st = t - this.slamT0;
    if (st < 0.22) this.slamOffset = -34 * (1 - (st / 0.22) * (st / 0.22));
    else {
      this.slamOffset = 0;
      if (!this.slamHit) {
        this.slamHit = true;
        this.shake(10, 0.3);
        this.railFlashL = this.railFlashR = 1;
        for (let i = 0; i < this.n(24); i++) {
          this.particles.spawn({ x: rand(0, this.width), y: -this.slamBottom, z: 12, vx: rand(-60, 60), vy: rand(-120, 30), life: 0.5, size0: 6, c0: this.dust, alpha: 0.6, drag: 0.94 });
        }
        this.gridPulseT = 0;
      }
    }
    this.gridPulseT += dt;
    this.gridPulse = this.gridPulseT < 0.25 ? 1.6 - 0.6 * (this.gridPulseT / 0.25) : 1;

    // shake: decaying 30Hz noise
    let sx = 0;
    let sy = 0;
    for (const s of this.shakes) {
      const age = t - s.t0;
      const amp = s.amp * Math.exp(-age / (s.dur / 3));
      sx += amp * Math.sin(age * 188 + s.t0 * 13) * 0.8;
      sy += amp * Math.cos(age * 171 + s.t0 * 7) * 0.8;
    }
    compact(this.shakes, (s) => t - s.t0 < s.dur);
    this.shakeX = sx;
    this.shakeY = sy;

    this.railFlashL = Math.max(0, this.railFlashL - dt / 0.25);
    this.railFlashR = Math.max(0, this.railFlashR - dt / 0.25);
    if (this.dangerFlash > 0) this.dangerFlash = Math.max(0, this.dangerFlash - dt / 0.9);
    if (this.chase >= 0) this.chase = this.chase > 1.2 ? -1 : this.chase + dt;

    this.particles.update(dt);
    this.debris.update(dt);
  }

  // Pending pops (pre-flash) and falling bombs into the bomb batch.
  submitBombs(batch: BombBatch) {
    const d = batch.draw;
    for (const p of this.pops) {
      if (!p.preflash) continue;
      const pre = clamp01((this.t - p.start) / 0.05);
      d.x = p.x; d.y = p.y; d.z = p.z; d.rotX = d.rotY = d.rotZ = 0; d.squash = 0;
      // pre-flash: a brief swell and glow in the bomb's colour, only lightly
      // whitened (full white tint read as big white discs)
      d.scale = 1 + 0.15 * easeOutQuad(pre); d.tint = 0.3 * pre; d.colorIndex = p.c; d.glow = 0.35 + 0.65 * pre;
      d.halo = 1; d.spark = 1; d.shadow = true;
      batch.add();
    }
    for (const f of this.fallers) {
      const jig = f.age < 0.08 ? Math.sin(f.age * 160) * 2 : 0;
      const fade = f.age > 0.65 ? 1 - (f.age - 0.65) / 0.25 : 1;
      d.x = f.x + jig; d.y = f.y; d.z = f.z; d.rotX = f.rx; d.rotY = f.ry; d.rotZ = 0; d.squash = 0;
      d.scale = Math.max(0, fade); d.tint = 0; d.colorIndex = f.c; d.glow = 0.35; d.halo = fade; d.spark = 1; d.shadow = false;
      batch.add();
    }
  }

  // Flashes, rings, trail and rail flash segments into the sprite batches.
  render(currentColor: number) {
    const t = this.t;
    for (const a of this.anims) {
      const age = t - a.t0;
      if (age < 0) continue;
      const k = age / a.dur;
      const e = easeOutCubic(k);
      const r = a.r0 + (a.r1 - a.r0) * e;
      (a.ring ? this.rings : this.glow).add(a.x, a.y, a.z, r, r, a.col, a.a0 * (1 - k));
    }
    const gc = colorAt(bombGlow, currentColor);
    const n = this.trail.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const f = (i + 1) / n; // 1 = newest
      const s = 38 * (0.3 + 0.55 * f);
      this.glow.add(this.trail[i * 2], this.trail[i * 2 + 1], -2, s * 1.6, s * 1.6, gc, 0.5 * f);
    }
    for (const b of this.bounceFlashes) {
      const k = easeOutQuad(clamp01((t - b.t0) / 0.25));
      this.tmpC.copy(this.white).lerp(this.cyan, k);
      this.glow.add(b.left ? -3 : this.width + 3, b.y, 4, 22, 60, this.tmpC, 1 - k);
    }
  }
}

