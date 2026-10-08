// The Arena player character (character spec): a rigged, animated GLB
// (one skinned draw, neon roles), an arm-cannon on the right hand and a
// next-bomb canister on the upper back. Per frame: legs yaw (turn-in-place
// steps / shuffle; while moving it trails the aim, warped up to 45-60 deg
// towards the move direction so diagonals play one clip), clip blend
// (CharacterAnimator), then posture + aim (Posture). Event hooks: fire,
// swap, flinch (surge), deflect, lose (hit-stop, slide away from the blast,
// death clip, the cannon drops) and win (victory loop).

import { AnimationClip, AnimationMixer, Box3, Color, Group, Object3D, Quaternion, Vector3 } from "three";
import { angleDiff, DEG, wrapAngle } from "../../../arena/arenaMath";
import { cdStep, clamp, easeInOutSine, expDampAngle, smoothstep, SpringState } from "../../../arena/springs";
import type { Avatar, AvatarFrame } from "../avatar";
import { Blaster, Canister } from "./Blaster";
import { rootToBoneLocal } from "./boneOps";
import { AnimInput, CharacterAnimator } from "./CharacterAnimator";
import { warpAxis } from "./locomotion";
import { buildNeonBody, NeonBody } from "./neonBody";
import { AimDrive, Bones, Posture } from "./Posture";
import { PostureDrive, PostureState } from "./postureState";
import { ASTRONAUT, BoneRole, findBone, findClip, RigConfig } from "./rig";

export interface CharacterAsset { scene: Object3D; animations: AnimationClip[] }

const STEP_AT = 45 * DEG; // standing: legs step once the aim is this far off
const STEP_TIME = 0.26;
const MOVE_LAG = 65 * DEG; // max legs-vs-aim offset while moving (twist limit)
const SHUFFLE_RATE = 90 * DEG;
const LEGS_RATE = 400 * DEG; // max legs turn speed while moving, rad/s
const SLIDE = 1.0; // w blown back on lose (spec 1.5 pushed the bigger figure out of the crane shot)
const tmpV = new Vector3();

export class Character implements Avatar {
  readonly group = new Group(); // feet, rotation.y = PI/2 - legs yaw
  readonly holdCur = 0.4;
  readonly holdNext = 0.34;
  readonly animator: CharacterAnimator;
  readonly posture: Posture;
  readonly state = new PostureState();
  readonly body: NeonBody;
  private readonly model = new Group();
  private readonly blaster = new Blaster();
  private readonly canister = new Canister();
  private readonly socket = new Group();
  private readonly hips: Object3D | null;
  private legsYaw = -Math.PI / 2;
  private moveAxis = 0; // warp clip axis (quarter turns)
  private theta = 0;
  private stepT = 99;
  private stepFrom = 0;
  private stepBy = 0;
  private fastTurn = 0; // s with |yawRate| above SHUFFLE_RATE
  private swapAge = 99;
  private losing = -1; // s since lose()
  private readonly slide: SpringState = { x: 0, v: 0 };
  private slideDirX = 0;
  private slideDirZ = 0;
  private winning = false;
  private dropped = false;
  private readonly dropVel = new Vector3();
  private readonly combatMuzzle = new Vector3(0.88, 1.1, 0.12);
  private lastFrame: AvatarFrame | null = null;
  private loseYaw = 0;
  // per-frame inputs, reused (no allocation in update)
  private readonly animIn: AnimInput = { dt: 0, speed: 0, theta: 0, step: 0, stepRate: 1.4 };
  private readonly driveIn: PostureDrive = {
    dt: 0, t: 0, speed: 0, aF: 0, aR: 0, yawRate: 0, idleTime: 0, still: false, low: false,
  };
  private readonly aimIn: AimDrive = { aimErr: 0, aimPoint: new Vector3(), weight: 1, low: false };
  private rearWas = 0;

