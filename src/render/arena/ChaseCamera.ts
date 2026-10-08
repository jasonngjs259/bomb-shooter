// Third-person chase camera (arena spec section 2, character spec section
// 4): over-the-right-shoulder rig on critically damped springs. Position
// springs run per axis in the camera's yaw frame (forward 12, lateral 11 =
// visible strafe lag, height 10), the look target at 14. Yaw follows the
// aim: near-rigid for the mouse (omega 28 + 90% feed-forward, ~2.6 deg lag at
// 360 deg/s), softer for keys / touch (11, 18 on fast turns, 50%
// feed-forward), hard-clamped to 25 deg. FOV kick +3 deg at full run.
// Plus a horizontal-locked FOV, danger pull-back with hysteresis, the 2.8 s
// top-down intro sweep, the game-over crane and the win orbit. Shake is
// applied to the camera only.

import { CatmullRomCurve3, PerspectiveCamera, Vector3 } from "three";
import {
  angleDiff, chasePose, DEG, RIG_DANGER, RIG_LANDSCAPE, RIG_PORTRAIT, smooth, vFovFor, wrapAngle,
} from "../../arena/arenaMath";
import { cdStep, expDamp, SpringState } from "../../arena/springs";
import { clamp01, easeInOutCubic } from "../three/world/easing";

export const CAM_OMEGA = { forward: 12, lateral: 11, height: 10, look: 14, yawMouse: 28, yawSoft: 11, yawFast: 18 };
const FF_MOUSE = 0.9; // yaw feed-forward share (mouse), the rest is sprung
const FF_SOFT = 0.5;
const LATERAL_MAX = 1.0; // w
const FOV_KICK = 3; // deg

export const INTRO_TIME = 2.8;
type Mode = "intro" | "chase" | "crane" | "orbit";

export class ChaseCamera {
  yaw = -Math.PI / 2; // smoothed camera heading (movement is relative to it)
  private mode: Mode = "chase";
  private t = 0;
  private readonly pos = new Vector3(0, 34, 0.01);
  private readonly look = new Vector3();
  private readonly tmp = new Vector3();
  private readonly crn = new Vector3();
  private pull = 0; // 0..1 danger pull-back
  private pullHold = 0;
  private lastYaw = -Math.PI / 2;
  private focus = new Vector3();
  private curve: CatmullRomCurve3 | null = null;
  private fovFrom = 72;
  private readonly sF: SpringState = { x: 0, v: 0 };
  private readonly sR: SpringState = { x: 0, v: 0 };
  private readonly sY: SpringState = { x: 0, v: 0 };
  private readonly sYaw: SpringState = { x: 0, v: 0 };
  private readonly lookV = new Vector3();
  private readonly vel = new Vector3();
  private readonly sL: SpringState = { x: 0, v: 0 };
  private springsLive = false;
  private kick = 0;
  private kickHold = 0;
  still = false;
  mouse = false; // the last turn input was the mouse (rigid yaw)
  fwdSpeed = 0; // shooter velocity along the camera heading, w/s (FOV kick)

  startIntro(still: boolean) {
    this.mode = "intro";
    this.t = still ? INTRO_TIME - 0.3 : 0;
    this.curve = null;
  }
  skipIntro() {
    if (this.mode === "intro") this.t = INTRO_TIME;
  }
  get introDone() {
    return this.mode !== "intro" || this.t >= INTRO_TIME;
  }
  get introT() {
    return this.mode === "intro" ? this.t : INTRO_TIME;
  }
  crane(x: number, z: number) {
    this.mode = "crane";
    this.t = 0;
    this.focus.set(x, 0.5, z);
  }
  orbit() {
    this.mode = "orbit";
    this.t = 0;
  }
  chase() {
    this.mode = "chase";
  }

