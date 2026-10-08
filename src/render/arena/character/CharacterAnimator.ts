// Clip layer of the Arena character (character spec sections 2-3), one
// AnimationMixer. Clips are split into a lower body (legs, pelvis) and an
// upper body (the upperRoot bone and its children) copy:
//   lower: idle + walk / run / back / strafe L / strafe R, weights from the
//          8-direction blend, eased at rate 14; the moving loops share one
//          gait phase (time set from it, so feet plant together and never
//          slide) at a playback rate that follows ground speed.
//   upper: aim pose while standing, run-and-gun loop while moving (phase
//          locked to the legs).
// Each group's weights sum to 1 (less would blend towards the bind pose).
// One-shots: shoot and hit are additive upper-body layers; death and win
// are full-body clips that take over with a manual crossfade (so the sums
// stay 1). Procedural posture / aim runs after update() (Posture.ts).

import {
  AdditiveAnimationBlendMode, AnimationAction, AnimationClip, AnimationMixer, AnimationUtils, LoopOnce, LoopRepeat, Object3D,
} from "three";
import { expDamp } from "../../../arena/springs";
import { closeLoop } from "./clipFix";
import { gaitRate, LOWER, LowerRole, LowerWeights, locoTargets, zeroWeights } from "./locomotion";
import { ClipRole, findClip, RigConfig } from "./rig";

export interface AnimInput {
  dt: number;
  speed: number; // ground speed, w/s
  theta: number; // move direction in leg space, rad (0 fwd, +right)
  step: number; // 0..1 turn-in-place step / shuffle (walk weight)
  stepRate: number; // walk playback rate during the step
}

type Mode = "play" | "dead" | "win";
const W_RATE = 9; // weight easing (spec 14; 9 keeps the 90 deg strafe-foot blends under 20 deg / frame)
const OFF = 0.01; // actions below this weight are not sampled
const RUN_UPPER = 0.4; // share of the run-and-gun upper body while moving
const FINGER = /(index|middle|ring|pinky|thumb)\d/i;

export class CharacterAnimator {
  readonly mixer: AnimationMixer;
  readonly w: LowerWeights = zeroWeights(); // smoothed lower weights
  readonly upper = { aim: 1, run: 0 };
  fullW = 0;
  mode: Mode = "play";
  phase = 0; // shared gait phase 0..1 (0 = left foot down)
  private readonly target: LowerWeights = zeroWeights();
  private readonly lower = {} as Record<LowerRole, AnimationAction>;
  private readonly dur = {} as Record<LowerRole, number>;
  private readonly offset = {} as Record<LowerRole, number>;
  private readonly native = {} as Record<LowerRole, number>;
  private readonly aim: AnimationAction;
  private readonly runAim: AnimationAction;
  private readonly runAimDur: number;
  private readonly runAimOffset: number;
  private readonly shoot: AnimationAction | null;
  private readonly hit: AnimationAction | null;
  private readonly death: AnimationAction | null;
  private readonly win: AnimationAction | null;
  private shootT = 99;
  private hitT = 99;
  private hitK = 0;
  private hold = 0; // hit-stop before death
  private fadeDur = 0.25;

