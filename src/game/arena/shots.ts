// Shots in flight (1 normally, up to 4 in fever), firing rules, the shared
// "what does this ray reach first" cast (field bombs, rollers, boss shield,
// boss core), the aim ray and power previews.
//   fire(): playing, not rolling / stunned (buffered), fewer than the max
//   shots in flight and the cooldown elapsed (0.25 s, 0.18 in fever). A
//   loaded POWER fires first and keeps the current colour queued. Fever shots
//   are wild (take the colour of what they hit) and fly at 24 u/s.

import type { ArenaCore } from "./arenaCore";
import { raycastBombs, rayCircle } from "./arenaPhysics";
import type { PowerKind } from "./funTypes";
import type { AimRay, ShotState } from "./types";

export interface TargetHit {
  t: number;
  kind: AimRay["target"];
  index: number; // into active / rollers / boss shield (core: 0)
  id: number;
}

export class Shots {
  readonly list: ShotState[] = [];
  fireHeld = false;
  private readonly th: TargetHit = { t: 0, kind: null, index: -1, id: -1 };
  private aimCache: { rev: number; ray: AimRay } | null = null;

  constructor(private readonly core: ArenaCore) {}

  clear() {
    this.list.length = 0;
  }

  fire(): boolean {
    const core = this.core, s = core.shooter, c = core.config, f = core.fun.fever;
    if (!core.playing || !core.sys.roll.allowFire()) return false;
    const fever = core.sys.fever.active;
    if (this.list.length >= (fever ? f.maxShots : 1) || s.cooldown > 0) return false;
    const power = core.sys.pickups.takePower();
    const dirX = Math.cos(s.yaw), dirZ = Math.sin(s.yaw);
    this.list.push({
      id: core.nextId++, x: s.muzzleX, z: s.muzzleZ, dirX, dirZ, colorIndex: core.current, travelled: 0,
      speed: fever ? f.shotSpeed : c.shotSpeed, power, wild: fever && !power,
    });
    s.cooldown = fever ? f.fireCooldown : c.fireCooldown;
    core.emit("shoot", { x: s.muzzleX, z: s.muzzleZ, yaw: s.yaw, colorIndex: core.current });
    if (power) core.emit("powerFired", { kind: power, x: s.muzzleX, z: s.muzzleZ, yaw: s.yaw });
    else {
      core.current = core.next;
      core.next = core.pickColor();
      core.refreshLoadout();
    }
    core.touch();
    return true;
  }

  // First thing a moving circle (bomb radius) touches from (ox, oz) along (dx, dz).
  cast(ox: number, oz: number, dx: number, dz: number, maxDist: number): TargetHit {
    const core = this.core, r = core.config.bombRadius, out = this.th;
    const h = raycastBombs(core.active, ox, oz, dx, dz, maxDist, r, core.hit);
    out.t = h.t;
    out.kind = h.index >= 0 ? "bomb" : null;
    out.index = h.index;
    out.id = h.index >= 0 ? core.active[h.index].id : -1;
    const rollers = core.sys.rollers.list;
    for (let i = 0; i < rollers.length; i++) this.test(ox, oz, dx, dz, rollers[i].x, rollers[i].z, 2 * r, "roller", i, rollers[i].id);
    const boss = core.sys.boss.state;
    if (boss && boss.hp > 0) {
      for (let i = 0; i < boss.shield.length; i++) {
        const sh = boss.shield[i];
        if (sh.scale >= 1) this.test(ox, oz, dx, dz, sh.x, sh.z, 2 * r, "shield", i, sh.id);
      }
      this.test(ox, oz, dx, dz, boss.x, boss.z, boss.r + r, "core", 0, boss.id);
    }
    return out;
  }

  private test(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, sum: number, kind: TargetHit["kind"], i: number, id: number) {
    const t = rayCircle(ox, oz, dx, dz, cx, cz, sum);
    if (t >= 0 && (t < this.th.t || (this.th.kind === null && t <= this.th.t))) {
      this.th.t = t;
      this.th.kind = kind;
      this.th.index = i;
      this.th.id = id;
    }
  }

