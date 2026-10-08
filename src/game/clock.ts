// Simulation clock shared by the engine loop and FX: hit-stop (freeze),
// slow motion and pause. Stateless per caller: each loop asks for the time
// scale "now" and multiplies its own real dt, so several loops (engine rAF,
// GL frame loop) stay in sync without double-counting.
// One clock per engine, looked up with getSimClock(engine).

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class SimClock {
  private freezeUntil = 0;
  private slowUntil = 0;
  private slowScale = 1;
  paused = false;

  // Hit-stop: hold the simulation for `ms` real milliseconds.
  freeze(ms: number) {
    this.freezeUntil = Math.max(this.freezeUntil, now() + ms);
  }

  // Slow motion at `scale` for `ms` real milliseconds.
  slow(scale: number, ms: number) {
    this.slowScale = scale;
    this.slowUntil = now() + ms;
  }

  reset() {
    this.freezeUntil = 0;
    this.slowUntil = 0;
    this.paused = false;
  }

  // Multiplier for real dt at this instant (0 while frozen or paused).
  scale(): number {
    if (this.paused) return 0;
    const t = now();
    if (t < this.freezeUntil) return 0;
    if (t < this.slowUntil) return this.slowScale;
    return 1;
  }
}

const clocks = new WeakMap<object, SimClock>();

export function getSimClock(owner: object): SimClock {
  let c = clocks.get(owner);
  if (!c) {
    c = new SimClock();
    clocks.set(owner, c);
  }
  return c;
}
