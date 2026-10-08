// Level twists that move the whole wall: ring rotation (per band, eased in
// over 2 s after GO, stopped by Freeze), the ticking-bomb LURCH (radially
// inward over 0.4 s, easeOutCubic) and outward kicks (boss phase shifts).

import type { ArenaCore } from "./arenaCore";

const DEG = Math.PI / 180;
const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;

export class RingMotion {
  private lurchDist = 0;
  private lurchT = -1; // s into the current lurch, -1 = none
  // Current angular speed per band, rad/s (0 while frozen / paused)
  readonly omega: [number, number] = [0, 0];

  constructor(private readonly core: ArenaCore) {}

  reset() {
    this.lurchDist = 0;
    this.lurchT = -1;
    this.omega[0] = this.omega[1] = 0;
  }

  // Rotate every idle field bomb (incl. stuck shots) about the origin. Runs
  // before creep and relaxation.
  rotate(dt: number) {
    const core = this.core, rot = core.def.rotation;
    const ease = Math.min(1, core.time / core.fun.rotation.easeIn);
    const k = core.worldPaused ? 0 : ease * ease * (3 - 2 * ease);
    this.omega[0] = rot[0] * DEG * k;
    this.omega[1] = rot[1] * DEG * k;
    if (this.omega[0] === 0 && this.omega[1] === 0) return;
    const c0 = Math.cos(this.omega[0] * dt), s0 = Math.sin(this.omega[0] * dt);
    const c1 = Math.cos(this.omega[1] * dt), s1 = Math.sin(this.omega[1] * dt);
    for (const b of core.active) {
      const c = b.band === 1 ? c1 : c0, s = b.band === 1 ? s1 : s0;
      const x = b.x;
      b.x = x * c - b.z * s;
      b.z = x * s + b.z * c;
    }
  }

  // Lurch distance for the current wall: min(lurchMax, max(0, minGap - lurchKeep)),
  // so a lurch alone can never push a bomb onto the border. Call settle()
  // and re-measure the gap first.
  startLurch(minGap: number) {
    const t = this.core.fun.ticking;
    const dist = Math.min(t.lurchMax, Math.max(0, minGap - t.lurchKeep));
    this.lurchDist = dist;
    this.lurchT = dist > 0 ? 0 : -1;
    return dist;
  }

  stepLurch(dt: number) {
    if (this.lurchT < 0) return;
    const T = this.core.fun.ticking.lurchTime;
    const t1 = Math.min(T, this.lurchT + dt);
    this.moveInward(this.lurchDist * (easeOutCubic(t1 / T) - easeOutCubic(this.lurchT / T)));
    this.lurchT = t1 >= T ? -1 : t1;
  }

  // Outward kick on every idle bomb (decays like pop knock-back).
  kickOutward(speed: number) {
    for (const b of this.core.active) b.kick += speed;
  }

  // Complete a running lurch instantly (before starting another one).
  settle() {
    if (this.lurchT < 0) return;
    const T = this.core.fun.ticking.lurchTime;
    this.moveInward(this.lurchDist * (1 - easeOutCubic(this.lurchT / T)));
    this.lurchT = -1;
  }

  private moveInward(d: number) {
    if (d === 0) return;
    for (const b of this.core.active) {
      const r = Math.hypot(b.x, b.z);
      if (r < 1e-6) continue;
      b.x -= (b.x / r) * d;
      b.z -= (b.z / r) * d;
    }
  }
}
