// Arena bombs with the exact Classic bomb look: the shared BombBatch
// (instanced lit spheres + fuse hardware + glyphs; halos and sparks go to the
// billboard batch) lives in the FX space group, which is scaled so 1 Classic
// unit = K world units (bomb radius 19u -> 0.45w). Adds what Arena needs:
// creep wobble, stick squash, pop pre-flash, shatter fade, sparks only on the
// 12 bombs nearest the border (+ current/next), the current bomb on the
// launcher mouth (0.55x), the next beside the left shoulder (0.45x; swap
// arcs), the in-flight shot,
// ground blob shadows (bombs + the player, under the hips) and the would-pop
// highlight shells. Loadout seats and scales come from the avatar.

import {
  BackSide, Color, InstancedMesh, Matrix4, MeshBasicMaterial, SphereGeometry, Texture, Vector3,
} from "three";
import type { ArenaEngine } from "../../game/arena";
import { QuadSink } from "../three/fx/SpriteBatch";
import { BombBatch } from "../three/world/BombBatch";
import { clamp01, easeInOutCubic, easeOutQuad, springDecay } from "../three/world/easing";
import { GroundQuads } from "./GroundQuads";
import type { Avatar } from "./avatar";

export const K = 0.45 / 19; // world units per Classic unit
export const U = 1 / K;
const BOMB_Y = 0.45;
const SPARKS = 12;
const BLACK = new Color(0, 0, 0);

export interface BombFrameOpts { t: number; still: boolean; low: boolean; colourAssist: boolean; showPop: boolean }

export class ArenaBombs {
  readonly batch: BombBatch; // add .bombs/.hardware/.glyphs to the FX space
  readonly shadows: GroundQuads; // world space
  readonly shells: InstancedMesh; // world space
  readonly hidden = new Set<number>(); // ids blown up by the lose sequence
  private readonly shellMat: MeshBasicMaterial;
  private readonly order: number[] = [];
  private readonly spark = new Set<number>();
  private readonly pop = new Set<number>();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly m = new Matrix4();
  private shotFrom: Vector3 | null = null;

