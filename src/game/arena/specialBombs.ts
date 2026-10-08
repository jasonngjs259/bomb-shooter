// Special bombs in the wall: placement (armored / ticking / roller replace a
// normal bomb of the same colour inside a clump, never two in one clump;
// ticking + roller sit on the inner face, >= 60 deg apart) and the TICKING
// system (stagger-armed countdown -> detonation -> capped LURCH).
// Armor itself is resolved in resolve.ts; rollers live in rollers.ts.

import type { RandomFn } from "../grid";
import type { ArenaFunConfig } from "./arenaFun";
import type { ArenaCore } from "./arenaCore";
import type { BandSpec } from "./arenaLevels";
import type { SimBomb } from "./arenaPhysics";
import { borderGap } from "./arenaSim";
import type { LevelDef } from "./funTypes";

const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// Tag bombs as specials per the LevelDef. Only consumes `rand` when the level has specials.
export function assignSpecials(bombs: readonly SimBomb[], d: LevelDef, bands: readonly BandSpec[], fun: ArenaFunConfig, rand: RandomFn) {
  const used = new Set<number>(); // clumps holding a special
  const faceAngles: number[] = [];
  const minSep = (fun.ticking.minSepDeg * Math.PI) / 180;
  const innerOf = (b: SimBomb) => bands.find((x) => x.band === b.band)?.inner ?? 0;
  const pick = (pool: SimBomb[]) => (pool.length ? pool[Math.floor(rand() * pool.length)] : null);

  const placeFace = (kind: "ticking" | "roller") => {
    const free = bombs.filter((b) => b.kind === "normal" && !used.has(b.clump));
    const face = free.filter((b) => Math.hypot(b.x, b.z) <= innerOf(b) + fun.ticking.innerFace);
    const apart = (b: SimBomb) => faceAngles.every((a) => angDist(a, Math.atan2(b.z, b.x)) >= minSep);
    const b = pick(face.filter(apart)) ?? pick(face) ?? pick(free);
    if (!b) return;
    used.add(b.clump);
    faceAngles.push(Math.atan2(b.z, b.x));
    b.kind = kind;
    if (kind === "ticking") b.timer = d.tickTimer;
  };
  for (let i = 0; i < d.ticking; i++) placeFace("ticking");
  for (let i = 0; i < d.rollers; i++) placeFace("roller");
  for (let i = 0; i < d.armored; i++) {
    const b = pick(bombs.filter((x) => x.kind === "normal" && !used.has(x.clump))) ?? pick(bombs.filter((x) => x.kind === "normal"));
    if (!b) break;
    used.add(b.clump);
    b.kind = "armored";
    b.armor = 1;
  }
}

export class Ticking {
  private list: SimBomb[] = []; // every ticking bomb placed this level
  private nextArm = 0; // worldTime when the next stagger slot opens
  private lastWhole = new Map<number, number>();

  constructor(private readonly core: ArenaCore) {}

  reset() {
    this.list = this.core.bombs.filter((b) => b.kind === "ticking");
    this.nextArm = this.core.fun.ticking.firstArm;
    this.lastWhole.clear();
  }

  // A ticking bomb left the field by pop / shatter / power: defused.
  defuse(b: SimBomb) {
    if (b.kind !== "ticking") return 0;
    const remaining = b.timer ?? 0;
    b.armed = false;
    this.core.emit("tickingDefused", { id: b.id, x: b.x, z: b.z, remaining });
    return this.core.fun.ticking.score;
  }

  update(dt: number) {
    const core = this.core, t = core.fun.ticking;
    if (this.list.length === 0 || core.worldPaused) return;
    let armed = 0;
    let boom: SimBomb | null = null;
    for (const b of this.list) {
      if (b.state !== "idle" || !b.armed || b.timer === null) continue;
      armed++;
      b.timer = Math.max(0, b.timer - dt);
      const whole = Math.ceil(b.timer);
      if (whole <= t.warnAt && whole > 0 && this.lastWhole.get(b.id) !== whole) {
        this.lastWhole.set(b.id, whole);
        core.emit("tickingWarning", { id: b.id, remaining: whole });
      }
      if (b.timer <= 0 && !boom) boom = b;
    }
    if (core.worldTime >= this.nextArm && armed < t.maxArmed) {
      let best: SimBomb | null = null;
      let bestGap = t.armGap;
      for (const b of this.list) {
        if (b.state !== "idle" || b.armed) continue;
        const gap = borderGap(b, core.config);
        if (gap <= bestGap) {
          bestGap = gap;
          best = b;
        }
      }
      if (best) {
        best.armed = true;
        best.timer = core.def.tickTimer;
        this.nextArm = core.worldTime + t.armEvery;
        core.intro("ticking");
        core.emit("tickingArmed", { id: best.id, timer: best.timer });
      }
    }
    if (boom) this.detonate(boom);
  }

  // Force-arm (tests / debug): arms `id` (or the first unarmed) now.
  debugArm(id?: number) {
    const b = this.list.find((x) => x.state === "idle" && !x.armed && (id === undefined || x.id === id));
    if (!b) return false;
    b.armed = true;
    b.timer = this.core.def.tickTimer;
    this.core.emit("tickingArmed", { id: b.id, timer: b.timer });
    return true;
  }

  private detonate(b: SimBomb) {
    const core = this.core;
    b.armed = false;
    b.state = "popping";
    b.age = 0;
    core.refreshActive();
    core.emit("tickingExploded", { id: b.id, x: b.x, z: b.z });
    core.sys.ring.settle();
    let gap = Infinity;
    for (const o of core.active) gap = Math.min(gap, borderGap(o, core.config));
    const distance = core.sys.ring.startLurch(gap);
    core.emit("lurch", { distance, angle: Math.atan2(b.z, b.x) });
    core.combo = 0;
    core.sys.stars.breakFlawless();
  }
}
