// Auto quality tier (spec section 10): if the average frame time over the
// first 120 gameplay frames is above 20ms, drop to "low" for the session.

export type FxQuality = "high" | "low";

const SAMPLE_FRAMES = 120;
const LOW_THRESHOLD = 0.02;

export class QualityMonitor {
  quality: FxQuality = "high";
  private samples = 0;
  private total = 0;
  private decided = false;

  get low() {
    return this.quality === "low";
  }

  // Feed real frame times while the game is being played
  sample(realDt: number, playing: boolean) {
    if (this.decided || !playing) return;
    // Ignore hitches (tab switches, GC) that say nothing about steady fps
    if (realDt <= 0 || realDt > 0.1) return;
    this.total += realDt;
    this.samples++;
    if (this.samples >= SAMPLE_FRAMES) {
      this.decided = true;
      if (this.total / this.samples > LOW_THRESHOLD) this.quality = "low";
    }
  }
}
