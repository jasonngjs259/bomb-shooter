// Dodge ROLL (unlocked L5) plus the player-hit state it interacts with.
//   Roll: 3.0 w over 0.5 s, v(t) = 2D/T (1 - t/T), clamped to the arena;
//   i-frames 0.04-0.42 s; cooldown 1.6 s from start; a roll pressed <= 0.2 s
//   before it is ready (cooldown or stun) fires when ready; fire pressed
//   during a roll fires at roll end; exits at 3 w/s.
//   Hit (roller contact): 1.2 w knock-back (critically damped, omega 14),
//   0.6 s stun (no move / fire / roll, turning at 50%; presses in the last
//   0.2 s are buffered), then 1.0 s roller immunity.

import type { ArenaCore } from "./arenaCore";
import { clampShooter } from "./arenaSim";
import type { RollState } from "./funTypes";

export class RollSystem {
  readonly state: RollState = { state: "locked", t: 0, cooldown: 0, iFrames: false, dirX: 0, dirZ: -1 };
  stun = 0;
  immunity = 0;
  private rolling = false;
  private rollBuffer = -1; // s left on a buffered roll press
  private rollBufDir = { x: 0, z: 0 };
  private fireBuffer = false;
  private knockT = -1;
  private knockX = 0;
  private knockZ = 0;
  private knockDone = 0;

  constructor(private readonly core: ArenaCore) {}

  get enabled() {
    return this.core.def.roll;
  }

  get isRolling() {
    return this.rolling;
  }

  reset() {
    Object.assign(this.state, { state: this.enabled ? "ready" : "locked", t: 0, cooldown: 0, iFrames: false, dirX: 0, dirZ: -1 });
    this.rolling = false;
    this.stun = this.immunity = 0;
    this.rollBuffer = -1;
    this.fireBuffer = false;
    this.knockT = -1;
  }

  // roll() command: world-space direction (|v| <= 0.3 -> move input, else backward).
  request(dirX: number, dirZ: number): boolean {
    const core = this.core, r = core.fun.roll;
    if (!this.enabled || !core.playing) return false;
    let x = Number.isFinite(dirX) ? dirX : 0, z = Number.isFinite(dirZ) ? dirZ : 0;
    if (Math.hypot(x, z) <= r.minInput) {
      x = core.input.x;
      z = core.input.z;
    }
    if (Math.hypot(x, z) <= r.minInput) {
      x = -Math.cos(core.shooter.yaw);
      z = -Math.sin(core.shooter.yaw);
    }
    const len = Math.hypot(x, z);
    x /= len;
    z /= len;
    if (this.canRollNow()) {
      this.start(x, z);
      return true;
    }
    const wait = Math.max(this.stun, this.rolling ? Infinity : this.state.cooldown);
    if (wait <= r.buffer) {
      this.rollBuffer = r.buffer;
      this.rollBufDir.x = x;
      this.rollBufDir.z = z;
      return true;
    }
    return false;
  }

  // Can fire() go through now? If not, buffer the press when allowed.
  allowFire(): boolean {
    if (!this.rolling && this.stun <= 0) return true;
    if (this.rolling || this.stun <= this.core.fun.roll.buffer) this.fireBuffer = true;
    return false;
  }

  // Buffered fire ready to execute (consumes it).
  takeFireBuffer(): boolean {
    if (!this.fireBuffer || this.rolling || this.stun > 0) return false;
    this.fireBuffer = false;
    return true;
  }

  // Roller contact.
  hitBy(dirX: number, dirZ: number, x: number, z: number) {
    const core = this.core, r = core.fun.roller;
    if (this.rolling) this.endRoll(false);
    this.stun = r.stun;
    this.immunity = r.stun + r.immunity;
    this.knockT = 0;
    this.knockX = dirX;
    this.knockZ = dirZ;
    this.knockDone = 0;
    this.fireBuffer = false;
    core.shooter.vx = core.shooter.vz = core.shooter.ax = core.shooter.az = 0;
    core.combo = 0;
    core.sys.fever.add(-core.fun.fever.rollerHitPenalty);
    core.sys.stars.breakFlawless();
    core.emit("playerHit", { by: "roller", x, z, knockX: dirX * r.knock, knockZ: dirZ * r.knock, stun: r.stun });
  }

  // Moves the shooter while rolling (returns true: skip normal movement).
  step(dt: number): boolean {
    const core = this.core, s = core.shooter, r = core.fun.roll, st = this.state;
    this.stun = Math.max(0, this.stun - dt);
    this.immunity = Math.max(0, this.immunity - dt);
    if (st.cooldown > 0) {
      st.cooldown = Math.max(0, st.cooldown - dt);
      if (st.cooldown === 0 && this.enabled) core.emit("rollReady", {});
    }
    if (this.rollBuffer >= 0) {
      this.rollBuffer -= dt;
      if (this.canRollNow()) {
        this.rollBuffer = -1;
        this.start(this.rollBufDir.x, this.rollBufDir.z);
      }
    }
    this.stepKnock(dt);
    let moved = false;
    if (this.rolling) {
      const T = r.duration, D = r.distance;
      const t0 = st.t, t1 = Math.min(T, t0 + dt);
      const disp = (t: number) => ((2 * D) / T) * (t - (t * t) / (2 * T));
      const d = disp(t1) - disp(t0);
      const v = ((2 * D) / T) * (1 - t1 / T);
      s.x += st.dirX * d;
      s.z += st.dirZ * d;
      s.vx = st.dirX * v;
      s.vz = st.dirZ * v;
      s.ax = s.az = 0;
      st.t = t1;
      st.iFrames = t1 >= r.iStart && t1 <= r.iEnd;
      clampShooter(s, core.config);
      if (t1 >= T) this.endRoll(true);
      moved = true;
    }
    st.state = !this.enabled ? "locked" : this.rolling ? "rolling" : st.cooldown > 0 ? "cooldown" : "ready";
    return moved;
  }

  private canRollNow() {
    return this.enabled && !this.rolling && this.stun <= 0 && this.state.cooldown <= 0;
  }

  private start(x: number, z: number) {
    const st = this.state, r = this.core.fun.roll;
    this.rolling = true;
    st.t = 0;
    st.dirX = x;
    st.dirZ = z;
    st.iFrames = false;
    st.cooldown = r.cooldown;
    st.state = "rolling";
    this.core.intro("roll");
    this.core.emit("rollStart", { dirX: x, dirZ: z, duration: r.duration, distance: r.distance });
  }

  private endRoll(natural: boolean) {
    const s = this.core.shooter, st = this.state;
    this.rolling = false;
    st.iFrames = false;
    st.t = 0;
    if (natural) {
      s.vx = st.dirX * this.core.fun.roll.exitSpeed;
      s.vz = st.dirZ * this.core.fun.roll.exitSpeed;
      s.ax = s.az = 0;
    }
    this.core.emit("rollEnd", {});
  }

  // Critically damped knock-back: x(t) = D (1 - (1 + w t) e^(-w t)).
  private stepKnock(dt: number) {
    if (this.knockT < 0) return;
    const core = this.core, r = core.fun.roller, s = core.shooter;
    this.knockT += dt;
    const w = r.knockOmega, t = this.knockT;
    const target = r.knock * (1 - (1 + w * t) * Math.exp(-w * t));
    const d = target - this.knockDone;
    this.knockDone = target;
    s.x += this.knockX * d;
    s.z += this.knockZ * d;
    clampShooter(s, core.config);
    if (t > 1) this.knockT = -1;
  }
}
