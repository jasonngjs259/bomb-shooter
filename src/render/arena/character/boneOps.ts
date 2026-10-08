// Allocation-free bone helpers for the procedural passes. "Root space" is
// the character model's own frame (x left, y up, z forward, metres); bones
// live under a scaled / rotated armature, so every delta is converted
// through the parent's world rotation.

import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

const qa = new Quaternion();
const qb = new Quaternion();
const qc = new Quaternion();
const va = new Vector3();
const vb = new Vector3();
const vc = new Vector3();
const vd = new Vector3();
const ma = new Matrix4();
const qw1 = new Quaternion(); // rotateBoneWorld only (callers pass qa..qc)
const qw2 = new Quaternion();

// Premultiply a WORLD-space rotation onto a bone (keeps its pivot).
export function rotateBoneWorld(bone: Object3D, qWorld: Quaternion) {
  const parent = bone.parent;
  if (!parent) {
    bone.quaternion.premultiply(qWorld);
    return;
  }
  parent.getWorldQuaternion(qw1);
  qw2.copy(qw1).invert().multiply(qWorld).multiply(qw1); // parent^-1 * q * parent
  bone.quaternion.premultiply(qw2);
}

// Rotate a bone about an axis given in root space (model frame).
export function rotateBoneRoot(bone: Object3D, root: Object3D, axis: Vector3, angle: number) {
  if (angle === 0) return;
  root.getWorldQuaternion(qc);
  va.copy(axis).applyQuaternion(qc);
  rotateBoneWorld(bone, qb.setFromAxisAngle(va, angle));
}

// Bone yaw around root up, from a bone-local direction (root space).
export function boneYawRoot(bone: Object3D, root: Object3D, localDir: Vector3) {
  bone.getWorldQuaternion(qa);
  root.getWorldQuaternion(qb).invert();
  va.copy(localDir).applyQuaternion(qa).applyQuaternion(qb);
  return Math.atan2(va.x, va.z);
}

// Bone-local direction that maps to root `dirRoot` in the current pose.
export function localDirOf(bone: Object3D, root: Object3D, dirRoot: Vector3, out: Vector3) {
  root.getWorldQuaternion(qa);
  bone.getWorldQuaternion(qb).invert();
  return out.copy(dirRoot).applyQuaternion(qa).applyQuaternion(qb);
}

// Rotate `bone` so the world direction `from` turns towards `to`, at most
// maxAngle (rad). Returns the remaining angle.
export function aimBone(bone: Object3D, from: Vector3, to: Vector3, maxAngle: number, weight = 1) {
  const angle = from.angleTo(to);
  if (angle < 1e-5 || weight <= 0) return angle;
  qb.setFromUnitVectors(from, to);
  const k = Math.min(1, maxAngle / angle) * weight;
  if (k < 1) qc.identity().slerp(qb, k);
  else qc.copy(qb);
  rotateBoneWorld(bone, qc);
  return angle * (1 - k);
}

// Move a bone by a root-space offset (metres).
export function translateBoneRoot(bone: Object3D, root: Object3D, dx: number, dy: number, dz: number) {
  if ((dx === 0 && dy === 0 && dz === 0) || !bone.parent) return;
  bone.getWorldPosition(va);
  root.getWorldQuaternion(qa);
  vb.set(dx, dy, dz).applyQuaternion(qa);
  root.getWorldScale(vc);
  va.addScaledVector(vb, vc.x);
  bone.parent.updateWorldMatrix(true, false);
  bone.position.copy(bone.parent.worldToLocal(va));
}

// Two-bone IK (hip -> knee -> ankle): bend the knee in the plane it already
// bends in so the lower bone's tip reaches `target` (world). `tipLocal` is
// the ankle in the lower bone's local space.
export function twoBoneIK(upper: Object3D, lower: Object3D, tipLocal: Vector3, target: Vector3) {
  upper.updateWorldMatrix(true, true);
  const hip = upper.getWorldPosition(va);
  const knee = lower.getWorldPosition(vb);
  const tip = vc.copy(tipLocal).applyMatrix4(lower.matrixWorld);
  const a = hip.distanceTo(knee);
  const b = knee.distanceTo(tip);
  const want = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, hip.distanceTo(target)));
  // knee angle now vs needed (law of cosines on the hip-knee-ankle triangle)
  const cur = Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - hip.distanceToSquared(tip)) / (2 * a * b))));
  const need = Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - want * want) / (2 * a * b))));
  vd.subVectors(knee, hip).cross(vc.sub(knee)); // bend axis
  if (vd.lengthSq() > 1e-12) {
    vd.normalize();
    rotateBoneWorld(lower, qa.setFromAxisAngle(vd, cur - need));
    lower.updateWorldMatrix(false, true);
  }
  // swing the whole leg so the tip points at the target
  const tip2 = vc.copy(tipLocal).applyMatrix4(lower.matrixWorld).sub(hip).normalize();
  vd.subVectors(target, hip).normalize();
  rotateBoneWorld(upper, qa.setFromUnitVectors(tip2, vd));
  upper.updateWorldMatrix(false, true);
}

// World matrix of a root-space pose (for attaching props at load time).
export function rootToBoneLocal(bone: Object3D, root: Object3D, pos: Vector3, quat: Quaternion, obj: Object3D) {
  root.updateWorldMatrix(true, true);
  ma.compose(pos, quat, vd.set(1, 1, 1)).premultiply(root.matrixWorld);
  ma.premultiply(qMat.copy(bone.matrixWorld).invert());
  ma.decompose(obj.position, obj.quaternion, obj.scale);
}
const qMat = new Matrix4();
