// Arena bombs with the exact Classic bomb look: the shared BombBatch
// (instanced lit spheres + fuse hardware + glyphs; halos and sparks go to the
// billboard batch) lives in the FX space group, which is scaled so 1 Classic
// unit = K world units (bomb radius 19u -> 0.45w). Adds what Arena needs:
// creep wobble, stick squash, pop pre-flash, shatter fade, sparks only on the
// 12 bombs nearest the border (+ current/next; none while frozen), the
// current bomb on the launcher mouth (0.55x), the next beside the left
// shoulder (0.45x; swap arcs), every in-flight shot (up to 4 in fever),
// ground blob shadows (bombs + the player, under the hips) and the
// highlight shells. Loadout seats and scales come from the avatar.
// Fun pass: special kinds (armored cage, ticking dial + digits, wall roller
// tread + 12 Hz telegraph shake) via BombDecor; delayed chain shatters
// (negative age) held still at alpha 1; boss shield bombs (orbit + regrow
// scale) and rolling rollers (spin = distance / r about the axle) in the same
// batch; Mk I spit bombs lobbed in from the core; power shots (rainbow hue
// cycle, mega x1.3 gold, lightning flicker) and fever wild shots (rainbow);
// shells for would-pop (white), the loaded power's preview (power colour) and
// the aimed roller / shield / core (white = breaks it, red = deflects).

import {
  BackSide, Color, DynamicDrawUsage, Euler, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion,
  SphereGeometry, Texture, Vector3,
} from "three";
import type { ArenaEngine } from "../../game/arena";
import type { PowerKind } from "../../game/arena/funTypes";
import { QuadSink } from "../three/fx/SpriteBatch";
import { BombBatch } from "../three/world/BombBatch";
import { bombGlow, colorAt } from "../three/palette";
import { clamp01, easeInOutCubic, easeOutQuad, springDecay } from "../three/world/easing";
import { BombDecor } from "./BombDecor";
import { GroundQuads } from "./GroundQuads";
import type { Avatar } from "./avatar";

export const K = 0.45 / 19; // world units per Classic unit
export const U = 1 / K;
const BOMB_Y = 0.45;
const SPARKS = 12;
const SHELLS = 48;
const BLACK = new Color(0, 0, 0);
const WHITE = new Color(1, 1, 1);
const DEFLECT = new Color("#FF2D55");
const ORANGE = new Color("#FF8A3D");
const VOLT = 1; // palette index of the gold bomb (mega / lightning look)
export const POWER_COLOR: Record<PowerKind, Color> = {
  rainbow: new Color("#FF3DCB"), mega: new Color("#FFD23F"), lightning: new Color("#FFF36B"),
};

export interface BombFrameOpts {
  t: number; // real s
  still: boolean;
  low: boolean;
  colourAssist: boolean;
  showPop: boolean; // aim guide visible
  ice: number; // 0..1 freeze tint
  power: PowerKind | null; // loaded POWER
  preview: readonly number[]; // ids the loaded power would remove
  rainbow: Color; // current rainbow colour
}

interface Lob { id: number; t0: number; fx: number; fz: number }

export class ArenaBombs {
  readonly batch: BombBatch; // add .bombs/.hardware/.glyphs to the FX space
  readonly shadows: GroundQuads; // world space
  readonly shells: InstancedMesh; // world space
  readonly decor: BombDecor;
  readonly hidden = new Set<number>(); // ids blown up by the lose sequence
  readonly rollerQ = new Map<number, Quaternion>(); // rolling spin per roller id
  armorPing = 0; // 0..1 white sheen on every cage (L2 intro ping)
  onSpit: ((x: number, z: number) => void) | null = null;
  private readonly shellMat: MeshBasicMaterial;
  private readonly order: number[] = [];
  private readonly spark = new Set<number>();
  private readonly pop = new Set<number>();
  private readonly ghost = new Set<number>();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly v = new Vector3();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly e = new Euler();
  private readonly shotFrom = new Map<number, Vector3>();
  private readonly fromPool: Vector3[] = Array.from({ length: 6 }, () => new Vector3());
  private readonly rollerSpin = new Map<number, number>();
  private readonly qPool: Quaternion[] = Array.from({ length: 12 }, () => new Quaternion());
  private readonly lobs: Lob[] = [];
  private lastBombs: readonly unknown[] | null = null;
  private maxId = -1;
  private nShells = 0;
  private realT = 0;