  // px, pz, yaw: stickman feet + facing. danger: engine level; rearDanger:
  // max sector danger in the rear 120 deg. shake: world offsets.
  update(cam: PerspectiveCamera, dt: number, px: number, pz: number, yaw: number, aspect: number,
    danger: number, rearDanger: number, shakeX: number, shakeY: number) {
    this.t += dt;
    const portrait = aspect < 1;
    const rig = portrait ? RIG_PORTRAIT : RIG_LANDSCAPE;
    // danger pull-back (600 ms ease in, release after 1200 ms below)
    const hot = danger > 0.6 || rearDanger > 0.7;
    this.pullHold = hot ? 1.2 : Math.max(0, this.pullHold - dt);
    this.pull = clamp01(this.pull + (hot || this.pullHold > 0 ? dt : -dt) / 0.6);
    const pk = easeInOutCubic(this.pull);
    const fov = vFovFor(aspect) + RIG_DANGER.fov * pk;
    const live = { ...rig, dist: rig.dist + RIG_DANGER.dist * pk, height: rig.height + RIG_DANGER.height * pk };

    // camera yaw follows the aim: feed-forward share + critically damped rest
    const turn = angleDiff(this.lastYaw, yaw);
    this.lastYaw = yaw;
    if (this.mode === "chase" && this.springsLive && dt > 0) {
      const omega = this.mouse ? CAM_OMEGA.yawMouse : Math.abs(turn) / dt > 270 * DEG ? CAM_OMEGA.yawFast : CAM_OMEGA.yawSoft;
      const sy = this.sYaw;
      sy.x = this.yaw + turn * (this.mouse ? FF_MOUSE : FF_SOFT);
      cdStep(sy, sy.x + angleDiff(sy.x, yaw), omega, dt);
      this.yaw = wrapAngle(sy.x);
    } else {
      this.yaw = wrapAngle(this.yaw + angleDiff(this.yaw, yaw) * smooth(12, dt));
      this.sYaw.v = 0;
    }
    const lag = angleDiff(this.yaw, yaw);
    if (Math.abs(lag) > 25 * DEG) this.yaw = wrapAngle(yaw - Math.sign(lag) * 25 * DEG);

    const pose = chasePose({ x: px, z: pz }, this.yaw, live);
    const want = this.tmp.set(pose.pos.x, pose.pos.y, pose.pos.z);
    let lookX = pose.target.x;
    let lookY = pose.target.y;
    let lookZ = pose.target.z;
    let vfov = fov;

    if (this.mode === "intro" && this.t < INTRO_TIME) {
      const t = this.t;
      if (t < 1.2 || this.still) {
        const a = (t / 1.2) * 20 * DEG;
        cam.up.set(Math.sin(a), 0, -Math.cos(a));
        cam.position.set(0, 34, 0.01);
        cam.fov = 72;
        cam.near = 0.05;
        cam.far = 200;
        this.fovFrom = 72;
        cam.lookAt(0, 0, 0);
        cam.updateProjectionMatrix();
        this.pos.copy(cam.position);
        this.look.set(0, 0, 0);
        this.yaw = yaw;
        this.springsLive = false;
        return;
      }
      if (!this.curve) {
        const back = { x: px - Math.cos(yaw) * 10, z: pz - Math.sin(yaw) * 10 };
        this.curve = new CatmullRomCurve3([
          new Vector3(0, 34, 0.01), new Vector3(back.x, 12, back.z), new Vector3(want.x, want.y, want.z),
        ]);
      }
      const k = easeInOutCubic(clamp01((t - 1.2) / 1.2));
      this.curve.points[2].copy(want);
      this.curve.getPoint(k, this.pos);
      this.look.set(lookX * k, lookY * k, lookZ * k);
      cam.up.set(0, 1, 0);
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      cam.fov = this.fovFrom + (fov - this.fovFrom) * k;
      cam.updateProjectionMatrix();
      this.springsLive = false;
      return;
    }
    cam.up.set(0, 1, 0);
    if (this.mode === "crane") {
      const k = easeInOutCubic(clamp01((this.t - 0.2) / 1.2));
      this.crn.set(this.focus.x - Math.cos(this.yaw) * 8, 14, this.focus.z - Math.sin(this.yaw) * 8);
      want.lerp(this.crn, k);
      lookX += (this.focus.x - lookX) * k;
      lookY += (this.focus.y - lookY) * k;
      lookZ += (this.focus.z - lookZ) * k;
    } else if (this.mode === "orbit") {
      const a = this.yaw + Math.PI + (this.still ? 0 : (this.t / 3) * Math.PI * 2);
      want.set(px + Math.cos(a) * 4.5, 2.0, pz + Math.sin(a) * 4.5);
      lookX = px; lookY = 1.1; lookZ = pz;
    }
    if (this.mode === "chase") {
      this.follow(want, lookX, lookY, lookZ, dt);
      // FOV kick: running flat out along the view for 300 ms
      this.kickHold = this.fwdSpeed > 2.7 ? this.kickHold + dt : 0;
      const kickOn = this.kickHold >= 0.3 && !this.still;
      this.kick = expDamp(this.kick, kickOn ? 1 : 0, kickOn ? 4 : 6, dt);
      vfov += FOV_KICK * this.kick;
    } else {
      const s = this.mode === "orbit" ? 1 : smooth(8, dt);
      this.pos.lerp(want, s);
      this.look.set(lookX, lookY, lookZ);
      this.springsLive = false;
      this.kick = 0;
    }
    cam.position.set(this.pos.x + shakeX, this.pos.y + shakeY, this.pos.z);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - vfov) > 0.005 || cam.near !== 0.05) {
      cam.fov = vfov;
      cam.near = 0.05;
      cam.far = 200;
      cam.updateProjectionMatrix();
    }
  }

  // Position springs in the camera yaw frame (f = heading, r = right) and a
  // look-target spring; the state stays in world space between frames.
  private follow(want: Vector3, lx: number, ly: number, lz: number, dt: number) {
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);
    const rx = -fz, rz = fx;
    if (!this.springsLive) {
      this.springsLive = true;
      this.sF.v = this.sR.v = this.sY.v = this.sL.v = 0;
      this.lookV.set(0, 0, 0);
      this.look.set(lx, ly, lz);
    } else {
      // carry the velocity into this frame's axes
      this.sF.v = this.vel.x * fx + this.vel.z * fz;
      this.sR.v = this.vel.x * rx + this.vel.z * rz;
    }
    const p = this.pos;
    this.sF.x = p.x * fx + p.z * fz;
    this.sR.x = p.x * rx + p.z * rz;
    this.sY.x = p.y;
    const wF = want.x * fx + want.z * fz;
    const wR = want.x * rx + want.z * rz;
    cdStep(this.sF, wF, CAM_OMEGA.forward, dt);
    cdStep(this.sR, wR, CAM_OMEGA.lateral, dt);
    cdStep(this.sY, want.y, CAM_OMEGA.height, dt);
    if (Math.abs(this.sR.x - wR) > LATERAL_MAX) {
      this.sR.x = wR + Math.sign(this.sR.x - wR) * LATERAL_MAX;
      this.sR.v = 0;
    }
    p.set(fx * this.sF.x + rx * this.sR.x, this.sY.x, fz * this.sF.x + rz * this.sR.x);
    this.vel.set(fx * this.sF.v + rx * this.sR.v, this.sY.v, fz * this.sF.v + rz * this.sR.v);
    // look target: one omega for all axes
    const l = this.look, v = this.lookV, sl = this.sL;
    sl.x = l.x; sl.v = v.x; cdStep(sl, lx, CAM_OMEGA.look, dt); l.x = sl.x; v.x = sl.v;
    sl.x = l.y; sl.v = v.y; cdStep(sl, ly, CAM_OMEGA.look, dt); l.y = sl.x; v.y = sl.v;
    sl.x = l.z; sl.v = v.z; cdStep(sl, lz, CAM_OMEGA.look, dt); l.z = sl.x; v.z = sl.v;
  }
}
