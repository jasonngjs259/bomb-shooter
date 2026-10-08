// Screen shake: decaying 30Hz noise, amplitude * e^(-t/tau), tau = duration/3.
// Only the board group is offset; the HUD (RN views) never shakes.

import { noise } from "../util";

export class Shake {
  private amp = 0;
  private dur = 0;
  private t = 0;
  private seed = 0;
  readonly offset = { x: 0, y: 0 };

  add(amplitude: number, seconds: number) {
    // Keep the stronger of the running and the new shake
    if (this.t < this.dur && this.currentAmp() > amplitude) return;
    this.amp = amplitude;
    this.dur = seconds;
    this.t = 0;
    this.seed = Math.random() * 1000;
  }

  update(dt: number) {
    if (this.t >= this.dur) {
      this.offset.x = 0;
      this.offset.y = 0;
      return;
    }
    this.t += dt;
    const a = this.currentAmp();
    const f = this.t * 30;
    const i = Math.floor(f);
    const k = f - i;
    // Interpolate between noise samples for a smooth 30Hz wobble
    this.offset.x = a * (noise(this.seed + i) * (1 - k) + noise(this.seed + i + 1) * k);
    this.offset.y = a * (noise(this.seed + 500 + i) * (1 - k) + noise(this.seed + 501 + i) * k);
  }

  clear() {
    this.dur = 0;
    this.t = 0;
    this.offset.x = 0;
    this.offset.y = 0;
  }

  private currentAmp() {
    if (this.t >= this.dur) return 0;
    const tau = this.dur / 3;
    return this.amp * Math.exp(-this.t / tau);
  }
}