  private readonly glowSink: QuadSink;
  constructor(glyphs: Texture, shadowTex: Texture, glow: QuadSink, decor: BombDecor) {
    this.glowSink = glow;
    this.batch = new BombBatch(240, glyphs, glow, glow);
    this.batch.haloBack = 0;
    this.decor = decor;
    this.shadows = new GroundQuads(220, shadowTex, false, 2);
    this.shellMat = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5, side: BackSide, depthWrite: false, toneMapped: false });
    this.shells = new InstancedMesh(new SphereGeometry(BOMB_Y * 1.1, 20, 14), this.shellMat, SHELLS);
    this.shells.instanceColor = new InstancedBufferAttribute(new Float32Array(SHELLS * 3), 3).setUsage(DynamicDrawUsage);
    this.shells.frustumCulled = false;
    this.shells.count = 0;
  }

  setQuality(high: boolean) {
    this.batch.setQuality(high);
    this.batch.haloAlpha = high ? 0.9 : 0.25;
  }

  reset() {
    this.hidden.clear();
    this.lobs.length = 0;
    this.lastBombs = null;
    this.rollerSpin.clear();
    this.rollerQ.clear();
    this.shotFrom.clear();
  }

  private shell(x: number, y: number, z: number, scale: number, col: Color) {
    if (this.nShells >= SHELLS) return;
    this.m.makeScale(scale, scale, scale).setPosition(x, y, z);
    this.shells.setMatrixAt(this.nShells, this.m);
    this.shells.setColorAt(this.nShells, col);
    this.nShells++;
  }

  frame(engine: ArenaEngine, stick: Avatar, o: BombFrameOpts, dt: number) {
    this.realT = o.t;
    const batch = this.batch;
    const d = batch.draw;
    const bombs = engine.getBombs();
    const frozen = o.ice > 0.01;
    batch.ice.value = o.ice;
    batch.glyphAlpha = o.colourAssist ? 0.6 : 0.28;
    batch.begin();
    this.shadows.begin();
    this.decor.begin(dt);
    this.trackSpit(engine, bombs);

    // the 12 idle bombs closest to the border keep their sparks lit
    this.order.length = 0;
    bombs.forEach((bomb, i) => bomb.state === "idle" && this.order.push(i));
    this.order.sort((i, j) => Math.hypot(bombs[i].x, bombs[i].z) - Math.hypot(bombs[j].x, bombs[j].z));
    this.spark.clear();
    if (!o.low && !frozen) for (let k = 0; k < Math.min(SPARKS, this.order.length); k++) this.spark.add(bombs[this.order[k]].id);
    this.pop.clear();
    this.ghost.clear();
    if (o.showPop) {
      for (const id of engine.getAimRay().wouldPopIds) this.pop.add(id);
      for (const id of o.preview) this.ghost.add(id);
    }

    this.nShells = 0;
    const pulse = 0.35 + 0.15 * Math.sin((o.t / 0.6) * Math.PI * 2);
    this.shellMat.opacity = pulse;
    const powerCol = o.power ? (o.power === "rainbow" ? o.rainbow : POWER_COLOR[o.power]) : WHITE;
    const tickFull = engine.getLevelDef().tickTimer || 20;
    for (const bomb of bombs) {
      if (this.hidden.has(bomb.id)) continue;
      let scale = 1;
      let tint = 0;
      let alpha = bomb.alpha;
      let x = bomb.x, y = BOMB_Y, z = bomb.z;
      if (bomb.state === "popping") {
        if (bomb.age > 0.06) continue;
        const pre = clamp01(bomb.age / 0.05);
        scale = 1 + 0.25 * easeOutQuad(pre);
        tint = pre;
      } else if (bomb.state === "shattering") {
        if (bomb.age < 0) {
          // delayed chain shatter: hold still at alpha 1, a white glint just before it goes
          alpha = 1;
          tint = bomb.age > -0.05 ? 0.6 : 0;
        } else {
          scale = Math.max(0, bomb.alpha);
          tint = bomb.age < 0.06 ? 1 : 0.2;
        }
      } else if (bomb.stuck && bomb.age < 0.6 && !o.still) {
        scale = 1 + 0.18 * springDecay(bomb.age, 500, 14);
      }
      // Mk I spit: lobbed in from the core over 0.45 s
      const lob = this.lobFor(bomb.id);
      if (lob) {
        const k = clamp01((o.t - lob.t0) / 0.45);
        x = lob.fx + (bomb.x - lob.fx) * k;
        z = lob.fz + (bomb.z - lob.fz) * k;
        y = BOMB_Y + Math.sin(k * Math.PI) * 2.2 + (1 - k) * 0.9;
        scale *= 0.6 + 0.4 * k;
      }
      const ph = bomb.id * 1.7;
      let rotX = o.still || frozen ? 0 : Math.sin(o.t * Math.PI * 4 + ph) * 0.07;
      let rotY = o.still || frozen ? 0 : Math.sin(o.t * 0.9 + ph) * 0.3;
      let rotZ = o.still || frozen ? 0 : Math.cos(o.t * Math.PI * 4 + ph) * 0.07;
      // wall roller telegraph: shake +-0.06 w at 12 Hz
      if (bomb.kind === "roller" && bomb.telegraph >= 0 && bomb.state === "idle" && !o.still) {
        const sh = Math.sin(o.t * Math.PI * 2 * 12 + ph) * 0.06;
        x += sh * -Math.sin(Math.atan2(bomb.z, bomb.x));
        z += sh * Math.cos(Math.atan2(bomb.z, bomb.x));
        rotZ += sh * 1.5;
      }
      d.x = x * U; d.y = y * U; d.z = z * U;
      d.scale = scale;
      d.rotX = rotX; d.rotY = rotY; d.rotZ = rotZ;
      d.squash = 0; d.squashAngle = 0;
      d.colorIndex = bomb.colorIndex;
      d.glow = 0.35 + tint;
      d.tint = tint;
      d.halo = bomb.state === "idle" ? 1 : alpha;
      d.spark = this.spark.has(bomb.id) ? 0.8 + Math.random() * 0.45 : 0;
      d.shadow = false;
      batch.add();
      this.shadows.add(x, 0.065, z, 0.95 * scale, BLACK, 0.45 * alpha);
      const live = bomb.state === "idle";
      if (live && bomb.kind === "armored" && bomb.armor === 1) this.decor.cage(x, y, z, rotX, rotY, rotZ, scale, this.armorPing);
      if (live && bomb.kind === "ticking" && bomb.timer !== null) {
        this.decor.dial(bomb.id, x, y, z, bomb.timer, tickFull, bomb.armed, o.t, o.still);
      }
      if (live && bomb.kind === "roller") {
        // wall roller: tread band with its axle along the wall (it rolls inwards)
        const ang = Math.atan2(bomb.z, bomb.x);
        this.q.setFromAxisAngle(this.v.set(0, 1, 0), -ang);
        this.e.set(rotX, rotY, rotZ);
        this.q2.setFromEuler(this.e);
        this.q.premultiply(this.q2);
        const tele = bomb.telegraph >= 0;
        const glow = tele ? 0.6 + 0.4 * Math.sin(o.t * Math.PI * 2 * 6) : 0.04;
        this.decor.tread(x, y, z, this.q, glow, scale);
        // telegraph: an orange glow disc pulsing on the ground under it
        if (tele) this.shadows.add(x, 0.07, z, 1.9 + 0.3 * Math.sin(o.t * Math.PI * 2 * 3), ORANGE, 0.55);
      }
      if (this.ghost.has(bomb.id)) {
        // POWER ghost: shell + a pulsing halo in the power colour (reads at range)
        this.shell(x, y, z, 1.12, powerCol);
        this.glowSink.add(x * U, y * U, z * U, 2.2 * U, 2.2 * U, powerCol, 0.35 + 0.5 * pulse);
      }
      else if (this.pop.has(bomb.id)) this.shell(x, y, z, 1, WHITE);
    }

    // boss shield bombs (orbit + regrow scale come from the engine)
    const boss = engine.getBoss();
    const ray = engine.getAimRay();
    if (boss) {
      for (const s of boss.shield) {
        if (s.scale <= 0.01) continue;
        d.x = s.x * U; d.y = BOMB_Y * U; d.z = s.z * U;
        d.scale = s.scale;
        d.rotX = 0; d.rotY = o.still ? 0 : o.t * 1.3 + s.id; d.rotZ = 0;
        d.squash = 0; d.squashAngle = 0;
        d.colorIndex = s.colorIndex;
        d.glow = s.scale < 1 ? 0.9 : 0.45; d.tint = s.scale < 1 ? 0.3 * (1 - s.scale) : 0;
        d.halo = 1; d.spark = 0; d.shadow = false;
        batch.add();
        this.shadows.add(s.x, 0.065, s.z, 0.95 * s.scale, BLACK, 0.4);
        if (o.showPop && ray.target === "shield" && ray.targetId === s.id) {
          const breaks = o.power !== null || engine.getFever().active || s.colorIndex === engine.getCurrentBomb();
          this.shell(s.x, BOMB_Y, s.z, 1.12, breaks ? WHITE : DEFLECT);
        }
        if (o.showPop && this.ghost.has(s.id)) this.shell(s.x, BOMB_Y, s.z, 1.08, powerCol);
      }
      if (o.showPop && ray.target === "core") this.shell(boss.x, boss.r, boss.z, boss.r / (BOMB_Y * 1.1) * 1.06, WHITE);
    }

    // rollers: spin about the axle (distance / r), tread band
    let qi = 0;
    for (const r of engine.getRollers()) {
      const spin = (this.rollerSpin.get(r.id) ?? 0) + (r.speed * dt) / BOMB_Y;
      this.rollerSpin.set(r.id, spin);
      const q = this.qPool[qi++ % this.qPool.length];
      // axle = up x dir; tread torus axis is local Z
      const yaw = Math.atan2(r.dirZ, r.dirX);
      q.setFromAxisAngle(this.v.set(0, 1, 0), -yaw);
      this.q2.setFromAxisAngle(this.v.set(0, 0, 1), -spin);
      q.multiply(this.q2);
      this.rollerQ.set(r.id, q);
      this.e.setFromQuaternion(q);
      d.x = r.x * U; d.y = BOMB_Y * U; d.z = r.z * U;
      d.scale = 1;
      d.rotX = this.e.x; d.rotY = this.e.y; d.rotZ = this.e.z;
      d.squash = 0; d.squashAngle = 0;
      d.colorIndex = r.colorIndex;
      d.glow = 0.6; d.tint = 0; d.halo = 1; d.spark = o.low ? 0 : 1; d.shadow = false;
      batch.add();
      this.shadows.add(r.x, 0.065, r.z, 0.95, BLACK, 0.5);
      this.decor.tread(r.x, BOMB_Y, r.z, q, 0.04, 1);
      // speed trail: fading glows in the bomb colour behind it (motion blur)
      if (!o.still && r.speed > 0) {
        const col = colorAt(bombGlow, r.colorIndex);
        for (let k = 1; k <= 3; k++) {
          const back = k * 0.32;
          const sz = (1.15 - k * 0.2) * U;
          this.glowSink.add((r.x - r.dirX * back) * U, BOMB_Y * U, (r.z - r.dirZ * back) * U, sz, sz, col, 0.42 - k * 0.11);
        }
      }
      if (o.showPop && ray.target === "roller" && ray.targetId === r.id) this.shell(r.x, BOMB_Y, r.z, 1.2, WHITE);
    }
    if (this.rollerSpin.size > engine.getRollers().length + 4) this.pruneRollers(engine);

    // in-flight shots: each leaves the visual muzzle and settles to bomb
    // height and the engine's centre line over the first 1.2 w
    const shots = engine.getShots();
    for (const shot of shots) {
      let f = this.shotFrom.get(shot.id);
      if (!f) {
        f = this.fromPool[shot.id % this.fromPool.length];
        stick.muzzleWorld(f);
        this.shotFrom.set(shot.id, f);
      }
      const k = easeOutQuad(clamp01(shot.travelled / 1.2));
      let ci = shot.colorIndex;
      let scale = 1;
      let tint = 0;
      if (shot.power === "rainbow" || shot.wild) ci = Math.floor(o.t * (shot.wild ? 14 : 10) + shot.id);
      else if (shot.power === "mega") {
        ci = VOLT;
        scale = 1.3;
      } else if (shot.power === "lightning") {
        ci = VOLT;
        tint = Math.sin(o.t * 90) > 0 ? 0.55 : 0.15;
      }
      this.drawLoose(shot.x + (f.x - shot.x) * (1 - k), f.y + (BOMB_Y - f.y) * k, shot.z + (f.z - shot.z) * (1 - k), scale, ci, o, 0, 0, tint);
      this.shadows.add(shot.x, 0.07, shot.z, 0.9 * scale, BLACK, 0.35);
    }
    if (this.shotFrom.size > shots.length) {
      for (const id of this.shotFrom.keys()) if (!shots.some((s) => s.id === id)) this.shotFrom.delete(id);
    }

    // player blob shadow under the hips (moves with the weight shift)
    stick.shadowXZ(this.a);
    this.shadows.add(this.a.x, 0.06, this.a.z, 1.0, BLACK, 0.55);

    // loadout: current on the launcher (the loaded POWER's look first), next in the back canister
    const HELD_CUR = stick.holdCur;
    const HELD_NEXT = stick.holdNext;
    if (engine.getPhase() !== "title") {
      stick.cradle.getWorldPosition(this.a);
      stick.shoulderSeat.getWorldPosition(this.b);
      this.b.y += o.still ? 0 : Math.sin(o.t * Math.PI * 2 * 0.8) * 0.04;
      const st = stick.swapT;
      const p = st >= 0.12 && st < 0.34 ? easeInOutCubic((st - 0.12) / 0.22) : st < 0.12 ? 0 : 1;
      const swapping = st < 0.34;
      const arc = Math.sin(p * Math.PI) * 0.35;
      const cur = swapping ? this.lerpArc(this.c1, this.b, this.a, p, arc) : this.a;
      const curS = swapping ? HELD_NEXT + (HELD_CUR - HELD_NEXT) * p : HELD_CUR;
      let ci = engine.getCurrentBomb();
      let cs = curS;
      let tint = 0;
      if (o.power === "rainbow") ci = Math.floor(o.t * 10);
      else if (o.power === "mega") {
        ci = VOLT;
        cs *= 1.25;
      } else if (o.power === "lightning") {
        ci = VOLT;
        tint = Math.sin(o.t * 90) > 0 ? 0.5 : 0.1;
      } else if (engine.getFever().active) ci = Math.floor(o.t * 8);
      this.drawLoose(cur.x, cur.y, cur.z, cs, ci, o, 1, 0, tint);
      const nx = swapping ? this.lerpArc(this.c2, this.a, this.b, p, arc) : this.b;
      const nS = swapping ? HELD_CUR - (HELD_CUR - HELD_NEXT) * p : HELD_NEXT;
      this.drawLoose(nx.x, nx.y, nx.z, nS, engine.getNextBomb(), o, o.low ? 0 : 0.9, o.still ? 0 : o.t * 0.7);
    }
    batch.end();
    this.shadows.end();
    this.decor.end();
    this.shells.count = this.nShells;
    this.shells.instanceMatrix.needsUpdate = true;
    if (this.shells.instanceColor) this.shells.instanceColor.needsUpdate = true;
  }

  // New idle, never-stuck bombs appearing mid-level on a boss level are the
  // Mk I spit: lob them in from the core. A new bombs array = a new level.
  private trackSpit(engine: ArenaEngine, bombs: readonly { id: number; stuck: boolean; state: string }[]) {
    if (bombs !== this.lastBombs) {
      this.lastBombs = bombs;
      this.lobs.length = 0;
      this.maxId = -1;
      for (const b of bombs) this.maxId = Math.max(this.maxId, b.id);
      return;
    }
    const boss = engine.getBoss();
    let spit = false;
    for (const b of bombs) {
      if (b.id <= this.maxId) continue;
      this.maxId = b.id;
      if (!boss || b.stuck || b.state !== "idle") continue;
      if (this.lobs.length < 12) this.lobs.push({ id: b.id, t0: this.realT, fx: boss.x, fz: boss.z });
      spit = true;
    }
    if (spit && boss) this.onSpit?.(boss.x, boss.z);
    for (let i = this.lobs.length - 1; i >= 0; i--) if (this.realT - this.lobs[i].t0 > 0.5) this.lobs.splice(i, 1);
  }

  private lobFor(id: number) {
    for (const l of this.lobs) if (l.id === id) return l;
    return null;
  }

  private pruneRollers(engine: ArenaEngine) {
    const live = engine.getRollers();
    for (const id of this.rollerSpin.keys()) {
      if (!live.some((r) => r.id === id)) {
        this.rollerSpin.delete(id);
        this.rollerQ.delete(id);
      }
    }
  }

  private readonly c1 = new Vector3();
  private readonly c2 = new Vector3();
  private lerpArc(out: Vector3, from: Vector3, to: Vector3, p: number, lift: number) {
    return out.copy(from).lerp(to, p).setY(from.y + (to.y - from.y) * p + lift);
  }

  private drawLoose(x: number, y: number, z: number, scale: number, colorIndex: number, o: BombFrameOpts, spark: number, spin = 0, tint = 0) {
    const d = this.batch.draw;
    d.x = x * U; d.y = y * U; d.z = z * U;
    d.scale = scale;
    d.rotX = 0; d.rotY = spin; d.rotZ = 0; d.squash = 0; d.squashAngle = 0;
    d.colorIndex = colorIndex;
    d.glow = 0.35 + tint; d.tint = tint; d.halo = 1;
    d.spark = spark > 0 ? spark * (o.still ? 1 : 0.8 + Math.random() * 0.45) : 0;
    d.shadow = false;
    this.batch.add();
  }

  dispose() {
    this.batch.dispose();
    this.shadows.dispose();
    this.shells.geometry.dispose();
    this.shellMat.dispose();
    this.shells.dispose();
    this.decor.dispose();
  }
}