  constructor(root: Object3D, clips: AnimationClip[], rig: RigConfig) {
    this.mixer = new AnimationMixer(root);
    const upperBones = new Set<string>();
    root.getObjectByName(rig.upperRoot)?.traverse((o) => upperBones.add(o.name));
    if (upperBones.size === 0) throw new Error(`character: no ${rig.upperRoot} bone`);
    const clip = (role: ClipRole) => findClip(clips, rig.clips[role]);
    const need = (role: ClipRole) => {
      const c = clip(role);
      if (!c) throw new Error(`character: missing clip ${role}`);
      return c;
    };
    // upper / lower copy; `hands: false` drops finger tracks, so layers
    // other than the aim pose can't snap the fingers between grips
    const split = (c: AnimationClip, upper: boolean, hands = true) => {
      const out = c.clone();
      out.tracks = out.tracks.filter((t) => {
        const bone = t.name.slice(0, t.name.lastIndexOf("."));
        return upperBones.has(bone) === upper && (hands || !FINGER.test(bone));
      });
      out.name = `${c.name}@${upper ? "upper" : "lower"}`;
      return out;
    };
    const play = (c: AnimationClip) => {
      const a = this.mixer.clipAction(c);
      a.setLoop(LoopRepeat, Infinity).play();
      a.setEffectiveWeight(0);
      return a;
    };

    const runF = closeLoop(need("runF"));
    for (const role of LOWER) {
      // missing back / strafes fall back to the forward run (still blended)
      const src = role === "idle" ? need("idle") : role === "runF" ? runF : clip(role) ?? runF;
      const c = role === "idle" || src === runF ? src : closeLoop(src);
      this.lower[role] = play(split(c, false));
      this.dur[role] = c.duration;
      this.offset[role] = role === "idle" ? 0 : rig.phaseOffset[role] ?? 0;
      this.native[role] = rig.nativeSpeed[role] ?? 2.9;
      if (role !== "idle") this.lower[role].setEffectiveTimeScale(0); // time driven by the phase
    }
    this.lower.idle.setEffectiveWeight(1);
    const aimClip = clip("aim") ?? need("idle");
    this.aim = play(split(aimClip, true));
    this.aim.setEffectiveWeight(1);
    const runAimSrc = clip("runAim");
    const runAimClip = runAimSrc ? closeLoop(runAimSrc) : runF;
    this.runAim = play(split(runAimClip, true, false));
    this.runAim.setEffectiveTimeScale(0);
    this.runAimDur = runAimClip.duration;
    this.runAimOffset = rig.phaseOffset.runAim ?? 0;

    const additive = (c: AnimationClip | null) => {
      if (!c) return null;
      const add = AnimationUtils.makeClipAdditive(split(c, true, false));
      const a = this.mixer.clipAction(add, undefined, AdditiveAnimationBlendMode);
      a.setLoop(LoopOnce, 1);
      a.clampWhenFinished = false;
      return a;
    };
    this.shoot = additive(clip("shoot"));
    this.hit = additive(clip("hit"));
    const full = (c: AnimationClip | null, loop: boolean) => {
      if (!c) return null;
      const a = this.mixer.clipAction(c);
      if (loop) a.setLoop(LoopRepeat, Infinity);
      else {
        a.setLoop(LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      return a;
    };
    this.death = full(clip("death"), false);
    this.win = full(clip("win"), true);
  }

  get hasDeath() { return this.death !== null; }
  get hasWin() { return this.win !== null; }

  fire() {
    this.shootT = 0;
    this.shoot?.reset().setEffectiveWeight(0).play();
  }

  flinch(k: number) {
    this.hitT = 0;
    this.hitK = k;
    this.hit?.reset().setEffectiveWeight(0).play();
  }

  die() {
    if (this.mode === "dead") return;
    this.mode = "dead";
    this.hold = 0.15; // hit-stop, then a 160 ms crossfade (80 popped the aimed arm > 20 deg / frame)
    this.fadeDur = 0.16;
    this.fullW = 0;
    this.death?.reset().setEffectiveWeight(0).play();
  }

  celebrate() {
    if (this.mode !== "play") return;
    this.mode = "win";
    this.fadeDur = 0.25;
    this.fullW = 0;
    this.win?.reset().setEffectiveWeight(0).play();
  }

  reset() {
    this.mode = "play";
    this.fullW = 0;
    this.hold = 0;
    this.shootT = this.hitT = 99;
    this.death?.stop();
    this.win?.stop();
    this.shoot?.stop();
    this.hit?.stop();
    Object.assign(this.w, zeroWeights());
    this.upper.aim = 1;
    this.upper.run = 0;
  }

  update(i: AnimInput) {
    const dt = i.dt;
    if (this.hold > 0) {
      this.hold -= dt;
      this.mixer.update(0);
      return;
    }
    // lower-body targets: 8-direction blend, or the turn-in-place step
    locoTargets(i.speed, i.theta, this.target);
    if (i.step > 0) {
      const k = i.step * this.target.idle;
      this.target.idle -= k;
      this.target.walkF += k;
    }
    let sum = 0;
    let rate = 0;
    for (const role of LOWER) {
      this.w[role] = expDamp(this.w[role], this.target[role], W_RATE, dt);
      if (role === "idle") continue;
      const r = role === "walkF" && i.step > 0 && i.speed < 0.4 ? i.stepRate : gaitRate(role, i.speed, this.native[role]);
      sum += this.w[role];
      rate += (this.w[role] * r) / this.dur[role];
    }
    if (sum > 1e-4) this.phase = (this.phase + (rate / sum) * dt) % 1;
    // run-and-gun only adds bounce; the aim pose carries the arm
    this.upper.run = expDamp(this.upper.run, RUN_UPPER * (1 - this.target.idle), W_RATE, dt);
    this.upper.aim = 1 - this.upper.run;

    // full-body takeover (manual crossfade keeps every group summing to 1)
    if (this.mode !== "play") this.fullW = Math.min(1, this.fullW + dt / this.fadeDur);
    const keep = 1 - this.fullW;
    for (const role of LOWER) {
      const a = this.lower[role];
      const w = this.w[role] * keep;
      a.enabled = w > OFF;
      a.setEffectiveWeight(w);
      if (role !== "idle") a.time = ((this.phase + this.offset[role]) % 1) * this.dur[role];
    }
    this.setW(this.aim, this.upper.aim * keep);
    this.setW(this.runAim, this.upper.run * keep);
    this.runAim.time = ((this.phase + this.runAimOffset) % 1) * this.runAimDur;
    const full = this.mode === "dead" ? this.death : this.mode === "win" ? this.win : null;
    if (full) this.setW(full, this.fullW);

    // additive one-shots: shoot capped at 0.5 and decaying over 350 ms,
    // hit at the requested strength, out over its clip
    this.shootT += dt;
    this.hitT += dt;
    if (this.shoot) this.setW(this.shoot, this.shootT < 0.35 ? 0.5 * (1 - this.shootT / 0.35) * keep : 0);
    if (this.hit) this.setW(this.hit, this.hitT < 0.5 ? this.hitK * (1 - this.hitT / 0.5) * keep : 0);
    this.mixer.update(dt);
  }

  private setW(a: AnimationAction, w: number) {
    a.enabled = w > OFF;
    a.setEffectiveWeight(w);
  }

  // Per-group sums of the normal (non-additive) blend, for the smoke test.
  sums() {
    const keep = 1 - this.fullW;
    let lower = 0;
    for (const role of LOWER) lower += this.w[role] * keep;
    return { lower: lower + this.fullW, upper: (this.upper.aim + this.upper.run) * keep + this.fullW };
  }

  dispose(root: Object3D) {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(root);
  }
}
