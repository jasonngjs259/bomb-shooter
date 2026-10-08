// Simulation clock shared by the engine loop and self-animated renderers.
//
// useGameEngine owns one SimClock. Every animation frame it turns real time
// into simulation time (pause, hit-stop freeze and slow-motion live here, not
// in the engine), steps the engine, then notifies frame listeners so a
// renderer can draw right after the update in the same frame.
// Plain TypeScript: no React, no platform APIs.

export type FrameListener = (realDt: number, simDt: number) => void;

export class SimClock {
  // Multiplier applied to real time (1 = normal, 0.35 = slow motion)
  timeScale = 1;
  // While paused, simulation time does not advance at all
  paused = false;

  private freezeLeft = 0; // seconds of hit-stop still to consume
  private slowLeft = 0; // seconds of real time before timeScale resets to 1
  private readonly listeners = new Set<FrameListener>();

  // Freeze the simulation for `seconds` of real time (hit-stop).
  hitStop(seconds: number) {
    this.freezeLeft = Math.max(this.freezeLeft, seconds);
  }

  // Run at `scale` for `seconds` of real time, then return to normal speed.
  slowMotion(scale: number, seconds: number) {
    this.timeScale = scale;
    this.slowLeft = seconds;
  }

  get frozen() {
    return this.freezeLeft > 0;
  }

  // Real dt -> simulation dt. Consumes hit-stop and slow-motion time.
  advance(realDt: number): number {
    if (this.paused) return 0;
    let dt = realDt;
    if (this.freezeLeft > 0) {
      const used = Math.min(this.freezeLeft, dt);
      this.freezeLeft -= used;
      dt -= used;
    }
    const scaled = dt * this.timeScale;
    if (this.slowLeft > 0) {
      this.slowLeft -= realDt;
      if (this.slowLeft <= 0) this.timeScale = 1;
    }
    return scaled;
  }

  onFrame(cb: FrameListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  emitFrame(realDt: number, simDt: number) {
    this.listeners.forEach((cb) => cb(realDt, simDt));
  }

  reset() {
    this.timeScale = 1;
    this.paused = false;
    this.freezeLeft = 0;
    this.slowLeft = 0;
  }
}
