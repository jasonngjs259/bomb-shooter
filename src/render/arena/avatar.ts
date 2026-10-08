// What ArenaWorld / ArenaFx / ArenaBombs need from the player figure: the
// animated character (character/Character.ts) or the primitive stickman
// fallback (Stickman.ts) when the model can't load.

import type { Color, Object3D, Vector3 } from "three";

export interface AvatarFrame {
  dt: number; // sim seconds (0 while paused / hit-stop)
  t: number; // real seconds (idle life)
  x: number; // engine feet position + aim yaw
  z: number;
  yaw: number;
  vx: number; // engine velocity / acceleration (world, w/s, w/s^2)
  vz: number;
  ax: number;
  az: number;
  maxSpeed: number;
  yawRate: number; // rad/s, + = turning right
  aim: Vector3; // world point the barrel points at (end of laser segment A)
  idleTime: number; // s since the last move / turn input
  danger: number; // 0..1 engine danger
  rearDanger: number; // max danger in the rear 120 deg
  rearAngle: number; // world angle of that rear threat
  low: boolean; // low quality tier
  still: boolean; // reduced motion
}

export interface Avatar {
  readonly group: Object3D;
  readonly cradle: Object3D; // current bomb seat (muzzle)
  readonly shoulderSeat: Object3D; // next bomb seat
  readonly holdCur: number; // bomb scales at those seats
  readonly holdNext: number;
  readonly swapT: number; // s since the last swap
  fire(): void;
  swap(): void;
  flinch(): void; // creep surge
  deflect(): void;
  lose(fromX: number, fromZ: number): void;
  win(): void;
  reset(): void;
  setColors(current: Color, next: Color): void;
  update(f: AvatarFrame): void;
  readonly aimReady: number; // 0 relaxed (cannon lowered) .. 1 combat
  laserStart(out: Vector3): Vector3; // aim laser origin (muzzle, or the combat muzzle while relaxed)
  muzzleWorld(out: Vector3): Vector3;
  barrelWorld(out: Vector3): Vector3; // unit barrel axis
  shadowXZ(out: Vector3): Vector3; // blob shadow centre (hips)
  dispose(): void;
}