  update(dt: number) {
    const core = this.core, c = core.config;
    for (let i = 0; i < this.list.length; ) {
      const s = this.list[i];
      const seg = Math.min(s.speed * dt, c.shotRange - s.travelled);
      const h = this.cast(s.x, s.z, s.dirX, s.dirZ, seg);
      s.x += s.dirX * h.t;
      s.z += s.dirZ * h.t;
      s.travelled += h.t;
      if (h.kind !== null) {
        this.list.splice(i, 1);
        this.dispatch(s, h.kind, h.index, h.id);
        if (!core.playing) return this.clear();
        continue;
      }
      if (s.travelled >= c.shotRange - 1e-9) {
        this.list.splice(i, 1);
        core.sys.resolve.miss(s.x, s.z, false);
        continue;
      }
      i++;
    }
  }

  private dispatch(s: ShotState, kind: NonNullable<TargetHit["kind"]>, index: number, id: number) {
    const core = this.core, sys = core.sys, boss = sys.boss.state;
    if (kind === "bomb") return sys.resolve.hitBomb(s, core.active[index]);
    if (s.power === "mega") {
      if (kind === "roller") sys.rollers.shoot(index, s.colorIndex, true);
      return sys.resolve.mega(s.x, s.z);
    }
    if (kind === "roller") return sys.rollers.shoot(index, s.colorIndex, s.wild || s.power !== null);
    if (!boss) return;
    if (kind === "shield") {
      const sh = boss.shield[index];
      if (s.power === "lightning") return sys.resolve.lightning(sh);
      if (!sys.boss.hitShield(id, s.colorIndex, s.wild || s.power === "rainbow")) sys.resolve.miss(s.x, s.z, true);
      return;
    }
    // Core: never sticks
    const w = core.fun.powers, b = core.fun.boss;
    const weak = s.wild || s.power !== null || s.colorIndex === boss.weakColor;
    const dmg = s.power === "rainbow" ? w.rainbowCoreDamage : s.power === "lightning" ? w.lightningCoreDamage : weak ? b.weakDamage : b.damage;
    sys.boss.damage(dmg, weak, s.x, s.z);
  }

  // Aim guide from the muzzle (cached per revision): reaches the first
  // bomb / roller / shield / core; wouldPopIds honour the loaded power and fever.
  aimRay(): AimRay {
    const core = this.core;
    if (this.aimCache?.rev === core.revision) return this.aimCache.ray;
    const s = core.shooter, c = core.config;
    const dx = Math.cos(s.yaw), dz = Math.sin(s.yaw);
    const h = this.cast(s.muzzleX, s.muzzleZ, dx, dz, c.shotRange);
    const end = { x: s.muzzleX + dx * h.t, z: s.muzzleZ + dz * h.t };
    const isBomb = h.kind === "bomb";
    const ray: AimRay = {
      from: { x: s.muzzleX, z: s.muzzleZ }, to: end, hitBombId: isBomb ? h.id : null, landing: isBomb ? { ...end } : null,
      wouldPopIds: [], target: h.kind, targetId: h.kind ? h.id : null,
    };
    const power = core.sys.pickups.slot;
    if (power) ray.wouldPopIds = this.preview(power, s.yaw, s.muzzleX, s.muzzleZ);
    else if (isBomb) {
      const hitColor = core.active[h.index].colorIndex;
      const color = core.sys.fever.active ? hitColor : core.current;
      core.grid.build(core.active);
      const group = core.finder.groupFromPoint(core.active, core.grid, end.x, end.z, color, core.link);
      if (group.length + 1 >= c.minMatch) ray.wouldPopIds = group.map((i) => core.active[i].id);
    }
    this.aimCache = { rev: core.revision, ray };
    return ray;
  }

  // Field bomb ids a POWER shot fired along `yaw` from (ox, oz) would remove.
  preview(kind: PowerKind, yaw: number, ox: number, oz: number): number[] {
    const core = this.core, dx = Math.cos(yaw), dz = Math.sin(yaw);
    const h = this.cast(ox, oz, dx, dz, core.config.shotRange);
    if (h.kind === null) return [];
    const x = ox + dx * h.t, z = oz + dz * h.t;
    if (kind === "mega") return core.sys.resolve.megaSet(x, z).map((b) => b.id);
    if (h.kind === "roller" || h.kind === "core") return [];
    const boss = core.sys.boss.state;
    if (kind === "lightning") {
      const start = h.kind === "bomb" ? core.active[h.index] : boss!.shield[h.index];
      return core.sys.resolve.lightningChain(start).filter((n) => "state" in n).map((n) => n.id);
    }
    if (h.kind !== "bomb") return [];
    core.grid.build(core.active);
    return core.sys.resolve.rainbowSet(x, z).map((b) => b.id);
  }
}
