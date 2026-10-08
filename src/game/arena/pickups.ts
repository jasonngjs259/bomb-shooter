// POWER-UP PICKUPS (L1 Rainbow + Freeze, L3 Mega, L4 Lightning).
//   Drop on a resolved pop of n = popped + shattered + armor breaks:
//   n<=4 0%, 5 30%, 6 40%, 7-8 60%, >=9 100%; +15% at combo >= 3; x0.5 in
//   fever; pity after 25 s without a drop (next n >= 4 drops); L1 teach (first
//   n >= 4 drops a Rainbow). Limits: nothing in flight, < 2 on the floor, 6 s
//   cooldown, none while frozen. Kind weights Rainbow 35 / Freeze 25 / Mega 20
//   / Lightning 20 (Freeze x2, Rainbow x1.5 at danger >= 0.6).
//   Flight 0.7 s arc to r 3.8 +- 0.6 along the pop angle (+-12 deg), >= 1.2
//   from other pickups and >= 1.0 from the player (8 tries, else r 2.5).
//   Floor: collect within 0.7, magnet within 1.6 at 4 w/s, 10 s ttl (blink in
//   the last 3 s). One POWER slot: Rainbow / Mega / Lightning load as the next
//   shot; while loaded, other shot-type pickups are locked (timer paused).
//   Freeze is instant: 5 s, +5 s per extra Freeze, capped at 8 s left.

import type { ArenaCore } from "./arenaCore";
import type { Pickup, PickupKind, PowerKind } from "./funTypes";
import type { Vec2XZ } from "./types";

interface PickupSim extends Pickup {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
}

const DEG = Math.PI / 180;

export class Pickups {
  readonly list: PickupSim[] = [];
  slot: PowerKind | null = null;
  private lastDrop = 0; // time of the last drop (pity clock), level start = 0
  private lastDropAt = -Infinity; // cooldown clock
  private taught = false;
  private blockedAt = -Infinity;

  constructor(private readonly core: ArenaCore) {}

  reset() {
    this.list.length = 0;
    this.slot = null;
    this.lastDrop = 0;
    this.lastDropAt = -Infinity;
    this.taught = false;
    this.blockedAt = -Infinity;
  }

  private get enabled() {
    return this.core.def.pickups.length > 0;
  }

  // Drop evaluation for one resolved pop.
  onPop(n: number, centre: Vec2XZ) {
    const core = this.core, p = core.fun.pickups;
    if (!this.enabled || !core.playing || core.freeze > 0 || !this.canDrop()) return;
    if (core.time - this.lastDropAt < p.dropCooldown) return;
    let kind: PickupKind | null = null;
    if (core.level === 1 && !this.taught && n >= p.teachMinN && core.def.pickups.includes("rainbow")) {
      this.taught = true;
      kind = "rainbow";
    } else {
      let chance = 0;
      for (const [min, c] of p.dropTable) if (n >= min) chance = c;
      if (chance > 0 && core.combo >= p.comboBonusAt) chance += p.comboBonus;
      if (core.sys.fever.active) chance *= p.feverChanceScale;
      if (core.time - this.lastDrop >= p.pityTime && n >= p.pityMinN) chance = 1;
      if (chance <= 0 || (chance < 1 && core.random() >= chance)) return;
      kind = this.pickKind();
    }
    this.drop(kind, centre.x, centre.z);
  }

  // Guaranteed drop (boss phase shift): ignores chance and cooldown.
  forceDrop(x: number, z: number) {
    if (!this.enabled || !this.canDrop()) return;
    this.drop(this.pickKind(), x, z);
  }

  // Dev / tests: a pickup already on the floor at (x, z).
  debugSpawn(kind: PickupKind, x: number, z: number) {
    const p = this.core.fun.pickups;
    const pk: PickupSim = {
      id: this.core.nextId++, kind, x, z, y: p.groundY, state: "ground", age: 0, ttl: p.ttl, locked: false,
      fromX: x, fromZ: z, toX: x, toZ: z,
    };
    this.list.push(pk);
    this.core.emit("pickupSpawned", { id: pk.id, kind, from: { x, z }, to: { x, z }, flight: 0 });
    this.core.emit("pickupLanded", { id: pk.id });
    return pk.id;
  }

  // Take the loaded POWER (fire()).
  takePower(): PowerKind | null {
    const k = this.slot;
    this.slot = null;
    return k;
  }

