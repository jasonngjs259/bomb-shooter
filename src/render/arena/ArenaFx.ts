// Arena 360 effects (spec section 9) driven by engine events: muzzle flash,
// stick dust ring, chain-staggered pops (flash, ground shockwave decal, 3D
// particles with gravity, shell debris), orphan shatter, knock-back ring,
// deflect sparks, creep surge warning, the lose sequence (hit-stop, border
// flash, offending bomb detonates, ring chain-detonates by angle, stickman
// blown back, camera crane) and the win celebration (slow-mo, colour chase,
// win pose, orbit, fireworks). Particles/debris/glows live in the FX space
// (Classic units, U per world unit); ground decals are in world units.

import { Color, Vector3 } from "three";
import { angleDiff, DEG } from "../../arena/arenaMath";
import type { ArenaEngine, FxBomb } from "../../game/arena";
import { SimClock } from "../../game/clock";
import { TypedEmitter } from "../../game/emitter";
import { FxBusEvents } from "../../fx/bus";
import { haptics } from "../../fx/haptics";
import { Debris } from "../three/fx/Debris";
import { Particles } from "../three/fx/Particles";
import { bombBase, bombGlow, bombHighlight, color, colorAt, HEX } from "../three/palette";
import { easeOutCubic } from "../three/world/easing";
import { ArenaBombs, U } from "./ArenaBombs";
import { Billboards } from "./Billboards";
import { ChaseCamera } from "./ChaseCamera";
import { GroundQuads } from "./GroundQuads";
import { Stickman } from "./Stickman";

interface Anim { ring: boolean; x: number; y: number; z: number; t0: number; dur: number; r0: number; r1: number; col: Color; a0: number }
interface Timer { at: number; fn: () => void }
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export interface FxScale { particles: number; debris: boolean; shake: boolean; still: boolean }

export class ArenaFx {
  t = 0;
  opts: FxScale = { particles: 1, debris: true, shake: true, still: false };
  shakeX = 0;
  shakeY = 0;
  borderFlash = 0; // lose: white <-> red flashing
  surge = 0; // gold flash 0..1
  gridPulse = 1;
  chase: Color | null = null;
  private chaseT = -1;
  private surgeT = -99;
  private loseT = -99;
  private anims: Anim[] = [];
  private timers: Timer[] = [];
  private shakes: { t0: number; amp: number; dur: number }[] = [];
  private readonly offs: (() => void)[] = [];
  private readonly white = color(HEX.white);
  private readonly dust = color(HEX.dust);
  private readonly mv = new Vector3();
  private snapPending = false;

