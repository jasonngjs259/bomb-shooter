// Numbers behind the character's posture (character spec sections 2-3),
// free of bones so they can be checked headless: combat / relaxed stance,
// lean springs (pitch from forward accel + speed, roll from turning +
// lateral accel), the stop settle dip, surge flinch, fire recoil, deflect
// wobble, swap reach, breathing, relaxed fidgets and threat glances.
// Every spring is frame-rate independent (springs.ts).

import { DEG } from "../../../arena/arenaMath";
import { BouncySpring, cdStep, clamp, easeInOutSine, expDamp, SpringState } from "../../../arena/springs";

export interface PostureDrive {
  dt: number;
  t: number;
  speed: number; // w/s
  aF: number; // accel along the legs' forward, w/s^2
  aR: number; // accel along the legs' right
  yawRate: number; // rad/s, + = turning right
  idleTime: number; // s since the last move / turn input
  still: boolean; // reduced motion
  low: boolean; // low quality tier: no breath / fidget / head look
}

const RAISE = 1 / 0.12; // stance re-raise, per s
const RAISE_FIRE = 1 / 0.08;
const LOWER = 1 / 0.4;
const RELAX_AFTER = 2;
const DIP_KICK = 0.04 * 18 * Math.E; // cd spring velocity for a 0.04 w dip (omega 18)

export class PostureState {
  stance = 1; // 1 combat .. 0 relaxed (eased)
  pitch = 0; // hips lean, rad (+ forward)
  roll = 0; // rad (+ towards model right)
  dip = 0; // body height offset, w (negative = down)
  flinch = 0; // 0..~1
  recoil = 0; // 0..1.5
  wobble = 0; // deflect chest yaw, rad
  barrelDip = 0; // deflect, rad
  swapReach = 0; // 0..1 left arm to the canister
  breath = 0; // -1..1
  headYaw = 0; // rad, fidget look-around / threat glance
  shiftX = 0; // weight shift, w
  private stanceP = 1;
  private raiseRate = RAISE;
  private readonly pitchS = new BouncySpring(140, 0.55);
  private readonly rollS = new BouncySpring(140, 0.55);
  private readonly dipS: SpringState = { x: 0, v: 0 };
  private readonly flinchS = new BouncySpring(160, 0.6);
  private readonly recoilS = new BouncySpring(300, 0.5);
  private readonly shiftS = new BouncySpring(140, 0.55);
  private flinchT = 99;
  private recoilT = 99;
  private recoilFrom = 0;
  private recoilAmp = 1;
  private deflectT = 99;
  private swapT = 99;
  private swapCancel = -1; // reach level when fire cancelled the swap
  private cancelT = 99;
  private wasFast = false;
  private fidgetIn = 7;
  private lookT = 99;
  private lookDir = 1;
  private shiftT = 99;
  private shiftDir = 1;
  private glanceT = 99;
  private glanceYaw = 0;

  fire() {
    this.raiseRate = RAISE_FIRE; // the shot is never delayed: the arm catches up
    this.recoilT = 0;
    this.recoilFrom = this.recoil;
    this.recoilAmp = Math.min(1.5, this.recoil + 1); // rapid fire stacks, capped
    if (this.swapT < 0.45) {
      this.swapCancel = this.swapReach;
      this.cancelT = 0;
      this.swapT = 99;
    }
  }
  swap() {
    this.swapT = 0;
    this.swapCancel = -1;
  }
  hit() { this.flinchT = 0; }
  deflect() { this.deflectT = 0; }
  // threat glance: head turns towards yawRel (rad, root space) for 450 ms
  glance(yawRel: number) {
    this.glanceT = 0;
    this.glanceYaw = clamp(yawRel, -70 * DEG, 70 * DEG);
  }

  reset() {
    this.stanceP = this.stance = 1;
    for (const s of [this.pitchS, this.rollS, this.flinchS, this.recoilS, this.shiftS]) s.reset();
    this.dipS.x = this.dipS.v = 0;
    this.flinchT = this.recoilT = this.deflectT = this.swapT = this.cancelT = this.lookT = this.shiftT = this.glanceT = 99;
    this.pitch = this.roll = this.dip = this.flinch = this.recoil = this.wobble = this.barrelDip = this.swapReach = 0;
    this.headYaw = this.shiftX = 0;
    this.swapCancel = -1;
    this.wasFast = false;
  }

