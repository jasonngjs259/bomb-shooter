// Procedural pass on top of the clips (character spec sections 2-4), run
// after mixer.update every frame, in order:
//   body offset (stop dip, combat crouch, flinch, weight shift) + 2-bone leg
//   IK so the feet stay planted; hips lean (pitch / roll); spine twist that
//   turns the chest onto the aim (whatever the legs' clip did to the
//   pelvis, e.g. strafes turn it 90 deg) spread 30/45/25 over the spine;
//   breathing; chest + upper-arm pitch to the aim; head look; then a CCD
//   pass on the upper arm and the hand so the barrel lies on the laser's
//   first segment; finally the swap reach and the fire recoil.
// Bones the passes touch are restored to rest before each mixer update, so
// nothing accumulates when a clip doesn't key them.

import { Object3D, Quaternion, Vector3 } from "three";
import { DEG, wrapAngle } from "../../../arena/arenaMath";
import { clamp } from "../../../arena/springs";
import type { Blaster } from "./Blaster";
import { aimBone, boneYawRoot, localDirOf, rotateBoneRoot, translateBoneRoot, twoBoneIK } from "./boneOps";
import type { PostureState } from "./postureState";
import type { BoneRole } from "./rig";

export type Bones = Record<BoneRole, Object3D | null>;

export interface AimDrive {
  aimErr: number; // wrap(aim yaw - legs yaw), rad; + = aim to the right
  aimPoint: Vector3; // world point the barrel should point at
  weight: number; // procedural weight (0 during death / win)
  low: boolean; // one CCD pass, no head look
}

const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, 1);
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);
const SPINE_SHARE = [0.3, 0.45, 0.25];
const CCD_MAX = 20 * DEG;
const RELAX_DROP = 35 * DEG;

export class Posture {
  private readonly rest: { bone: Object3D; q: Quaternion; p: Vector3 }[] = [];
  private readonly spine: Object3D[];
  private readonly chestFwd = new Vector3(); // chest-local dir = root forward at the aim pose
  private readonly tipL = new Vector3(); // ankle in lower-leg space
  private readonly tipR = new Vector3();
  private readonly footL = new Vector3();
  private readonly footR = new Vector3();
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly q1 = new Quaternion();
  private readonly axis = new Vector3();
  aimPitch = 0; // last aim pitch (rad, + up), for the smoke
  barrelError = 0; // rad, barrel vs laser segment A after the passes

  constructor(private readonly model: Object3D, private readonly b: Bones, private readonly blaster: Blaster, readonly state: PostureState) {
    const keep = (o: Object3D | null) => {
      if (o) this.rest.push({ bone: o, q: o.quaternion.clone(), p: o.position.clone() });
    };
    for (const role of Object.keys(b) as BoneRole[]) if (role !== "footL" && role !== "footR") keep(b[role]);
    this.spine = [b.spine, b.chest, b.upperChest].filter((o): o is Object3D => o !== null);
  }

  // Measure references with the skeleton in the aim pose (called once).
  calibrate() {
    this.model.updateMatrixWorld(true);
    const chest = this.spine[this.spine.length - 1];
    if (chest) localDirOf(chest, this.model, FWD, this.chestFwd);
    const tip = (lower: Object3D | null, foot: Object3D | null, out: Vector3) => {
      if (lower && foot) lower.worldToLocal(foot.getWorldPosition(out));
    };
    tip(this.b.lowerLegL, this.b.footL, this.tipL);
    tip(this.b.lowerLegR, this.b.footR, this.tipR);
  }

  restore() {
    for (const r of this.rest) {
      r.bone.quaternion.copy(r.q);
      r.bone.position.copy(r.p);
    }
  }

  muzzle(out: Vector3) {
    return this.blaster.muzzleTip.getWorldPosition(out);
  }
  barrel(out: Vector3) {
    this.blaster.group.getWorldQuaternion(this.q1);
    return out.copy(FWD).applyQuaternion(this.q1);
  }