  constructor(
    private engine: ArenaEngine,
    private particles: Particles,
    private debris: Debris,
    private glow: Billboards,
    private decals: GroundQuads,
    private bombs: ArenaBombs,
    private stick: Stickman,
    private camera: ChaseCamera,
    private clock: SimClock,
    private bus: TypedEmitter<FxBusEvents>,
    private project: (x: number, y: number, z: number) => { x: number; y: number },
  ) {
    const e = engine;
    this.offs.push(
      e.on("shoot", ({ yaw, colorIndex }) => {
        const p = this.stick.muzzleWorld(this.mv);
        const gc = colorAt(bombGlow, colorIndex);
        this.anim(false, p.x, p.y, p.z, 0.09, 0, 0.4, gc, 1);
        this.anim(false, p.x, p.y, p.z, 0.07, 0, 0.22, this.white, 1);
        for (let i = 0; i < this.n(6); i++) {
          const a = yaw + rand(-25, 25) * DEG;
          const v = rand(6, 10);
          this.spawn(p.x, p.y, p.z, Math.cos(a) * v, rand(-1, 1.5), Math.sin(a) * v, 0.18, 0.12, this.white, gc, 0, 0.92);
        }
        this.stick.fire();
        haptics.light();
      }),
      e.on("swap", () => {
        this.stick.swap();
        haptics.selection();
      }),
      e.on("stick", ({ x, z }) => {
        this.anim(true, x, 0.08, z, 0.12, 0.2, 0.7, this.dust, 0.6);
        this.snapPending = true;
        void Promise.resolve().then(() => {
          if (this.snapPending) haptics.soft();
          this.snapPending = false;
        });
      }),
      e.on("pop", ({ bombs, score, combo, centre }) => {
        this.snapPending = false;
        const parts = Math.max(2, Math.floor(Math.min(10, 80 / bombs.length) * this.opts.particles));
        let debrisLeft = this.opts.debris ? 18 : 0;
        for (const b of bombs) {
          const d = Math.min(3, debrisLeft);
          debrisLeft -= d;
          const delay = Math.round(Math.hypot(b.x - centre.x, b.z - centre.z) / 0.9) * 0.035;
          this.later(delay, () => this.explode(b, parts, d, 1));
        }
        const big = bombs.length >= 6 || combo >= 3;
        this.shake(big ? 0.06 : 0.02, big ? 0.22 : 0.12);
        if (combo >= 3 || bombs.length >= 8) this.clock.freeze(60);
        // knock-back shockwave: a ground ring that grows to exactly the
        // engine's kick reach (knockbackRadius + n * bombRadius), with a
        // fainter echo so the pushed zone reads clearly
        const cfg = this.engine.getConfig();
        const reach = cfg.knockbackRadius + bombs.length * cfg.bombRadius;
        this.anim(true, centre.x, 0.09, centre.z, 0.45, 0.2, reach, this.white, 0.95);
        this.later(0.1, () => this.anim(true, centre.x, 0.085, centre.z, 0.5, 0.2, reach, this.dust, 0.5));
        const s = this.project(centre.x, 1.2, centre.z);
        this.bus.emit("floatText", { x: s.x, y: s.y, text: `+${score}`, kind: "score" });
        if (combo >= 2) this.bus.emit("floatText", { x: s.x, y: s.y - 34, text: `x${combo} COMBO!`, kind: "combo", combo });
        if (big) haptics.heavy();
        else haptics.medium();
      }),
      e.on("shatter", ({ bombs }) => {
        bombs.slice(0, 6).forEach((b) => {
          // white pre-flash, a glass ring on the ground, shards
          this.anim(false, b.x, 0.45, b.z, 0.12, 0.5, 1.0, this.white, 1);
          this.anim(true, b.x, 0.09, b.z, 0.35, 0.3, 1.1, this.white, 0.8);
          if (this.opts.debris) for (let i = 0; i < 6; i++) this.debris.spawn(b.x * U, 0.45 * U, b.z * U, 180, colorAt(bombGlow, b.colorIndex));
          const s = this.project(b.x, 0.9, b.z);
          this.bus.emit("floatText", { x: s.x, y: s.y, text: "+20", kind: "drop" });
        });
        setTimeout(haptics.rigid, 80);
      }),
      e.on("miss", ({ x, z, deflected }) => {
        if (!deflected) return;
        // the shot bounced off at the border line: spark + "DEFLECT"
        this.anim(true, x, 0.1, z, 0.3, 0.2, 1.1, this.white, 0.9);
        this.anim(false, x, 0.45, z, 0.12, 0, 0.6, this.white, 1);
        const sp = this.project(x, 1.0, z);
        this.bus.emit("floatText", { x: sp.x, y: sp.y, text: "DEFLECT", kind: "drop" });
        for (let i = 0; i < this.n(8); i++) {
          const a = rand(0, Math.PI * 2);
          this.spawn(x, 0.45, z, Math.cos(a) * rand(2, 5), rand(1, 4), Math.sin(a) * rand(2, 5), 0.25, 0.1, this.white, this.dust, -6, 0.92);
        }
        haptics.soft();
      }),
      e.on("creepSurge", () => {
        this.surgeT = this.t;
        this.bus.emit("banner", { text: "SURGE!", color: HEX.danger, duration: 1400 });
        this.later(0.75, () => {
          this.shake(0.05, 0.3);
          this.gridPulse = 1.6;
        });
        haptics.heavy();
        setTimeout(haptics.heavy, 120);
      }),
      e.on("gameOver", ({ x, z, angle, bombId }) => this.lose(x, z, angle, bombId)),
      e.on("won", () => this.win()),
    );
  }