  update(dt: number) {
    const core = this.core, p = core.fun.pickups, s = core.shooter;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const pk = this.list[i];
      pk.locked = pk.kind !== "freeze" && this.slot !== null;
      if (pk.state === "flying") {
        pk.age += dt;
        const u = Math.min(1, pk.age / p.flight);
        pk.x = pk.fromX + (pk.toX - pk.fromX) * u;
        pk.z = pk.fromZ + (pk.toZ - pk.fromZ) * u;
        const y0 = 0.45, mid = (y0 + p.groundY) / 2;
        pk.y = y0 + (p.groundY - y0) * u + 4 * (p.apexY - mid) * u * (1 - u);
        pk.ttl = Math.max(0, p.flight - pk.age);
        if (u >= 1) {
          pk.state = "ground";
          pk.age = 0;
          pk.ttl = p.ttl;
          pk.y = p.groundY;
          core.emit("pickupLanded", { id: pk.id });
          core.intro("pickups");
        }
        continue;
      }
      pk.age += dt;
      if (!pk.locked) pk.ttl -= dt;
      pk.state = pk.ttl <= p.blinkAt ? "blinking" : "ground";
      const dx = s.x - pk.x, dz = s.z - pk.z, d = Math.hypot(dx, dz);
      if (!pk.locked && d <= p.magnetRadius && d > 1e-6) {
        const m = Math.min(d, p.magnetSpeed * dt);
        pk.x += (dx / d) * m;
        pk.z += (dz / d) * m;
      }
      const d2 = Math.hypot(s.x - pk.x, s.z - pk.z);
      if (d2 <= p.grabRadius) {
        if (!pk.locked) {
          this.list.splice(i, 1);
          this.collect(pk);
          continue;
        }
        if (core.time - this.blockedAt >= p.blockedThrottle) {
          this.blockedAt = core.time;
          core.emit("pickupBlocked", { id: pk.id });
        }
      }
      if (pk.ttl <= 0) {
        this.list.splice(i, 1);
        core.emit("pickupExpired", { id: pk.id, kind: pk.kind });
      }
    }
  }

  private canDrop() {
    let ground = 0;
    for (const pk of this.list) {
      if (pk.state === "flying") return false;
      ground++;
    }
    return ground < this.core.fun.pickups.maxGround;
  }

  private pickKind(): PickupKind {
    const core = this.core, p = core.fun.pickups;
    const kinds = core.def.pickups;
    const hot = core.danger >= p.freezeDangerAt;
    const w = (k: PickupKind) =>
      p.weights[k] * (hot && k === "freeze" ? p.freezeDangerScale : hot && k === "rainbow" ? p.rainbowDangerScale : 1);
    let total = 0;
    for (const k of kinds) total += w(k);
    let roll = core.random() * total;
    for (const k of kinds) {
      roll -= w(k);
      if (roll < 0) return k;
    }
    return kinds[kinds.length - 1];
  }

  private drop(kind: PickupKind, fromX: number, fromZ: number) {
    const core = this.core, p = core.fun.pickups, s = core.shooter;
    const base = Math.atan2(fromZ, fromX);
    let toX = Math.cos(base) * p.fallbackRadius, toZ = Math.sin(base) * p.fallbackRadius;
    for (let t = 0; t < p.landRetries; t++) {
      const a = base + (core.random() * 2 - 1) * p.landJitterDeg * DEG;
      const r = p.landRadius + (core.random() * 2 - 1) * p.landJitterR;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x - s.x, z - s.z) < p.minPlayerDist) continue;
      if (this.list.some((o) => Math.hypot(o.toX - x, o.toZ - z) < p.minPickupDist)) continue;
      toX = x;
      toZ = z;
      break;
    }
    const pk: PickupSim = {
      id: core.nextId++, kind, x: fromX, z: fromZ, y: 0.45, state: "flying", age: 0, ttl: p.flight, locked: false,
      fromX, fromZ, toX, toZ,
    };
    this.list.push(pk);
    this.lastDrop = this.lastDropAt = core.time;
    core.emit("pickupSpawned", { id: pk.id, kind, from: { x: fromX, z: fromZ }, to: { x: toX, z: toZ }, flight: p.flight });
  }

  private collect(pk: PickupSim) {
    const core = this.core, w = core.fun.powers;
    let loaded = false;
    if (pk.kind === "freeze") {
      const was = core.freeze;
      core.freeze = was > 0 ? Math.min(w.freezeCap, was + w.freezeStack) : w.freezeDuration;
      core.emit("pickupCollected", { id: pk.id, kind: pk.kind, x: pk.x, z: pk.z, loaded });
      core.emit("freezeStart", { duration: core.freeze });
    } else {
      this.slot = pk.kind;
      loaded = true;
      core.emit("pickupCollected", { id: pk.id, kind: pk.kind, x: pk.x, z: pk.z, loaded });
    }
    core.intro(pk.kind);
    core.addScore(core.fun.pickups.score);
  }
}
