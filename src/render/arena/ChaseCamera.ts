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
// Fun pass: the follow springs stiffen x1.5 during a dodge roll (spec 8 ->
// 12), slow-mo / hit-stop narrows the FOV (the moment reads as a zoom), the
// boss intro sweeps past the core on its way down, and a boss kill gets a
// 1.5 s beat: the camera rises and turns towards the core while it implodes
// and blows, then the win orbit takes over.

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
const FWD_CLOSE = 0.15; // w the camera may lag towards the player
const FOV_KICK = 3; // deg

export const INTRO_TIME = 2.8;
export type CameraMode = "intro" | "chase" | "crane" | "orbit";
type Mode = CameraMode;

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
  private readonly focus = new Vector3();
  private readonly player = new Vector3();
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
  rolling = false; // dodge roll: stiffer follow
  timeScale = 1; // engine slow-mo scale (FOV zoom)
  bossAt: { x: number; z: number } | null = null; // boss core (intro sweep passes it)
  private beatT = -1; // s into the boss-kill beat (-1 = none)
  private readonly beatAt = new Vector3();
  private zoom = 0;

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
  // Lose: frame the player's fall in the foreground and the breach (bx, bz)
  // behind it, from the player's side (px, pz = where the player stood).
  crane(bx: number, bz: number, px: number, pz: number) {
    this.mode = "crane";
    this.t = 0;
    this.focus.set(bx, 0.5, bz);
    this.player.set(px, 0, pz);
  }
  get modeName(): Mode {
    return this.mode;
  }
  orbit() {
    this.mode = "orbit";
    this.t = 0;
    this.beatT = -1;
  }
  // Boss kill: look at the core (x, z) for 1.5 s.
  bossBeat(x: number, z: number) {
    this.beatT = 0;
    this.beatAt.set(x, 1.2, z);
  }
  chase() {
    this.mode = "chase";
    this.beatT = -1;
  }

  // px, pz, yaw: stickman feet + facing. danger: engine level; rearDanger:
  // max sector danger in the rear 120 deg. shake: world offsets.
  update(cam: PerspectiveCamera, dt: number, px: number, pz: number, yaw: number, aspect: number,
    danger: number, rearDanger: number, shakeX: number, shakeY: number) {
    this.t += dt;
    if (this.mode === "intro" && this.t >= INTRO_TIME) this.mode = "chase"; // intro over (or skipped)
    const portrait = aspect < 1;
    const rig = portrait ? RIG_PORTRAIT : RIG_LANDSCAPE;
    // danger pull-back (600 ms ease in, release after 1200 ms below)
    const hot = danger > 0.6 || rearDanger > 0.7;
    this.pullHold = hot ? 1.2 : Math.max(0, this.pullHold - dt);
    this.pull = clamp01(this.pull + (hot || this.pullHold > 0 ? dt : -dt) / 0.6);
    const pk = easeInOutCubic(this.pull);
    const fov = vFovFor(aspect) + RIG_DANGER.fov * pk;
    // very wide screens (phone landscape) are short: look a little lower so
    // the feet stay in frame
    const live = {
      ...rig, dist: rig.dist + RIG_DANGER.dist * pk, height: rig.height + RIG_DANGER.height * pk,
      targetY: rig.targetY - (aspect >= 1.9 ? 0.55 : 0),
    };

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
      const boss = this.bossAt;
      if (!this.curve) {
        const back = { x: px - Math.cos(yaw) * 10, z: pz - Math.sin(yaw) * 10 };
        // boss level: swing past the core (outside it, low) on the way down
        const mid = boss
          ? new Vector3(boss.x * 0.55 - boss.z * 0.25, 7, boss.z * 0.55 + boss.x * 0.25)
          : new Vector3(back.x, 12, back.z);
        this.curve = new CatmullRomCurve3([new Vector3(0, 34, 0.01), mid, new Vector3(want.x, want.y, want.z)]);
      }
      const k = easeInOutCubic(clamp01((t - 1.2) / 1.2));
      this.curve.points[2].copy(want);
      this.curve.getPoint(k, this.pos);
      if (boss) {
        // look at the core first, then hand over to the player
        const w = easeInOutCubic(clamp01((k - 0.45) / 0.55));
        this.look.set(boss.x + (lookX - boss.x) * w, 1.3 + (lookY - 1.3) * w, boss.z + (lookZ - boss.z) * w);
      } else this.look.set(lookX * k, lookY * k, lookZ * k);
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
      // camera 5.5 w behind the player on the far side from the breach,
      // 3.6 up, looking 35% (15% on short screens) of the way to the breach: the fall reads in the
      // foreground, the breach behind it
      const k = easeInOutCubic(clamp01((this.t - 0.1) / 1.0));
      const dx = this.focus.x - this.player.x;
      const dz = this.focus.z - this.player.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      // short phone screens: further back + higher so the body falling
      // towards the camera stays in frame
      const short = aspect >= 1.9;
      const back = short ? 7 : 5.5;
      this.crn.set(this.player.x - ux * back - uz * 1.2, short ? 4.2 : 3.6, this.player.z - uz * back + ux * 1.2);
      want.lerp(this.crn, k);
      const lf = short ? 0.1 : 0.35; // short phone screens: favour the fall
      const fx = this.player.x + dx * lf, fz = this.player.z + dz * lf;
      lookX += (fx - lookX) * k;
      lookY += (0.6 - lookY) * k;
      lookZ += (fz - lookZ) * k;
    } else if (this.mode === "orbit") {
      const a = this.yaw + Math.PI + (this.still ? 0 : (this.t / 3) * Math.PI * 2);
      want.set(px + Math.cos(a) * 4.5, 2.0, pz + Math.sin(a) * 4.5);
      lookX = px; lookY = 1.1; lookZ = pz;
    }
    if (this.mode === "chase" && this.beatT >= 0) {
      this.beatT += dt;
      // rise + pull back, look 60% of the way to the core, ease out after 1.2 s
      const w = this.beatT < 1.2 ? easeInOutCubic(clamp01(this.beatT / 0.35)) : 1 - easeInOutCubic(clamp01((this.beatT - 1.2) / 0.3));
      want.y += 1.6 * w;
      want.x -= Math.cos(this.yaw) * 1.5 * w;
      want.z -= Math.sin(this.yaw) * 1.5 * w;
      lookX += (this.beatAt.x * 0.6 + lookX * 0.4 - lookX) * w;
      lookY += (this.beatAt.y - lookY) * w;
      lookZ += (this.beatAt.z * 0.6 + lookZ * 0.4 - lookZ) * w;
      if (this.beatT > 1.5) this.beatT = -1;
    }
    if (this.mode === "chase") {
      this.follow(want, lookX, lookY, lookZ, dt, this.rolling || this.beatT >= 0 ? 1.5 : 1);
      // FOV kick: running flat out along the view for 300 ms
      this.kickHold = this.fwdSpeed > 2.7 ? this.kickHold + dt : 0;
      const kickOn = this.kickHold >= 0.3 && !this.still;
      this.kick = expDamp(this.kick, kickOn ? 1 : 0, kickOn ? 4 : 6, dt);
      vfov += FOV_KICK * this.kick;
    } else {
      this.beatT = -1;
      const s = this.mode === "orbit" ? 1 : smooth(8, dt);
      this.pos.lerp(want, s);
      this.look.set(lookX, lookY, lookZ);
      this.springsLive = false;
      this.kick = 0;
    }
    // slow-mo / hit-stop: a zoom-in (scale 0.3 -> ~-5 deg)
    this.zoom = expDamp(this.zoom, this.still ? 0 : (1 - Math.min(1, this.timeScale)) * 7, this.timeScale < 1 ? 18 : 5, dt);
    vfov -= this.zoom;
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
  private follow(want: Vector3, lx: number, ly: number, lz: number, dt: number, stiff = 1) {
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
    cdStep(this.sF, wF, CAM_OMEGA.forward * stiff, dt);
    // backpedalling: never let the lag bring the camera closer than
    // FWD_CLOSE (the feet would leave the bottom of the frame)
    if (this.sF.x > wF + FWD_CLOSE) {
      this.sF.x = wF + FWD_CLOSE;
      this.sF.v = Math.min(0, this.sF.v);
    }
    cdStep(this.sR, wR, CAM_OMEGA.lateral * stiff, dt);
    cdStep(this.sY, want.y, CAM_OMEGA.height * stiff, dt);
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