  constructor(asset: CharacterAsset, rig: RigConfig = ASTRONAUT) {
    const scene = asset.scene;
    this.body = buildNeonBody(scene, rig.materials, rig.inset);
    // scale to the spec height, feet on y = 0 (bind-pose bounds)
    scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(scene, true);
    const h = Math.max(0.1, box.max.y - box.min.y);
    this.model.scale.setScalar(rig.height / h);
    scene.position.y = -box.min.y;
    this.model.add(scene);
    this.group.add(this.model);

    const bones = {} as Bones;
    for (const role of Object.keys(rig.bones) as BoneRole[]) bones[role] = findBone(scene, rig.bones[role]);
    if (!bones.handR || !bones.upperArmR) throw new Error("character: no right arm");
    this.hips = bones.hips ?? bones.body;
    this.animator = new CharacterAnimator(scene, asset.animations, rig);
    this.posture = new Posture(this.model, bones, this.blaster, this.state);

    // calibrate in the aim pose: references + prop sockets
    const pose = new AnimationMixer(scene);
    const aimClip = findClip(asset.animations, rig.clips.aim) ?? findClip(asset.animations, rig.clips.idle);
    if (aimClip) {
      pose.clipAction(aimClip).play();
      pose.update(0.3);
    }
    this.model.updateMatrixWorld(true);
    // cannon: barrel along root +Z at the hand, top up
    const hand = bones.handR.getWorldPosition(new Vector3());
    this.model.worldToLocal(hand);
    rootToBoneLocal(bones.handR, this.model, hand, new Quaternion(), this.socket);
    bones.handR.add(this.socket);
    this.socket.add(this.blaster.group);
    // canister: upper back, opposite the gun arm, tilted 15 deg outward
    const chest = bones.upperChest ?? bones.chest ?? bones.spine;
    if (chest) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -15 * DEG);
      const seat = new Group();
      rootToBoneLocal(chest, this.model, new Vector3(0.14, 1.3, -0.2), q, seat);
      chest.add(seat);
      seat.add(this.canister.group);
    }
    this.posture.calibrate();
    pose.stopAllAction();
    pose.uncacheRoot(scene);
    this.posture.restore(true);
  }

  get cradle() { return this.blaster.cradle; }
  get shoulderSeat() { return this.canister.seat; }
  get swapT() { return this.swapAge; }

  fire() {
    this.animator.fire();
    this.state.fire();
  }
  swap() {
    this.swapAge = 0;
    this.state.swap();
  }
  flinch() {
    this.animator.flinch(0.5);
    this.state.hit();
  }
  deflect() { this.state.deflect(); }
  lose(fromX: number, fromZ: number) {
    if (this.losing >= 0) return;
    this.losing = 0;
    const p = this.group.position;
    const dx = p.x - fromX;
    const dz = p.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.slideDirX = dx / len;
    this.slideDirZ = dz / len;
    this.loseYaw = Math.atan2(-dz, -dx); // turn to face the blast, fall away from it
    this.animator.die();
  }
  win() {
    this.winning = true;
    this.animator.celebrate();
  }
  reset() {
    this.animator.reset();
    this.state.reset();
    this.posture.restore(true);
    this.losing = -1;
    this.winning = false;
    this.slide.x = this.slide.v = 0;
    this.swapAge = this.stepT = 99;
    this.fastTurn = 0;
    if (this.dropped) {
      this.dropped = false;
      this.socket.add(this.blaster.group);
      this.blaster.group.position.set(0, 0, 0);
      this.blaster.group.quaternion.identity();
    }
  }

  setColors(current: Color, next: Color) {
    this.blaster.setGlow(current);
    this.canister.setGlow(next);
  }

  update(f: AvatarFrame) {
    const dt = f.dt;
    this.swapAge += dt;
    const speed = Math.hypot(f.vx, f.vz);
    const playing = this.losing < 0 && !this.winning;
    const a = this.animIn;
    a.step = 0;
    a.stepRate = 1.4;
    if (playing) this.legs(f, speed);
    // move direction in leg space, frozen while nearly stopped
    const ly = this.legsYaw;
    const fx = Math.cos(ly), fz = Math.sin(ly);
    const vf = f.vx * fx + f.vz * fz;
    const vr = -f.vx * fz + f.vz * fx;
    if (speed >= 0.3) this.theta = expDampAngle(this.theta, Math.atan2(vr, vf), 12, dt);

    // placement (+ the lose slide away from the blast)
    if (this.losing >= 0) {
      this.losing += dt;
      // turn (not snap) to face the blast; at most 360 deg/s
      const turn = angleDiff(this.legsYaw, expDampAngle(this.legsYaw, this.loseYaw, 14, dt));
      this.legsYaw = wrapAngle(this.legsYaw + clamp(turn, -2 * Math.PI * dt, 2 * Math.PI * dt));
      cdStep(this.slide, this.losing > 0.15 ? SLIDE : 0, 6, dt);
    }
    this.group.position.set(f.x + this.slideDirX * this.slide.x, 0, f.z + this.slideDirZ * this.slide.x);
    this.group.rotation.y = Math.PI / 2 - this.legsYaw;

    this.posture.restore();
    a.dt = dt;
    a.speed = speed;
    a.theta = this.theta;
    this.animator.update(a);
    this.posture.capture();
    const d = this.driveIn;
    d.dt = dt; d.t = f.t; d.speed = speed; d.aF = f.ax * fx + f.az * fz; d.aR = -f.ax * fz + f.az * fx;
    d.yawRate = playing ? f.yawRate : 0; d.idleTime = f.idleTime; d.still = f.still; d.low = f.low;
    this.state.step(d);
    this.glance(f);
    const p = this.aimIn;
    p.aimErr = angleDiff(this.legsYaw, f.yaw);
    p.aimPoint = f.aim;
    p.weight = 1 - this.animator.fullW;
    p.low = f.low;
    this.posture.apply(p);
    if (this.winning) this.posture.cheer(this.animator.fullW);
    this.trackCombatMuzzle(f);
    this.body.setDanger(this.losing >= 0 ? 1 : Math.min(1, Math.max(0, (f.danger - 0.6) / 0.4)));
    this.body.setRim(!f.low);
    this.body.setVisor(1 - 0.5 * this.state.barrelDip / (5 * DEG));
    this.dropCannon(dt);
  }

  // Legs yaw: trail the aim while moving; standing, step once it is 45 deg
  // off (260 ms, walk weight 0.6) or shuffle while turning fast.
  private legs(f: AvatarFrame, speed: number) {
    const a = this.animIn;
    const dt = f.dt;
    const off = angleDiff(this.legsYaw, f.yaw);
    this.fastTurn = Math.abs(f.yawRate) > SHUFFLE_RATE ? this.fastTurn + dt : 0;
    if (speed >= 0.2) {
      // legs follow the aim, warped towards the move direction
      this.stepT = 99;
      // (weak while starting / stopping, when the velocity direction is
      // still swinging round; the legs turn at most LEGS_RATE)
      const w = warpAxis(angleDiff(f.yaw, Math.atan2(f.vz, f.vx)), this.moveAxis);
      this.moveAxis = w.axis;
      const target = wrapAngle(f.yaw + w.offset * smoothstep(0.3, 1.2, speed));
      const next = expDampAngle(this.legsYaw, target, 18, dt);
      this.legsYaw = wrapAngle(this.legsYaw + clamp(angleDiff(this.legsYaw, next), -LEGS_RATE * dt, LEGS_RATE * dt));
      // the torso twist covers up to 65 deg; only the aim itself may drag
      // the legs (never a warp target jump: that would pop)
      const legsOff = angleDiff(f.yaw, this.legsYaw);
      if (Math.abs(legsOff) > MOVE_LAG) this.legsYaw = wrapAngle(f.yaw + Math.sign(legsOff) * MOVE_LAG);
      return;
    }
    this.moveAxis = 0;
    if (this.fastTurn >= 0.15) {
      this.stepT = 99;
      const trail = wrapAngle(f.yaw - Math.sign(f.yawRate) * 30 * DEG);
      this.legsYaw = expDampAngle(this.legsYaw, trail, 18, dt);
      a.step = 0.5;
      a.stepRate = Math.min(1.3, Math.max(0.6, Math.abs(f.yawRate) / Math.PI));
      return;
    }
    if (this.stepT >= STEP_TIME && Math.abs(off) > STEP_AT) {
      this.stepT = 0;
      this.stepFrom = this.legsYaw;
      this.stepBy = off;
    }
    if (this.stepT < STEP_TIME) {
      this.stepT += dt;
      const k = easeInOutSine(this.stepT / STEP_TIME);
      this.legsYaw = wrapAngle(this.stepFrom + this.stepBy * k);
      a.step = 0.6 * Math.sin(Math.PI * Math.min(1, this.stepT / STEP_TIME));
    }
  }

  // Threat glance when a rear sector's danger crosses 0.7 (not while firing).
  private glance(f: AvatarFrame) {
    if (f.rearDanger >= 0.7 && this.rearWas < 0.7 && this.state.recoil < 0.05) {
      // root yaw convention: + towards model left (+X)
      this.state.glance(-angleDiff(this.legsYaw, f.rearAngle));
    }
    this.rearWas = f.rearDanger;
  }

  // Lose: at 450 ms the cannon detaches and drops (gravity 18, bounce 0.35).
  private dropCannon(dt: number) {
    if (this.losing < 0.45 && !this.dropped) return;
    const g = this.blaster.group;
    if (!this.dropped) {
      this.dropped = true;
      g.updateWorldMatrix(true, false);
      g.getWorldPosition(tmpV);
      const q = g.getWorldQuaternion(new Quaternion());
      this.group.parent?.add(g);
      g.position.copy(tmpV);
      g.quaternion.copy(q);
      g.scale.setScalar(1);
      this.dropVel.set(this.slideDirX * 1.2, 1.5, this.slideDirZ * 1.2);
      return;
    }
    this.dropVel.y -= 18 * dt;
    g.position.addScaledVector(this.dropVel, dt);
    if (g.position.y < 0.09) {
      g.position.y = 0.09;
      this.dropVel.y = Math.abs(this.dropVel.y) * 0.35;
      this.dropVel.x *= 0.6;
      this.dropVel.z *= 0.6;
    }
    g.rotateX(dt * 4 * Math.min(1, this.dropVel.length()));
  }

  // Where the laser starts: the muzzle in combat stance; while the cannon
  // is lowered (relaxed) the last combat muzzle, relative to the aim, so the
  // beam doesn't bend down to the lowered barrel.
  get aimReady() { return this.state.stance; }
  laserStart(out: Vector3) {
    this.posture.muzzle(out);
    const k = 1 - this.state.stance;
    if (k <= 0 || this.losing >= 0) return out;
    const f = this.lastFrame;
    if (!f) return out;
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    const m = this.combatMuzzle;
    const x = f.x + c * m.x - s * m.z;
    const z = f.z + s * m.x + c * m.z;
    return out.set(out.x + (x - out.x) * k, out.y + (m.y - out.y) * k, out.z + (z - out.z) * k);
  }
  // muzzle in aim space (x forward, y up, z right) while in combat stance
  private trackCombatMuzzle(f: AvatarFrame) {
    this.lastFrame = f;
    if (this.state.stance < 0.99 || this.losing >= 0 || this.winning) return;
    const p = this.posture.muzzle(tmpV);
    const dx = p.x - f.x, dz = p.z - f.z;
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    this.combatMuzzle.set(dx * c + dz * s, p.y, -dx * s + dz * c);
  }

  muzzleWorld(out: Vector3) { return this.posture.muzzle(out); }
  barrelWorld(out: Vector3) { return this.posture.barrel(out); }
  shadowXZ(out: Vector3) {
    if (this.hips) this.hips.getWorldPosition(out);
    else out.copy(this.group.position);
    out.y = 0;
    return out;
  }

  dispose() {
    this.animator.dispose(this.model.children[0]);
    this.body.mesh.geometry.dispose();
    this.body.material.dispose();
    this.blaster.dispose();
    this.canister.dispose();
    this.blaster.group.removeFromParent();
  }
}
