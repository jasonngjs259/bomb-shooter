// ROLLERS: wall bombs that telegraph for 1 s, detach and roll at 2.6 w/s at
// the player (homing 35 deg/s until 2.5 w away, then a locked straight line).
// Launch at the first of: border gap <= 3.0 or a launch clock (12-22 s after
// GO, >= 8 s apart); never while frozen or at the live cap. Expire off the
// far side (r > 6.6 after entering) or after 8 s. Contact (0.85, no i-frames,
// no immunity) = knock-back + stun + combo reset + fever -30 + FLAWLESS lost,
// never game over. Any shot destroys a roller.

import type { ArenaCore } from "./arenaCore";
import type { SimBomb } from "./arenaPhysics";
import { borderGap } from "./arenaSim";
import type { Roller } from "./funTypes";

interface RollerSim extends Roller {
  entered: boolean;
  locked: boolean; // homing finished
  dodged: boolean; // perfect dodge already awarded
  noHit: number; // s left during which it can't hit (after a perfect dodge)
  baseSpeed: number;
}

const DEG = Math.PI / 180;

export class Rollers {
  readonly list: RollerSim[] = [];
  private wall: SimBomb[] = []; // roller bombs still in the wall
  private clocks = new Map<number, number>(); // bomb id -> launch worldTime
  private lastClockLaunch = -Infinity;
  private speedScale = new Map<number, number>(); // debug launches (tutorial 0.7x)

  constructor(private readonly core: ArenaCore) {}