  private n(base: number) {
    return Math.max(1, Math.round(base * this.opts.particles));
  }
  private later(delay: number, fn: () => void) {
    this.timers.push({ at: this.t + delay, fn });
  }
  private anim(ring: boolean, x: number, y: number, z: number, dur: number, r0: number, r1: number, col: Color, a0: number) {
    if (this.anims.length < 160) this.anims.push({ ring, x, y, z, t0: this.t, dur, r0, r1, col, a0 });
  }
  private shake(amp: number, dur: number) {
    if (this.opts.shake) this.shakes.push({ t0: this.t, amp, dur });
  }
  // World-unit particle spawn into the FX space.
  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number,
    c0: Color, c1: Color, gravity: number, drag = 1) {
    this.particles.spawn({ x: x * U, y: y * U, z: z * U, vx: vx * U, vy: vy * U, vz: vz * U, life, size0: size * U, size1: 0, c0, c1, drag, gravity: gravity * U });
  }

  explode(b: FxBomb, parts: number, debris: number, size: number) {
    const hi = colorAt(bombHighlight, b.colorIndex);
    const gc = colorAt(bombGlow, b.colorIndex);
    this.anim(false, b.x, 0.45, b.z, 0.12, 0, 1.4 * size, hi, 1);
    this.anim(true, b.x, 0.09, b.z, 0.32, 0.2, 1.6 * size, gc, 0.9);
    for (let i = 0; i < parts; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(4, 9) * Math.sqrt(size);
      this.spawn(b.x, 0.45, b.z, Math.cos(a) * v, rand(1, 6), Math.sin(a) * v, rand(0.35, 0.65), 0.17 * size, colorAt(bombBase, b.colorIndex), hi, -6, 0.94);
    }
    for (let i = 0; i < debris; i++) this.debris.spawn(b.x * U, 0.45 * U, b.z * U, 240 * size, gc);
  }

  private lose(x: number, z: number, angle: number, bombId: number) {
    this.loseT = this.t;
    this.clock.freeze(150);
    haptics.error();
    const bombs = this.engine.getBombs().filter((b) => b.state === "idle").map((b) => ({ id: b.id, x: b.x, z: b.z, colorIndex: b.colorIndex }));
    const hit = bombs.find((b) => b.id === bombId);
    this.later(0.35, () => {
      if (hit) {
        this.bombs.hidden.add(hit.id);
        this.explode(hit, this.n(30), this.opts.debris ? 12 : 0, 2);
      }
      this.anim(true, x, 0.1, z, 0.6, 0.3, 8, this.white, 0.8);
      this.shake(0.12, 0.5);
      haptics.heavy();
    });
    for (const b of bombs) {
      if (b.id === bombId) continue;
      const sectors = Math.abs(angleDiff(angle, Math.atan2(b.z, b.x))) / (22.5 * DEG);
      this.later(0.7 + sectors * 0.04 + Math.random() * 0.05, () => {
        this.bombs.hidden.add(b.id);
        this.explode(b, this.n(4), 0, 1);
      });
    }
    this.later(0.7, () => this.stick.lose(x, z));
    this.later(0.9, () => this.camera.crane(x, z));
  }

  private win() {
    this.clock.slow(0.35, 300);
    this.chaseT = this.t;
    this.stick.win();
    this.camera.orbit();
    this.bus.emit("banner", { text: "ARENA CLEAR!", color: HEX.gold, duration: 2200 });
    haptics.success();
    for (let i = 0; i < 5; i++) {
      this.later(0.4 + i * 0.36, () => {
        const a = rand(0, Math.PI * 2);
        const r = rand(0, 4);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = rand(6, 9);
        const c = colorAt(bombBase, i);
        this.anim(false, x, y, z, 0.2, 0, 2.5, colorAt(bombHighlight, i), 1);
        for (let k = 0; k < this.n(40); k++) {
          const u = rand(-1, 1);
          const th = rand(0, Math.PI * 2);
          const s = Math.sqrt(1 - u * u) * rand(5, 8);
          this.spawn(x, y, z, Math.cos(th) * s, u * 6, Math.sin(th) * s, rand(0.7, 1.1), 0.2, c, this.white, -4, 0.95);
        }
      });
    }
  }

  reset() {
    this.anims.length = this.timers.length = this.shakes.length = 0;
    this.particles.clear();
    this.debris.clear();
    this.bombs.hidden.clear();
    this.borderFlash = this.surge = 0;
    this.chase = null;
    this.chaseT = -1;
    this.loseT = this.surgeT = -99;
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    const due = this.timers.filter((tm) => tm.at <= t);
    if (due.length) {
      this.timers = this.timers.filter((tm) => tm.at > t);
      due.forEach((tm) => tm.fn());
    }
    this.anims = this.anims.filter((a) => t - a.t0 < a.dur);
    // glow/decals: the world calls begin()/end() around all writers
    for (const a of this.anims) {
      const k = (t - a.t0) / a.dur;
      const r = a.r0 + (a.r1 - a.r0) * easeOutCubic(k);
      if (a.ring) this.decals.add(a.x, a.y, a.z, r * 2, a.col, a.a0 * (1 - k));
      else this.glow.add(a.x * U, a.y * U, a.z * U, r * 2 * U, r * 2 * U, a.col, a.a0 * (1 - k));
    }
    // shake (decaying 30 Hz noise), world units
    let sx = 0;
    let sy = 0;
    for (const s of this.shakes) {
      const age = t - s.t0;
      const amp = s.amp * Math.exp(-age / (s.dur / 3));
      sx += amp * Math.sin(age * 188 + s.t0 * 13);
      sy += amp * Math.cos(age * 171 + s.t0 * 7);
    }
    this.shakes = this.shakes.filter((s) => t - s.t0 < s.dur);
    this.shakeX = sx;
    this.shakeY = sy;
    // border states
    const lt = t - this.loseT;
    this.borderFlash = lt > 0.15 && lt < 0.75 ? (Math.floor((lt - 0.15) / 0.1) % 2 === 0 ? 1 : 0) : 0;
    const st = t - this.surgeT;
    this.surge = st >= 0 && st < 1.5 ? (Math.floor(st / 0.25) % 2 === 0 ? 1 : 0) : 0;
    this.gridPulse = Math.max(1, this.gridPulse - dt * 2.4);
    if (this.chaseT >= 0 && t - this.chaseT < 1.2) this.chase = colorAt(bombBase, Math.floor((t - this.chaseT) * 10));
    else this.chase = null;
    this.particles.update(dt);
    this.debris.update(dt);
  }

  dispose() {
    this.offs.forEach((off) => off());
  }
}
