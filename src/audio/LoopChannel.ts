// A looping sound with a volume fader: the music tracks and the roller hum.
// Native: one player with loop = true. Web: MP3 loops are not gapless, so two
// players alternate and crossfade (equal power) over the last overlapMs of
// each pass, which hides the encoder gap at the seam.
// A channel at level 0 with target 0 is paused (no CPU), and resumes where it
// stopped unless restart() was called.

import { PlayerLike, seekStart } from "./types";

// Equal-power crossfade weights for progress w in [0, 1]: [outgoing, incoming].
export function equalPower(w: number): [number, number] {
  const t = Math.min(1, Math.max(0, w)) * (Math.PI / 2);
  return [Math.cos(t), Math.sin(t)];
}

// Linear step of value towards target by at most maxStep.
export function stepToward(value: number, target: number, maxStep: number): number {
  if (value < target) return Math.min(target, value + maxStep);
  if (value > target) return Math.max(target, value - maxStep);
  return value;
}

export interface ChannelCtl {
  allowed: boolean; // unlocked, not suspended, group enabled
  volumeControl: boolean;
  applyVolume: boolean; // throttled volume writes (<= 20 Hz)
}

export class LoopChannel {
  level = 0;
  target = 0;
  gain = 1; // extra multiplier (roller distance)
  running = false;
  private rate = Infinity; // level units per ms
  private cur = 0;
  private segStart = 0;
  private xStart = -1;
  private offset = 0;
  private restartNext = true;
  private readonly lastVol: number[];

  constructor(
    readonly players: PlayerLike[],
    readonly durMs: number,
    readonly baseVol: number,
    readonly overlapMs: number
  ) {
    this.lastVol = players.map(() => -1);
    for (const p of players) p.loop = players.length === 1;
  }

  get masked() {
    return this.players.length > 1;
  }

  fadeTo(target: number, ms: number) {
    if (target === this.target && ms > 0) return;
    this.target = target;
    const d = Math.abs(target - this.level);
    this.rate = ms <= 0 || d === 0 ? Infinity : d / ms;
  }

  // Next start (or now, if running) begins at 0.
  restart() {
    if (this.running) {
      this.halt(0);
      this.restartNext = true;
    } else this.restartNext = true;
  }

  // Needs frame updates: fading, or a masked loop whose seam must be handled.
  busy() {
    return this.level !== this.target || (this.running && this.masked);
  }

  update(now: number, dt: number, out: number, ctl: ChannelCtl) {
    if (this.level !== this.target) this.level = stepToward(this.level, this.target, this.rate * dt);
    if (!ctl.volumeControl) this.level = this.target; // no fades possible (iOS web)
    const want = ctl.allowed && (this.level > 0 || this.target > 0) && this.gain > 0;
    if (want && !this.running) this.start(now, out, ctl.volumeControl);
    else if (!want && this.running) this.halt(now);
    if (!this.running) return;
    if (this.masked) this.stepSeam(now, out, ctl.volumeControl);
    if (ctl.volumeControl && ctl.applyVolume) this.applyVolumes(now, out);
  }

  // Immediate stop (suspend / disable), keeps the position.
  stopNow(now: number) {
    if (this.running) this.halt(now);
  }

  release() {
    for (const p of this.players) p.release();
  }

  private volumeFor(out: number) {
    return Math.min(1, Math.max(0, out * this.level * this.gain * this.baseVol));
  }

  private setVol(i: number, v: number) {
    if (Math.abs(v - this.lastVol[i]) < 0.001) return;
    this.lastVol[i] = v;
    this.players[i].volume = v;
  }

  private applyVolumes(now: number, out: number) {
    const v = this.volumeFor(out);
    if (this.xStart >= 0) {
      const [a, b] = equalPower((now - this.xStart) / this.overlapMs);
      this.setVol(this.cur, v * a);
      this.setVol(1 - this.cur, v * b);
    } else this.setVol(this.cur, v);
  }

  private start(now: number, out: number, volumeControl: boolean) {
    const p = this.players[this.cur];
    if (this.restartNext) {
      seekStart(p);
      this.offset = 0;
      this.restartNext = false;
    }
    if (volumeControl) this.setVol(this.cur, this.volumeFor(out)); // before play: no blast
    p.play();
    this.segStart = now - this.offset;
    this.running = true;
  }

  private halt(now: number) {
    if (this.xStart >= 0) this.finishSeam();
    this.offset = this.masked ? Math.max(0, now - this.segStart) : 0;
    for (const p of this.players) p.pause();
    this.running = false;
  }

  private stepSeam(now: number, out: number, volumeControl: boolean) {
    if (this.xStart < 0) {
      if (now - this.segStart < this.durMs - this.overlapMs) return;
      const next = this.players[1 - this.cur];
      seekStart(next);
      if (volumeControl) this.setVol(1 - this.cur, 0);
      next.play();
      this.xStart = now;
      if (!volumeControl) {
        // no fades: hard switch
        this.finishSeam();
        this.segStart = now;
      }
      return;
    }
    if (now - this.xStart >= this.overlapMs) {
      const start = this.xStart;
      this.finishSeam();
      this.segStart = start;
      if (volumeControl) this.setVol(this.cur, this.volumeFor(out));
    }
  }

  private finishSeam() {
    this.players[this.cur].pause();
    this.cur = 1 - this.cur;
    this.xStart = -1;
  }
}