  constructor(glyphs: Texture, shadowTex: Texture, glow: QuadSink) {
    this.batch = new BombBatch(220, glyphs, glow, glow);
    this.batch.haloBack = 0;
    this.shadows = new GroundQuads(200, shadowTex, false, 2);
    this.shellMat = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5, side: BackSide, depthWrite: false, toneMapped: false });
    this.shells = new InstancedMesh(new SphereGeometry(BOMB_Y * 1.1, 20, 14), this.shellMat, 40);
    this.shells.frustumCulled = false;
    this.shells.count = 0;
  }

  setQuality(high: boolean) {
    this.batch.setQuality(high);
    this.batch.haloAlpha = high ? 0.9 : 0.25;
  }

  frame(engine: ArenaEngine, stick: Avatar, o: BombFrameOpts) {
    const batch = this.batch;
    const d = batch.draw;
    const bombs = engine.getBombs();
    batch.glyphAlpha = o.colourAssist ? 0.6 : 0.28;
    batch.begin();
    this.shadows.begin();

    // the 12 idle bombs closest to the border keep their sparks lit
    this.order.length = 0;
    bombs.forEach((bomb, i) => bomb.state === "idle" && this.order.push(i));
    this.order.sort((i, j) => Math.hypot(bombs[i].x, bombs[i].z) - Math.hypot(bombs[j].x, bombs[j].z));
    this.spark.clear();
    if (!o.low) for (let k = 0; k < Math.min(SPARKS, this.order.length); k++) this.spark.add(bombs[this.order[k]].id);
    this.pop.clear();
    if (o.showPop) for (const id of engine.getAimRay().wouldPopIds) this.pop.add(id);

    let shells = 0;
    const pulse = 0.35 + 0.15 * Math.sin((o.t / 0.6) * Math.PI * 2);
    this.shellMat.opacity = pulse;
    for (const bomb of bombs) {
      if (this.hidden.has(bomb.id)) continue;
      let scale = 1;
      let tint = 0;
      if (bomb.state === "popping") {
        if (bomb.age > 0.06) continue;
        const pre = clamp01(bomb.age / 0.05);
        scale = 1 + 0.25 * easeOutQuad(pre);
        tint = pre;
      } else if (bomb.state === "shattering") {
        scale = Math.max(0, bomb.alpha);
        tint = bomb.age < 0.06 ? 1 : 0.2;
      } else if (bomb.stuck && bomb.age < 0.6 && !o.still) {
        scale = 1 + 0.18 * springDecay(bomb.age, 500, 14);
      }
      const ph = bomb.id * 1.7;
      d.x = bomb.x * U; d.y = BOMB_Y * U; d.z = bomb.z * U;
      d.scale = scale;
      d.rotX = o.still ? 0 : Math.sin(o.t * Math.PI * 4 + ph) * 0.07;
      d.rotY = o.still ? 0 : Math.sin(o.t * 0.9 + ph) * 0.3;
      d.rotZ = o.still ? 0 : Math.cos(o.t * Math.PI * 4 + ph) * 0.07;
      d.squash = 0; d.squashAngle = 0;
      d.colorIndex = bomb.colorIndex;
      d.glow = 0.35 + tint;
      d.tint = tint;
      d.halo = bomb.state === "idle" ? 1 : bomb.alpha;
      d.spark = this.spark.has(bomb.id) ? 0.8 + Math.random() * 0.45 : 0;
      d.shadow = false;
      batch.add();
      this.shadows.add(bomb.x, 0.065, bomb.z, 0.95 * scale, BLACK, 0.45 * bomb.alpha);
      if (this.pop.has(bomb.id) && shells < this.shells.instanceMatrix.count) {
        this.m.makeTranslation(bomb.x, BOMB_Y, bomb.z);
        this.shells.setMatrixAt(shells++, this.m);
      }
    }
    this.shells.count = shells;
    this.shells.instanceMatrix.needsUpdate = true;

    // in-flight shot: leaves the visual muzzle, settles to bomb height and the
    // engine's centre line over the first 1.2 w
    const shot = engine.getShot();
    if (shot) {
      if (!this.shotFrom) this.shotFrom = stick.muzzleWorld(new Vector3());
      const k = easeOutQuad(clamp01(shot.travelled / 1.2));
      const f = this.shotFrom;
      this.drawLoose(shot.x + (f.x - shot.x) * (1 - k), f.y + (BOMB_Y - f.y) * k, shot.z + (f.z - shot.z) * (1 - k), 1, shot.colorIndex, o, 0);
      this.shadows.add(shot.x, 0.07, shot.z, 0.9, BLACK, 0.35);
    } else {
      this.shotFrom = null;
    }

    // player blob shadow under the hips (moves with the weight shift)
    stick.shadowXZ(this.a);
    this.shadows.add(this.a.x, 0.06, this.a.z, 1.0, BLACK, 0.55);

    // loadout: current on the launcher, next in the back canister
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
      this.drawLoose(cur.x, cur.y, cur.z, curS, engine.getCurrentBomb(), o, 1);
      const nx = swapping ? this.lerpArc(this.c2, this.a, this.b, p, arc) : this.b;
      const nS = swapping ? HELD_CUR - (HELD_CUR - HELD_NEXT) * p : HELD_NEXT;
      this.drawLoose(nx.x, nx.y, nx.z, nS, engine.getNextBomb(), o, o.low ? 0 : 0.9, o.still ? 0 : o.t * 0.7);
    }
    batch.end();
    this.shadows.end();
  }

  private readonly c1 = new Vector3();
  private readonly c2 = new Vector3();
  private lerpArc(out: Vector3, from: Vector3, to: Vector3, p: number, lift: number) {
    return out.copy(from).lerp(to, p).setY(from.y + (to.y - from.y) * p + lift);
  }

  private drawLoose(x: number, y: number, z: number, scale: number, colorIndex: number, o: BombFrameOpts, spark: number, spin = 0) {
    const d = this.batch.draw;
    d.x = x * U; d.y = y * U; d.z = z * U;
    d.scale = scale;
    d.rotX = 0; d.rotY = spin; d.rotZ = 0; d.squash = 0; d.squashAngle = 0;
    d.colorIndex = colorIndex;
    d.glow = 0.35; d.tint = 0; d.halo = 1;
    d.spark = spark > 0 ? spark * (o.still ? 1 : 0.8 + Math.random() * 0.45) : 0;
    d.shadow = false;
    this.batch.add();
  }

  dispose() {
    this.batch.dispose();
    this.shadows.dispose();
    this.shells.geometry.dispose();
    this.shellMat.dispose();
  }
}
