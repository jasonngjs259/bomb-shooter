// Procedural pose for the Runner (spec section 1 table), as plain numbers
// (radians / world units) so it stays testable and allocation-light.
// Rotation signs (three.js, model faces +Z): a limb hanging along -Y swings
// FORWARD with a negative X rotation; the torso (along +Y) leans forward with
// a positive X rotation; a positive Z roll leans towards model-right (-X).

import { DEG } from "../../arena/arenaMath";
import { clamp01, easeOutBack, easeOutQuad } from "../three/world/easing";

export interface PoseInput {
  t: number; dt: number;
  speed: number; // 0..1 of max speed
  forwardness: number; // velocity along facing, -1 (backpedal) .. 1
  yawRate: number; // rad/s
  recoil: number; swap: number; // seconds since fire / swap
  lose: number; win: number; // seconds since lose / win, -1 = not active
  loseDirX: number; loseDirZ: number;
}

export interface StickPose {
  phase: number; rollS: number; // persistent: walk phase, smoothed roll
  bob: number; pitch: number; roll: number;
  hipL: number; hipR: number; kneeL: number; kneeR: number;
  torso: number; head: number;
  shL: number; shLz: number; elL: number;
  shR: number; shRz: number; elR: number;
  kick: number; // launcher recoil (w, towards the shoulder)
}

const AIM_SH = -62 * DEG; // launcher arm: upper arm forward-down...
const AIM_EL = -28 * DEG; // ...forearm level, pointing ahead

export function poseFor(i: PoseInput, prev?: StickPose): StickPose {
  const s = clamp01(i.speed);
  let phase = prev?.phase ?? 0;
  if (s > 0.05) {
    const f = Math.min(2.2, Math.max(0.6, 1.8 * s));
    phase += Math.PI * 2 * f * i.dt * (i.forwardness < -0.3 ? -1 : 1);
  }
  const rollTarget = Math.max(-10 * DEG, Math.min(10 * DEG, (i.yawRate / DEG) * 0.04 * DEG));
  const rollS = (prev?.rollS ?? 0) + (rollTarget - (prev?.rollS ?? 0)) * (1 - Math.exp(-10 * i.dt));
  const sn = Math.sin(phase);
  const breath = Math.sin((i.t / 2.5) * Math.PI * 2);

  // recoil curve: 0 -> 1 in 60 ms, back in 180 ms (easeOutBack)
  const rt = i.recoil;
  const rk = rt < 0.06 ? easeOutQuad(rt / 0.06) : 1 - easeOutBack(clamp01((rt - 0.06) / 0.18));
  // swap toss: left hand up 40 deg in 120 ms, down over 220 ms
  const st = i.swap;
  const toss = st < 0.12 ? st / 0.12 : st < 0.34 ? 1 - (st - 0.12) / 0.22 : 0;

  // shuffle step when turning in place fast
  const shuffle = s < 0.1 && Math.abs(i.yawRate) > 60 * DEG ? Math.sin(i.t * Math.PI * 2 * 2.4) * 10 * DEG : 0;

  const p: StickPose = {
    phase, rollS,
    bob: Math.abs(sn) * 0.05 * s + breath * 0.015,
    pitch: 0,
    roll: rollS,
    hipL: -sn * 28 * DEG * s + shuffle,
    hipR: sn * 28 * DEG * s - shuffle,
    kneeL: Math.max(0, Math.sin(phase + Math.PI / 2)) * 45 * DEG * s,
    kneeR: Math.max(0, Math.sin(phase + Math.PI / 2 + Math.PI)) * 45 * DEG * s,
    torso: 6 * DEG * s * Math.sign(i.forwardness || 1) - 5 * DEG * rk,
    head: Math.sin((i.t + 0.2) / 2.5 * Math.PI * 2) * 2 * DEG,
    shL: sn * 22 * DEG * s + breath * 3 * DEG - toss * 40 * DEG,
    shLz: 6 * DEG,
    elL: -12 * DEG - toss * 50 * DEG,
    shR: AIM_SH + sn * 4 * DEG * s,
    shRz: -4 * DEG,
    elR: AIM_EL,
    kick: 0.12 * rk,
  };

  if (i.win >= 0) {
    const w = i.win;
    const hop = w < 0.8 ? Math.abs(Math.sin((w / 0.4) * Math.PI)) * 0.25 : 0;
    const pump = w >= 0.8 ? Math.sin((w - 0.8) * Math.PI * 2 * 1.2) * 20 * DEG : 0;
    p.bob += hop;
    p.shL = -150 * DEG + pump;
    p.shLz = 25 * DEG;
    p.elL = 0;
    p.shR = -150 * DEG + pump;
    p.shRz = -25 * DEG;
    p.elR = 0;
    p.kick = 0;
    p.hipL = p.hipR = p.kneeL = p.kneeR = 0;
  }
  if (i.lose >= 0) {
    const k = easeOutQuad(clamp01(i.lose / 0.45));
    p.pitch = -80 * DEG * k;
    p.shL = p.shR = -120 * DEG * k + Math.sin(i.t * 30) * 15 * DEG * k;
    p.elL = p.elR = 0;
    p.hipL = p.hipR = p.kneeL = p.kneeR = 0;
    p.bob = 0;
    p.kick = 0;
  }
  return p;
}