  step(d: PostureDrive) {
    const dt = d.dt;
    const s = d.speed;
    // stance: any input (or moving) keeps combat; relax 2 s after the last
    const active = d.idleTime < RELAX_AFTER || s > 0.2 || this.recoilT < RELAX_AFTER;
    if (active) this.stanceP = Math.min(1, this.stanceP + dt * this.raiseRate);
    else {
      this.stanceP = Math.max(0, this.stanceP - dt * LOWER);
      this.raiseRate = RAISE;
    }
    this.stance = easeInOutSine(this.stanceP);

    // lean: forward accel + a steady-run lean, roll into turns
    const lean = d.still ? 0.5 : 1;
    const pitchT = (clamp((d.aF / 24) * 8, -6, 8) + 3 * (s / 3)) * DEG * lean;
    const rollT = (clamp((d.yawRate / DEG) * 0.05 * (0.3 + 0.7 * Math.min(1, s / 3)), -12, 12) + clamp((d.aR / 24) * 6, -6, 6)) * DEG * lean;
    this.pitch = this.pitchS.step(pitchT, dt);
    this.roll = this.rollS.step(rollT, dt);

    // stop settle: from a run to a stop the hips dip and recover
    if (s > 1.5) this.wasFast = true;
    else if (s < 0.2 && this.wasFast) {
      this.wasFast = false;
      this.dipS.v -= DIP_KICK * lean;
    }
    cdStep(this.dipS, 0, 18, dt);
    this.dip = this.dipS.x;

    // surge flinch: in 120 ms, out via the spring (off on reduced motion)
    this.flinchT += dt;
    this.flinch = d.still ? 0 : this.flinchS.step(this.flinchT < 0.12 ? 1 : 0, dt);

    // recoil: 50 ms easeOutQuad attack, spring return
    this.recoilT += dt;
    if (this.recoilT < 0.05) {
      const k = this.recoilT / 0.05;
      this.recoil = this.recoilFrom + (this.recoilAmp - this.recoilFrom) * (1 - (1 - k) * (1 - k));
      this.recoilS.reset(this.recoil);
    } else this.recoil = this.recoilS.step(0, dt);

    // deflect: chest wobble 2 cycles / 300 ms + barrel dip
    this.deflectT += dt;
    const dk = this.deflectT < 0.3 && !d.still ? 1 - this.deflectT / 0.3 : 0;
    this.wobble = Math.sin((this.deflectT / 0.3) * Math.PI * 4) * 4 * DEG * dk;
    this.barrelDip = 5 * DEG * dk;

    // swap: reach 0-110 ms, hold to 330, return by 450; fire fades it in 60
    this.swapT += dt;
    this.cancelT += dt;
    const st = this.swapT;
    let reach = st < 0.11 ? easeInOutSine(st / 0.11) : st < 0.33 ? 1 : st < 0.45 ? 1 - easeInOutSine((st - 0.33) / 0.12) : 0;
    if (this.swapCancel >= 0) reach = Math.max(reach, this.swapCancel * Math.max(0, 1 - this.cancelT / 0.06));
    this.swapReach = reach;

    // idle life (high / mid tier): breathing at 0.25 Hz, relaxed fidgets
    this.breath = d.low ? 0 : Math.sin(d.t * Math.PI * 2 * 0.25);
    this.fidget(d);
    this.glanceT += dt;
    const glance = this.glanceT < 0.45 ? this.glanceYaw : 0;
    const look = this.lookT < 1.2 ? Math.sin((this.lookT / 1.2) * Math.PI) * 25 * DEG * this.lookDir : 0;
    this.headYaw = d.low ? 0 : expDamp(this.headYaw, glance || look, 14, dt);
    this.shiftX = this.shiftS.step(this.shiftT < 0.9 ? 0.03 * this.shiftDir : 0, dt);
  }

  // every 6-10 s of relaxed idle: a look-around or a weight shift
  private fidget(d: PostureDrive) {
    this.lookT += d.dt;
    this.shiftT += d.dt;
    if (this.stance > 0.05 || d.low || d.still) {
      this.fidgetIn = Math.max(this.fidgetIn, 3);
      return;
    }
    this.fidgetIn -= d.dt;
    if (this.fidgetIn > 0) return;
    this.fidgetIn = 6 + Math.random() * 4;
    if (Math.random() < 0.5) {
      this.lookT = 0;
      this.lookDir = Math.random() < 0.5 ? -1 : 1;
    } else {
      this.shiftT = 0;
      this.shiftDir = Math.random() < 0.5 ? -1 : 1;
    }
  }
}
