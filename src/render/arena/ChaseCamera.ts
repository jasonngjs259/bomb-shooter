// Third-person chase camera (spec section 2): over-the-right-shoulder rig
// with frame-rate independent smoothing, yaw lag (rate 12, 20 on fast
// flicks, hard-clamped to 25 deg), a horizontal-locked FOV, danger
// pull-back with hysteresis, the 2.8 s top-down intro sweep, the game-over
// crane and the win orbit. Shake is applied to the camera only.

import { CatmullRomCurve3, PerspectiveCamera, Vector3 } from "three";
import {
  angleDiff, chasePose, DEG, RIG_DANGER, RIG_LANDSCAPE, RIG_PORTRAIT, smooth, vFovFor, wrapAngle,
} from "../../arena/arenaMath";
import { clamp01, easeInOutCubic } from "../three/world/easing";

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
  still = false;

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

    // camera yaw follows facing
    const rate = Math.abs(angleDiff(this.lastYaw, yaw)) / Math.max(dt, 1e-4) > 270 * DEG ? 20 : 12;
    this.lastYaw = yaw;
    let lag = angleDiff(this.yaw, yaw);
    this.yaw = wrapAngle(this.yaw + lag * smooth(rate, dt));
    lag = angleDiff(this.yaw, yaw);
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
    const s = this.mode === "orbit" ? 1 : smooth(8, dt);
    this.pos.lerp(want, s);
    this.look.set(lookX, lookY, lookZ);
    cam.position.set(this.pos.x + shakeX, this.pos.y + shakeY, this.pos.z);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - vfov) > 0.01 || cam.near !== 0.05) {
      cam.fov = vfov;
      cam.near = 0.05;
      cam.far = 200;
      cam.updateProjectionMatrix();
    }
  }
}
