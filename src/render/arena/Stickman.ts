// The Runner (spec section 1): a white-hot neon stick figure built from
// primitives with Group pivots (FK, no skeleton). Draw calls: limbs (10
// instanced unit cylinders), joints (11 instanced spheres), their two
// additive back-face halo shells, head, visor, launcher, muzzle ring = 8
// (6 on low quality: no halos). Model faces +Z; model right is -X, so the
// launcher (right forearm) sits at -X and the next bomb over the left
// shoulder at +X. Procedural states: idle breath, walk/backpedal, turn lean,
// fire recoil, swap toss, lose (blown back) and win (V + hops + pumps).
// Since the animated character (character/Character.ts) it is the fallback
// avatar: shown while the model loads and if it can't load or skin.

import {
  AdditiveBlending, BackSide, Color, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, SphereGeometry, TorusGeometry, Vector3,
} from "three";
import { DEG, modelRotationY } from "../../arena/arenaMath";
import type { Avatar, AvatarFrame } from "./avatar";
import { HEX } from "../three/palette";
import { clamp01, easeOutQuad } from "../three/world/easing";
import { PoseInput, poseFor, StickPose } from "./stickPose";

const LIMBS = 10;
const JOINTS = 11;
const HALO = 2.4;

export class Stickman implements Avatar {
  readonly group = new Group(); // world-space root (feet)
  readonly holdCur = 0.55; // current bomb scale in the launcher
  readonly holdNext = 0.45; // next bomb scale at the left shoulder
  readonly muzzle = new Object3D(); // launcher tip
  readonly cradle = new Object3D(); // current bomb seat on the launcher
  readonly shoulderSeat = new Object3D(); // next bomb over the left shoulder
  private readonly body = new Group();
  private readonly limbs: InstancedMesh;
  private readonly joints: InstancedMesh;
  private readonly limbHalo: InstancedMesh;
  private readonly jointHalo: InstancedMesh;
  private readonly limbMarks: Object3D[] = [];
  private readonly jointMarks: Object3D[] = [];
  private readonly pivots: Record<string, Object3D> = {};
  private readonly launcher: Mesh;
  private readonly ring: Mesh;
  private readonly ringMat: MeshBasicMaterial;
  private readonly disposables: { dispose: () => void }[] = [];
  private readonly m = new Matrix4();
  private readonly h = new Matrix4();
  private readonly v = new Vector3();
  private readonly inp: PoseInput = {
    t: 0, dt: 0, speed: 0, forwardness: 1, yawRate: 0, recoil: 99, swap: 99, lose: -1, win: -1, loseDirX: 0, loseDirZ: 1,
  };
  private pose: StickPose;
  private slideX = 0;
  private slideZ = 0;

