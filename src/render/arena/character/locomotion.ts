// Locomotion blend maths (character spec section 2), pure numbers so the
// headless smoke can check them: an 8-direction constant-power blend from
// the move direction in leg space, an idle -> walk -> run speed tier, and
// one shared gait phase so every loop puts its feet down together.

import { clamp, smoothstep } from "../../../arena/springs";

export const LOWER = ["idle", "walkF", "runF", "back", "strafeL", "strafeR"] as const;
export type LowerRole = (typeof LOWER)[number];
export type LowerWeights = Record<LowerRole, number>;

export const zeroWeights = (): LowerWeights => ({ idle: 1, walkF: 0, runF: 0, back: 0, strafeL: 0, strafeR: 0 });

// s: ground speed (w/s); theta: move direction in leg space (0 = forward,
// +PI/2 = right). Weights sum to 1 (idle + dir^2 terms).
export function locoTargets(s: number, theta: number, out: LowerWeights) {
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  const wF = Math.max(0, c) ** 2;
  const wB = Math.max(0, -c) ** 2;
  const wR = Math.max(0, sn) ** 2;
  const wL = Math.max(0, -sn) ** 2;
  const idle = 1 - smoothstep(0.05, 0.4, s);
  const runT = smoothstep(1.3, 2.1, s);
  const m = 1 - idle;
  out.idle = idle;
  out.walkF = m * wF * (1 - runT);
  out.runF = m * wF * runT;
  out.back = m * wB;
  out.strafeL = m * wL;
  out.strafeR = m * wR;
  return out;
}

// Playback rate that keeps a planted foot still: ground speed / authored
// speed, clamped (the walk -> run tier blend takes over below the clamp).
// Back / strafes only exist at run speed here, so they slow down further
// instead of sliding.
export function gaitRate(role: LowerRole, s: number, nativeSpeed: number) {
  if (role === "idle") return 1;
  const runOnly = role === "back" || role === "strafeL" || role === "strafeR";
  return clamp(s / nativeSpeed, runOnly ? 0.35 : 0.75, role === "back" ? 1.15 : 1.35);
}

// Orientation warp: the legs turn towards the move direction (at most 45
// deg, 60 with hysteresis) so a diagonal plays one pure clip (forward,
// strafe or back) instead of a 50 / 50 blend whose feet slide. `axis` is
// the active clip axis in quarter turns (0 fwd, 1 right, -1 left, 2 back).
// Returns the legs' offset from the aim yaw (rad, + = right).
const Q = Math.PI / 2;
const HYST = (15 * Math.PI) / 180;
const warp = { axis: 0, offset: 0 }; // reused result (per-frame call)
const offAxis = (moveRel: number, k: number) => {
  let d = (moveRel - k * Q) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
};
export function warpAxis(moveRel: number, axis: number): Readonly<typeof warp> {
  let k = axis;
  if (Math.abs(offAxis(moveRel, k)) > Q / 2 + HYST) {
    k = Math.round(moveRel / Q);
    if (k === -2) k = 2;
  }
  warp.axis = k;
  warp.offset = offAxis(moveRel, k);
  return warp;
}