  reset() {
    const core = this.core, r = core.fun.roller;
    this.list.length = 0;
    this.wall = core.bombs.filter((b) => b.kind === "roller");
    this.clocks.clear();
    this.speedScale.clear();
    this.lastClockLaunch = -Infinity;
    const times = this.wall.map(() => r.clockMin + core.random() * (r.clockMax - r.clockMin)).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1] + r.clockSep);
    this.wall.forEach((b, i) => this.clocks.set(b.id, times[i]));
  }

  // Telegraphing + rolling (the live cap counts both).
  get live() {
    let n = this.list.length;
    for (const b of this.wall) if (b.state === "idle" && b.telegraph >= 0) n++;
    return n;
  }

  // Start the 1 s telegraph on a wall bomb.
  telegraph(b: SimBomb, speedScale = 1) {
    if (b.state !== "idle" || b.telegraph >= 0) return false;
    if (!this.wall.includes(b)) this.wall.push(b);
    b.kind = "roller";
    b.telegraph = this.core.fun.roller.telegraph;
    if (speedScale !== 1) this.speedScale.set(b.id, speedScale);
    this.core.intro("roller");
    this.core.emit("rollerTelegraph", { id: b.id, x: b.x, z: b.z, launchIn: b.telegraph });
    return true;
  }

  // Launch a roller straight from a point (boss core): no telegraph.
  spawn(id: number, x: number, z: number, colorIndex: number) {
    const s = this.core.shooter;
    const d = Math.hypot(s.x - x, s.z - z) || 1;
    this.add(id, x, z, (s.x - x) / d, (s.z - z) / d, colorIndex, 1);
  }

  update(dt: number) {
    const core = this.core, r = core.fun.roller;
    const frozen = core.freeze > 0;
    // Wall: telegraph countdown and launch triggers
    for (let i = this.wall.length - 1; i >= 0; i--) {
      const b = this.wall[i];
      if (b.state !== "idle") {
        this.wall.splice(i, 1); // popped / shattered in the wall
        continue;
      }
      if (b.telegraph >= 0) {
        if (frozen) continue;
        b.telegraph = Math.max(0, b.telegraph - dt);
        if (b.telegraph <= 0) {
          this.wall.splice(i, 1);
          this.detach(b);
        }
        continue;
      }
      if (core.worldPaused || this.live >= core.def.rollersLive) continue;
      const clock = this.clocks.get(b.id) ?? Infinity;
      const byClock = core.worldTime >= clock && core.worldTime - this.lastClockLaunch >= r.clockSep;
      if (borderGap(b, core.config) <= r.launchGap || byClock) {
        if (byClock) this.lastClockLaunch = core.worldTime;
        this.telegraph(b);
      }
    }
    this.move(dt, frozen);
  }

  // A shot reached roller `i`. Returns true (the shot is consumed).
  shoot(i: number, colorIndex: number, wild: boolean) {
    const core = this.core, r = core.fun.roller;
    const ro = this.list[i];
    const matched = wild || colorIndex === ro.colorIndex;
    this.list.splice(i, 1);
    core.emit("rollerDestroyed", { id: ro.id, x: ro.x, z: ro.z, matched });
    if (matched) {
      core.bumpCombo();
      core.sys.fever.add(core.fun.fever.rollerShotFill);
    }
    core.addScore(r.score);
    return true;
  }

  private detach(b: SimBomb) {
    const core = this.core, s = core.shooter;
    core.detach(b);
    b.telegraph = -1;
    const d = Math.hypot(s.x - b.x, s.z - b.z) || 1;
    this.add(b.id, b.x, b.z, (s.x - b.x) / d, (s.z - b.z) / d, b.colorIndex, this.speedScale.get(b.id) ?? 1);
  }

  private add(id: number, x: number, z: number, dirX: number, dirZ: number, colorIndex: number, scale: number) {
    const speed = this.core.fun.roller.speed * scale;
    this.list.push({ id, x, z, dirX, dirZ, speed, baseSpeed: speed, colorIndex, age: 0, entered: false, locked: false, dodged: false, noHit: 0 });
    this.core.emit("rollerLaunched", { id, x, z, dirX, dirZ, speed, colorIndex });
  }

  private move(dt: number, frozen: boolean) {
    const core = this.core, r = core.fun.roller, s = core.shooter, roll = core.sys.roll;
    const R = core.config.arenaRadius;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const ro = this.list[i];
      ro.speed = frozen ? 0 : ro.baseSpeed;
      if (!frozen) {
        const dx = s.x - ro.x, dz = s.z - ro.z, dist = Math.hypot(dx, dz);
        if (!ro.locked && dist > r.lockDist) {
          const want = Math.atan2(dz, dx), have = Math.atan2(ro.dirZ, ro.dirX);
          const diff = Math.atan2(Math.sin(want - have), Math.cos(want - have));
          const max = r.homingDeg * DEG * dt;
          const a = have + Math.max(-max, Math.min(max, diff));
          ro.dirX = Math.cos(a);
          ro.dirZ = Math.sin(a);
        } else ro.locked = true;
        ro.x += ro.dirX * ro.speed * dt;
        ro.z += ro.dirZ * ro.speed * dt;
        ro.age += dt;
        ro.noHit = Math.max(0, ro.noHit - dt);
      }
      const rad = Math.hypot(ro.x, ro.z);
      if (rad < R) ro.entered = true;
      const pd = Math.hypot(s.x - ro.x, s.z - ro.z);
      if (roll.state.iFrames && !ro.dodged && pd <= r.dodgeDist) {
        ro.dodged = true;
        ro.noHit = 0.5;
        this.perfectDodge(ro);
      } else if (pd <= r.contact && !roll.state.iFrames && roll.immunity <= 0 && ro.noHit <= 0) {
        this.list.splice(i, 1);
        roll.hitBy(ro.dirX, ro.dirZ, ro.x, ro.z);
        core.emit("rollerDestroyed", { id: ro.id, x: ro.x, z: ro.z, matched: false });
        continue;
      }
      if ((ro.entered && rad > r.expireR) || ro.age > r.maxAge) {
        this.list.splice(i, 1);
        core.emit("rollerExpired", { id: ro.id, x: ro.x, z: ro.z });
      }
    }
  }

  private perfectDodge(ro: RollerSim) {
    const core = this.core, r = core.fun.roller;
    core.emit("perfectDodge", { rollerId: ro.id });
    core.addScore(r.dodgeScore);
    core.sys.fever.add(core.fun.fever.perfectDodgeFill);
    if (!core.sys.fever.active) {
      core.timeScale.trigger(r.dodgeSlowScale, r.dodgeSlowHold, r.dodgeSlowRamp);
      core.emit("slowMo", { scale: r.dodgeSlowScale, realDuration: r.dodgeSlowHold, ramp: r.dodgeSlowRamp });
    }
  }
}