  apply(d: AimDrive) {
    const s = this.state;
    const w = d.weight;
    const m = this.model;
    const b = this.b;
    m.updateMatrixWorld(true);
    if (w <= 0) {
      this.barrelError = 0;
      return;
    }

    // body offset + leg IK (feet bones are separate, so they stay put)
    const dy = (s.dip - 0.012 * s.stance - 0.05 * s.flinch) * w;
    const dx = s.shiftX * w;
    if (b.body && (Math.abs(dy) > 1e-4 || Math.abs(dx) > 1e-4)) {
      if (b.footL) b.footL.getWorldPosition(this.footL);
      if (b.footR) b.footR.getWorldPosition(this.footR);
      translateBoneRoot(b.body, m, dx, dy, 0);
      b.body.updateMatrixWorld(true);
      if (b.upperLegL && b.lowerLegL && b.footL) twoBoneIK(b.upperLegL, b.lowerLegL, this.tipL, this.footL);
      if (b.upperLegR && b.lowerLegR && b.footR) twoBoneIK(b.upperLegR, b.lowerLegR, this.tipR, this.footR);
    }

    // hips lean (upper body pivots at the pelvis)
    if (b.hips) {
      rotateBoneRoot(b.hips, m, X, s.pitch * w);
      rotateBoneRoot(b.hips, m, Z, s.roll * w);
      b.hips.updateMatrixWorld(true);
    }

    // spine twist: put the chest on the aim yaw (counter-rotates strafes)
    const chest = this.spine[this.spine.length - 1];
    const aimErr = clamp(d.aimErr, -65 * DEG, 65 * DEG) + s.wobble;
    if (chest) {
      // root yaw is + towards +X (model left), aimErr is + to the right
      const delta = wrapAngle(-aimErr - boneYawRoot(chest, m, this.chestFwd)) * w;
      this.spine.forEach((bone, i) => {
        rotateBoneRoot(bone, m, UP, delta * (this.spine.length === 3 ? SPINE_SHARE[i] : 1 / this.spine.length));
        bone.updateMatrixWorld(true);
      });
    }

    // aim pitch: from the muzzle to the aim point
    // root-space axis about which +angle pitches the aim direction down
    const aimRight = this.axis.set(Math.cos(aimErr), 0, Math.sin(aimErr));
    this.muzzle(this.v1);
    this.v2.subVectors(d.aimPoint, this.v1).normalize();
    m.getWorldQuaternion(this.q1).invert();
    const pitch = Math.asin(clamp(this.v3.copy(this.v2).applyQuaternion(this.q1).y, -1, 1));
    this.aimPitch = pitch;
    const flinchBack = 6 * DEG * s.flinch;
    if (chest) {
      const breath = 1.2 * DEG * s.breath;
      rotateBoneRoot(chest, m, aimRight, (clamp(-pitch * 0.6, -20 * DEG, 15 * DEG) + breath - flinchBack - 3 * DEG * s.recoil) * w);
      chest.updateMatrixWorld(true);
    }
    // shoulders: breathing shrug, dropped when relaxed
    const shrug = (1.5 * s.breath - 4 * (1 - s.stance)) * DEG * w;
    if (b.shoulderL) rotateBoneRoot(b.shoulderL, m, Z, shrug);
    if (b.shoulderR) rotateBoneRoot(b.shoulderR, m, Z, -shrug);
    // head: aim pitch share, flinch duck, look-around / threat glance
    if (!d.low && b.head) {
      const yaw = s.headYaw * w;
      if (b.neck) rotateBoneRoot(b.neck, m, UP, yaw * 0.4);
      rotateBoneRoot(b.head, m, UP, yaw * 0.6);
      rotateBoneRoot(b.head, m, aimRight, (clamp(-pitch * 0.4, -30 * DEG, 30 * DEG) + 8 * DEG * s.flinch) * w);
    }

    // right arm: upper-arm pitch share, then CCD onto the laser direction
    // (lowered 35 deg in the relaxed stance; dipped on a deflect)
    const arm = b.upperArmR;
    if (arm) {
      rotateBoneRoot(arm, m, aimRight, clamp(-pitch * 0.4, -25 * DEG, 20 * DEG) * w);
      arm.updateMatrixWorld(true);
      const drop = RELAX_DROP * (1 - s.stance) + s.barrelDip;
      this.ccd(arm, d.aimPoint, drop, w);
      if (!d.low && b.handR) this.ccd(b.handR, d.aimPoint, drop, w);
      this.barrelError = this.errorTo(d.aimPoint, drop);
    }

    // swap: left arm reaches back over the shoulder to the canister
    if (b.upperArmL && s.swapReach > 0) {
      rotateBoneRoot(b.upperArmL, m, X, 65 * DEG * s.swapReach * w);
      rotateBoneRoot(b.upperArmL, m, Z, 15 * DEG * s.swapReach * w);
    }

    // recoil after the aim: arm kicks up 8 deg, barrel slides back 0.06
    if (arm && s.recoil > 0.001) {
      rotateBoneRoot(arm, m, aimRight, -8 * DEG * s.recoil * w);
      arm.updateMatrixWorld(true);
    }
    this.blaster.slide.position.z = -0.06 * s.recoil * w;
  }

  // Win: swing the cannon arm up (skyward, a little forward and out), k 0..1.
  cheer(k: number) {
    const arm = this.b.upperArmR;
    if (!arm || k <= 0) return;
    this.model.updateMatrixWorld(true);
    this.model.getWorldQuaternion(this.q1);
    this.v2.set(-0.3, 1, 0.3).normalize().applyQuaternion(this.q1);
    aimBone(arm, this.barrel(this.v1), this.v2, Math.PI, k);
    arm.updateMatrixWorld(true);
    if (this.b.handR) {
      aimBone(this.b.handR, this.barrel(this.v1), this.v2, CCD_MAX, k);
      this.b.handR.updateMatrixWorld(true);
    }
  }

  // Desired barrel direction (world): towards the aim point, rotated down.
  private desired(aim: Vector3, drop: number, out: Vector3) {
    this.muzzle(this.v3);
    out.subVectors(aim, this.v3).normalize();
    if (drop > 1e-4) {
      this.v3.set(-out.z, 0, out.x).normalize(); // horizontal right of the aim
      out.applyAxisAngle(this.v3, -drop);
    }
    return out;
  }

  private ccd(bone: Object3D, aim: Vector3, drop: number, w: number) {
    this.desired(aim, drop, this.v2);
    aimBone(bone, this.barrel(this.v1), this.v2, CCD_MAX, w);
    bone.updateMatrixWorld(true);
  }

  private errorTo(aim: Vector3, drop: number) {
    this.desired(aim, drop, this.v2);
    return this.barrel(this.v1).angleTo(this.v2);
  }
}