  constructor() {
    const core = new MeshBasicMaterial({ color: HEX.star, toneMapped: false });
    const halo = new MeshBasicMaterial({
      color: HEX.cyan, transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false, side: BackSide, toneMapped: false,
    });
    const cyl = new CylinderGeometry(1, 1, 1, 8);
    const sph = new SphereGeometry(1, 10, 8);
    this.limbs = new InstancedMesh(cyl, core, LIMBS);
    this.joints = new InstancedMesh(sph, core, JOINTS);
    this.limbHalo = new InstancedMesh(cyl, halo, LIMBS);
    this.jointHalo = new InstancedMesh(sph, halo, JOINTS);
    for (const im of [this.limbs, this.joints, this.limbHalo, this.jointHalo]) im.frustumCulled = false;
    this.limbHalo.renderOrder = this.jointHalo.renderOrder = 6;

    const P = (name: string, parent: Object3D, x: number, y: number, z: number) => {
      const o = new Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      this.pivots[name] = o;
      return o;
    };
    const limb = (parent: Object3D, len: number, r: number, axis: "y" | "x" = "y", dir = -1) => {
      const o = new Object3D();
      if (axis === "y") o.position.set(0, (dir * len) / 2, 0);
      else o.rotation.z = Math.PI / 2;
      o.scale.set(r, len, r);
      parent.add(o);
      this.limbMarks.push(o);
    };
    const joint = (parent: Object3D, y: number, r: number) => {
      const o = new Object3D();
      o.position.set(0, y, 0);
      o.scale.setScalar(r * 1.15);
      parent.add(o);
      this.jointMarks.push(o);
    };

    this.group.add(this.body);
    const pelvis = P("pelvis", this.body, 0, 0.95, 0);
    joint(pelvis, 0, 0.07);
    for (const [side, x] of [["L", 0.09], ["R", -0.09]] as const) {
      const hip = P(`hip${side}`, pelvis, x, 0, 0);
      limb(hip, 0.45, 0.06);
      const knee = P(`knee${side}`, hip, 0, -0.45, 0);
      joint(knee, 0, 0.06);
      limb(knee, 0.45, 0.055);
      joint(knee, -0.45, 0.055);
    }
    const torso = P("torso", pelvis, 0, 0, 0);
    limb(torso, 0.47, 0.07, "y", 1);
    const chest = P("chest", torso, 0, 0.47, 0);
    limb(chest, 0.4, 0.05, "x");
    const head = P("head", chest, 0, 0.21, 0);
    for (const [side, x] of [["L", 0.2], ["R", -0.2]] as const) {
      const sh = P(`shoulder${side}`, chest, x, -0.02, 0);
      joint(sh, 0, 0.05);
      limb(sh, 0.3, 0.045);
      const el = P(`elbow${side}`, sh, 0, -0.3, 0);
      joint(el, 0, 0.045);
      limb(el, 0.28, 0.04);
      joint(el, -0.28, 0.04);
    }

    // Head + visor
    const headMesh = new Mesh(new SphereGeometry(0.15, 16, 12), core);
    head.add(headMesh);
    this.ringMat = new MeshBasicMaterial({ color: HEX.cyan, toneMapped: false });
    // 140 deg arc, laid flat and centred on the face (+Z), tilted 10 deg
    const visorGeo = new TorusGeometry(0.15, 0.025, 6, 20, 140 * DEG);
    visorGeo.rotateX(Math.PI / 2);
    visorGeo.rotateY(-20 * DEG);
    visorGeo.rotateX(10 * DEG);
    const visor = new Mesh(visorGeo, new MeshBasicMaterial({ color: HEX.magenta, toneMapped: false }));
    visor.position.set(0, 0.01, 0.01);
    head.add(visor);

    // Launcher along the right forearm (forearm local -Y points to the hand)
    const lg = new CylinderGeometry(0.11, 0.13, 0.6, 16);
    this.launcher = new Mesh(lg, new MeshStandardMaterial({ color: HEX.metal, metalness: 0.8, roughness: 0.35, emissive: HEX.panelBorder, emissiveIntensity: 0.25 }));
    this.launcher.position.set(0, -0.3, 0);
    this.pivots.elbowR.add(this.launcher);
    this.ring = new Mesh(new TorusGeometry(0.13, 0.025, 8, 24), this.ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.set(0, -0.6, 0);
    this.pivots.elbowR.add(this.ring);
    this.muzzle.position.set(0, -0.62, 0);
    this.pivots.elbowR.add(this.muzzle);
    // current bomb sits in the launcher mouth at hand height (on the line of
    // fire, below the camera's aim corridor), not on top of the launcher
    this.cradle.position.set(0, -0.78, 0);
    this.pivots.elbowR.add(this.cradle);
    // next bomb beside the LEFT shoulder (model +X), out of the aim corridor
    this.shoulderSeat.position.set(0.46, 1.36, -0.14);
    this.body.add(this.shoulderSeat);

    this.group.add(this.limbs, this.joints, this.limbHalo, this.jointHalo);
    this.disposables.push(core, halo, cyl, sph, headMesh.geometry, visor.geometry, visor.material as MeshBasicMaterial, lg,
      this.launcher.material as MeshStandardMaterial, this.ring.geometry, this.ringMat);
    this.pose = poseFor(this.inp);
  }

  fire() { this.inp.recoil = 0; }
  swap() { this.inp.swap = 0; }
  lose(fromX: number, fromZ: number) {
    this.inp.lose = 0;
    const p = this.group.position;
    const dx = p.x - fromX;
    const dz = p.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.inp.loseDirX = dx / len;
    this.inp.loseDirZ = dz / len;
  }
  win() { this.inp.win = 0; }
  flinch() {}
  deflect() {}
  roll() {}
  hitReact() { this.inp.recoil = 0; }
  setSkin() {}
  headWorld(out: Vector3) { return out.set(this.group.position.x, 1.95, this.group.position.z); }
  reset() {
    Object.assign(this.inp, { recoil: 99, swap: 99, lose: -1, win: -1 });
    this.slideX = this.slideZ = 0;
  }
  get swapT() { return this.inp.swap; }

  setColors(current: Color) {
    this.ringMat.color.copy(current);
  }

  update(f: AvatarFrame) {
    const speed = Math.hypot(f.vx, f.vz);
    const fwd = speed > 1e-3 ? (f.vx * Math.cos(f.yaw) + f.vz * Math.sin(f.yaw)) / speed : 1;
    this.animate(f.dt, f.x, f.z, f.yaw, speed / f.maxSpeed, fwd, f.yawRate, !f.low);
  }

  // x, z, yaw from the engine; speed 0..1 of max; forwardness = velocity
  // projected on facing (-1 backpedal .. 1); yawRate rad/s.
  private animate(dt: number, x: number, z: number, yaw: number, speed: number, forwardness: number, yawRate: number, halos: boolean) {
    const i = this.inp;
    i.t += dt; i.dt = dt; i.speed = speed; i.forwardness = forwardness; i.yawRate = yawRate;
    i.recoil += dt; i.swap += dt;
    if (i.lose >= 0) i.lose += dt;
    if (i.win >= 0) i.win += dt;
    this.pose = poseFor(i, this.pose);
    const ps = this.pose;
    if (i.lose >= 0) {
      const k = easeOutQuad(clamp01(i.lose / 0.45)) * 1.5;
      this.slideX = i.loseDirX * k;
      this.slideZ = i.loseDirZ * k;
    }
    this.group.position.set(x + this.slideX, 0, z + this.slideZ);
    this.group.rotation.y = modelRotationY(yaw);
    this.body.position.y = ps.bob;
    this.body.rotation.set(ps.pitch, 0, ps.roll);
    const pv = this.pivots;
    pv.hipL.rotation.set(ps.hipL, 0, 0);
    pv.hipR.rotation.set(ps.hipR, 0, 0);
    pv.kneeL.rotation.x = ps.kneeL;
    pv.kneeR.rotation.x = ps.kneeR;
    pv.torso.rotation.set(ps.torso, 0, 0);
    pv.head.rotation.x = ps.head;
    pv.shoulderL.rotation.set(ps.shL, 0, ps.shLz);
    pv.elbowL.rotation.x = ps.elL;
    pv.shoulderR.rotation.set(ps.shR, 0, ps.shRz);
    pv.elbowR.rotation.x = ps.elR;
    pv.elbowR.position.y = -0.3 + ps.kick;

    this.group.updateMatrixWorld(true);
    this.write(this.limbs, this.limbHalo, this.limbMarks, halos, true);
    this.write(this.joints, this.jointHalo, this.jointMarks, halos, false);
  }

  private write(core: InstancedMesh, halo: InstancedMesh, marks: Object3D[], halos: boolean, cyl: boolean) {
    const inv = this.m.copy(this.group.matrixWorld).invert();
    marks.forEach((o, k) => {
      const local = this.h.multiplyMatrices(inv, o.matrixWorld);
      core.setMatrixAt(k, local);
      if (halos) {
        if (cyl) local.scale(this.v.set(HALO, 1, HALO));
        else local.scale(this.v.set(HALO, HALO, HALO));
        halo.setMatrixAt(k, local);
      }
    });
    core.instanceMatrix.needsUpdate = true;
    halo.visible = halos;
    if (halos) halo.instanceMatrix.needsUpdate = true;
  }

  // World position helpers (valid after update()).
  readonly aimReady = 1;
  muzzleWorld(out: Vector3) { return this.muzzle.getWorldPosition(out); }
  laserStart(out: Vector3) { return this.muzzleWorld(out); }
  barrelWorld(out: Vector3) {
    this.pivots.elbowR.getWorldPosition(this.v);
    return this.muzzle.getWorldPosition(out).sub(this.v).normalize();
  }
  shadowXZ(out: Vector3) { return out.set(this.group.position.x, 0, this.group.position.z); }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    for (const im of [this.limbs, this.joints, this.limbHalo, this.jointHalo]) im.dispose();
  }
}
