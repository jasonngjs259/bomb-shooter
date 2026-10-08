// FEVER (unlocked L2): a 0-100 meter filled by pops, auto-starting at 100
// for 6 s of rapid fire (0.18 s cooldown, up to 4 shots, 24 u/s, wild colours,
// score x2, slow-mo on the first fever pop), then a 4 s lockout at 0.
// Decays at 3/s after 5 s without a pop; misses -8, roller hits -30.

import type { ArenaCore } from "./arenaCore";
import type { FeverState } from "./funTypes";

export class Fever {
  readonly state: FeverState = { meter: 0, active: false, remaining: 0, lockout: 0 };
  private sincePop = 0;
  private decayAcc = 0;
  private pops = 0;
  private gained = 0;
  private slowMoDone = false;

  constructor(private readonly core: ArenaCore) {}

  get enabled() {
    return this.core.def.fever;
  }

  get active() {
    return this.state.active;
  }

  reset() {
    Object.assign(this.state, { meter: 0, active: false, remaining: 0, lockout: 0 });
    this.sincePop = this.decayAcc = this.pops = this.gained = 0;
    this.slowMoDone = false;
  }

  // Meter change from play (pop fill, shield pop, penalties). Ignored while
  // active or locked out (penalties too: the meter is already 0 then).
  add(delta: number) {
    const s = this.state;
    if (!this.enabled || s.active || s.lockout > 0 || delta === 0) return;
    const f = this.core.fun.fever;
    const before = s.meter;
    s.meter = Math.max(0, Math.min(f.max, s.meter + delta));
    if (delta > 0) this.sincePop = 0;
    if (s.meter !== before) this.core.emit("feverChanged", { meter: s.meter, delta: s.meter - before });
    if (s.meter >= f.introAt) this.core.intro("fever");
  }

  // Fill for one resolved pop.
  onPop(popped: number, shattered: number, combo: number) {
    const f = this.core.fun.fever;
    if (this.state.active) {
      this.pops++;
      if (!this.slowMoDone) {
        this.slowMoDone = true;
        this.core.timeScale.trigger(f.slowMoScale, f.slowMoHold, f.slowMoRamp);
        this.core.emit("slowMo", { scale: f.slowMoScale, realDuration: f.slowMoHold, ramp: f.slowMoRamp });
      }
      return;
    }
    const fill = f.fillBase + f.perPopped * (popped - 3) + f.perShatter * shattered + f.perCombo * Math.min(combo - 1, f.comboCap);
    this.add(Math.max(1, fill));
  }

  // Score gained while active (for feverEnd).
  noteScore(points: number) {
    if (this.state.active) this.gained += points;
  }

  set(v: number) {
    const s = this.state;
    s.lockout = 0;
    s.meter = Math.max(0, Math.min(this.core.fun.fever.max, v));
    this.core.emit("feverChanged", { meter: s.meter, delta: 0 });
  }

  update(dt: number) {
    if (!this.enabled) return;
    const s = this.state, f = this.core.fun.fever;
    if (s.active) {
      s.remaining = Math.max(0, s.remaining - dt);
      s.meter = (s.remaining / f.duration) * f.max;
      if (s.remaining <= 0) this.end();
      return;
    }
    if (s.lockout > 0) {
      s.lockout = Math.max(0, s.lockout - dt);
      return;
    }
    if (s.meter >= f.max) {
      this.start();
      return;
    }
    this.sincePop += dt;
    if (this.sincePop > f.decayDelay && s.meter > 0) {
      const d = Math.min(s.meter, f.decayRate * dt);
      s.meter -= d;
      this.decayAcc += d;
      if (this.decayAcc >= f.changeStep || s.meter <= 0) {
        this.core.emit("feverChanged", { meter: s.meter, delta: -this.decayAcc });
        this.decayAcc = 0;
      }
    }
  }

  private start() {
    const s = this.state, f = this.core.fun.fever;
    s.active = true;
    s.remaining = f.duration;
    s.meter = f.max;
    this.pops = this.gained = 0;
    this.slowMoDone = false;
    this.core.emit("feverStart", { duration: f.duration });
  }

  private end() {
    const s = this.state;
    s.active = false;
    s.remaining = 0;
    s.meter = 0;
    s.lockout = this.core.fun.fever.lockout;
    this.decayAcc = 0;
    this.core.emit("feverEnd", { pops: this.pops, score: this.gained });
  }
}
