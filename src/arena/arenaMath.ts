// Pure Arena 360 maths shared by the renderer, controls and the headless
// check (scripts/arena-controls.ts). No three.js / React imports.
//
// Conventions (engine): ground plane (x, z), y up. yaw is radians from +x
// towards +z; facing F = (cos yaw, sin yaw). Camera-right R = F x up =
// (-sin yaw, cos yaw). Models are built facing +Z, so their three.js
// rotation.y = PI/2 - yaw.

export interface XZ { x: number; z: number }
export interface V3 { x: number; y: number; z: number }

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const wrapAngle = (a: number) => {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  if (r > Math.PI) r -= TAU;
  return r;
};
// Shortest signed difference b - a in (-PI, PI].
export const angleDiff = (a: number, b: number) => wrapAngle(b - a);

export const facing = (yaw: number): XZ => ({ x: Math.cos(yaw), z: Math.sin(yaw) });
export const rightOf = (yaw: number): XZ => ({ x: -Math.sin(yaw), z: Math.cos(yaw) });

// Model forward is +Z: rotation about Y that turns +Z onto the facing.
export const modelRotationY = (yaw: number) => Math.PI / 2 - yaw;
// Applying a three.js Y rotation to a local (x, z) vector.
export const rotateY = (v: XZ, ry: number): XZ => ({
  x: v.x * Math.cos(ry) + v.z * Math.sin(ry),
  z: -v.x * Math.sin(ry) + v.z * Math.cos(ry),
});

// Camera-relative input (strafe = right +, forward = ahead +) -> world move
// vector for ArenaEngine.setMoveInput, clamped to length 1.
export function cameraRelativeMove(strafe: number, forward: number, cameraYaw: number): XZ {
  const f = facing(cameraYaw);
  const r = rightOf(cameraYaw);
  let x = f.x * forward + r.x * strafe;
  let z = f.z * forward + r.z * strafe;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  return { x, z };
}

// Virtual joystick response: 12% dead zone, then ((m - 0.12) / 0.88)^1.4.
export function stickCurve(dx: number, dy: number, maxTravel: number): { strafe: number; forward: number } {
  const m = Math.min(1, Math.hypot(dx, dy) / maxTravel);
  if (m <= 0.12) return { strafe: 0, forward: 0 };
  const out = Math.pow((m - 0.12) / 0.88, 1.4);
  const len = Math.hypot(dx, dy);
  return { strafe: (dx / len) * out, forward: (-dy / len) * out }; // screen y down = backwards
}

export interface RigParams { dist: number; height: number; lookAhead: number }
export const RIG_LANDSCAPE: RigParams = { dist: 4.8, height: 3.4, lookAhead: 3.5 };
export const RIG_PORTRAIT: RigParams = { dist: 6.2, height: 4.6, lookAhead: 4.5 };
export const RIG_DANGER = { dist: 1.6, height: 1.4, fov: 5 };

// Over-the-right-shoulder chase pose for feet position p and camera yaw.
export function chasePose(p: XZ, yaw: number, rig: RigParams): { pos: V3; target: V3 } {
  const f = facing(yaw);
  const r = rightOf(yaw);
  return {
    pos: { x: p.x - f.x * rig.dist + r.x * 0.55, y: rig.height, z: p.z - f.z * rig.dist + r.z * 0.55 },
    target: { x: p.x + f.x * rig.lookAhead, y: 1.1, z: p.z + f.z * rig.lookAhead },
  };
}

// Horizontal-locked FOV: 78 deg horizontal, vertical clamped 45..72 deg.
export const vFovFor = (aspect: number, hFovDeg = 78) =>
  Math.min(72, Math.max(45, (2 * Math.atan(Math.tan((hFovDeg * DEG) / 2) / Math.max(0.1, aspect))) / DEG));

export const hFovFor = (vFovDeg: number, aspect: number) =>
  (2 * Math.atan(Math.tan((vFovDeg * DEG) / 2) * aspect)) / DEG;

// Frame-rate independent smoothing factor.
export const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

// Danger sector index (16 sectors from +x towards +z) and its centre angle.
export const sectorCentre = (i: number, n = 16) => ((i + 0.5) / n) * TAU;
export const sectorOf = (angle: number, n = 16) => {
  const a = ((angle % TAU) + TAU) % TAU;
  return Math.min(n - 1, Math.floor((a / TAU) * n));
};

// Most dangerous sector's centre angle, or null if none reaches `min`.
export function biggestThreat(danger: readonly number[], min = 0.5): number | null {
  let best = -1;
  let bestD = min;
  for (let i = 0; i < danger.length; i++) {
    if (danger[i] >= bestD) {
      bestD = danger[i];
      best = i;
    }
  }
  return best < 0 ? null : sectorCentre(best, danger.length);
}
