// Input state for Arena 360, written by the desktop (keyboard + pointer
// lock) and touch (joystick, turn drag, buttons) handlers and applied to the
// engine once per GL frame by apply(). Plain mutable fields: input never
// causes a React render.
// Smoothing (character spec section 4): key turning is an angular velocity
// with accel / decel (and a boost after a long hold); mouse-look is a
// 2-frame moving average of the raw deltas (no acceleration, <= 1 frame of
// lag); touch drags go through a 1 euro filter (filtered in px). Aim yaw is
// always this filtered value: only the body and camera lag behind it.

import type { ArenaEngine } from "../game/arena";
import { angleDiff, cameraRelativeMove, DEG, wrapAngle } from "./arenaMath";
import { OneEuro } from "./springs";

const KEY_TURN = 150 * DEG; // rad/s, Q/E and arrows
const KEY_BOOST = 200 * DEG; // after holding KEY_BOOST_AFTER, ramped over KEY_BOOST_RAMP
const KEY_BOOST_AFTER = 0.6;
const KEY_BOOST_RAMP = 0.3;
const KEY_ACCEL = 900 * DEG; // rad/s^2
const KEY_DECEL = 1400 * DEG;
export const TOUCH_RAD_PER_PX = 0.45 * DEG; // drag sensitivity (TouchControls)
const CURSOR_TURN = 180 * DEG; // rad/s at the screen edge (no pointer lock)
const ASSIST_RATE = 6 * DEG; // rad/s
const ASSIST_MAX = 0.3; // s
const ASSIST_CONE = 3 * DEG;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const towards = (v: number, target: number, step: number) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

export type YawSource = "mouse" | "keys" | "touch";

export class ArenaControls {
  enabled = false;
  readonly keys = { up: false, down: false, left: false, right: false, turnL: false, turnR: false };
  readonly stick = { strafe: 0, forward: 0 }; // touch joystick, -1..1
  cursorTurn = 0; // -1..1, cursor-offset turning (pointer lock refused)
  turnedTotal = 0; // rad, for the tutorial
  yawSource: YawSource = "keys"; // last turn input (camera yaw stiffness)
  idleTime = 0; // s since the last move / turn input (character stance)
  private mouseNow = 0;
  private mousePrev = 0;
  private touchRaw = 0; // cumulative drag, px
  private touchOut = 0; // filtered drag already applied, px
  private readonly touchFilter = new OneEuro(1.5, 0.02, 1.0);
  private keyVel = 0; // rad/s, signed
  private keyHeld = 0;
  private snap: { from: number; to: number; t: number; dur: number } | null = null;
  private assist: { dir: number; left: number; target: number } | null = null;

  // Mouse-look / drag turn (rad, + = turn right).
  addYaw(rad: number, source: "mouse" | "touch" = "mouse") {
    if (!this.enabled || !Number.isFinite(rad)) return;
    if (source === "mouse") this.mouseNow += rad;
    else this.touchRaw += rad / TOUCH_RAD_PER_PX;
    this.yawSource = source;
    this.snap = null;
    this.assist = null;
  }

  // Snap-turn to an absolute yaw (threat arrows, R, TURN 180).
  snapTo(currentYaw: number, targetYaw: number, dur: number) {
    if (!this.enabled) return;
    this.snap = { from: currentYaw, to: currentYaw + angleDiff(currentYaw, targetYaw), t: 0, dur: Math.max(0.01, dur) };
    this.assist = null;
  }

  // Soft aim assist after a touch turn: if the laser misses but a bomb sits
  // within 3 deg, ease towards it at 6 deg/s for at most 300 ms.
  startAssist(engine: ArenaEngine) {
    if (!this.enabled || engine.getAimRay().hitBombId !== null) return;
    const s = engine.getShooter();
    let best = ASSIST_CONE;
    let target: number | null = null;
    for (const b of engine.getBombs()) {
      if (b.state !== "idle") continue;
      const d = angleDiff(s.yaw, Math.atan2(b.z - s.z, b.x - s.x));
      if (Math.abs(d) < best) {
        best = Math.abs(d);
        target = s.yaw + d;
      }
    }
    if (target !== null) this.assist = { dir: Math.sign(target - s.yaw), left: ASSIST_MAX, target };
  }

  clear() {
    Object.assign(this.keys, { up: false, down: false, left: false, right: false, turnL: false, turnR: false });
    this.stick.strafe = this.stick.forward = 0;
    this.cursorTurn = 0;
    this.resetTurn();
    this.snap = null;
    this.assist = null;
  }

  private resetTurn() {
    this.mouseNow = this.mousePrev = 0;
    this.touchRaw = this.touchOut = 0;
    this.touchFilter.reset(0);
    this.keyVel = this.keyHeld = 0;
  }

  // Key turn rate (rad/s) after this frame: accelerate towards +-max, brake
  // harder than it speeds up (also when reversing), boost on a long hold.
  private keyTurn(dir: number, dt: number) {
    const v0 = this.keyVel;
    this.keyHeld = dir !== 0 ? this.keyHeld + dt : 0;
    const max = KEY_TURN + (KEY_BOOST - KEY_TURN) * Math.min(1, Math.max(0, (this.keyHeld - KEY_BOOST_AFTER) / KEY_BOOST_RAMP));
    const target = dir * max;
    const braking = target === 0 || Math.sign(v0) === -Math.sign(target) || Math.abs(v0) > max;
    this.keyVel = towards(v0, braking && Math.sign(v0) !== Math.sign(target) ? 0 : target, (braking ? KEY_DECEL : KEY_ACCEL) * dt);
    return ((v0 + this.keyVel) / 2) * dt; // trapezoid: exact for constant accel
  }

  // Once per frame. cameraYaw: the (lagging) camera heading for movement.
  apply(engine: ArenaEngine, cameraYaw: number, dt: number) {
    if (!this.enabled) {
      engine.setMoveInput(0, 0);
      this.resetTurn();
      return;
    }
    const k = this.keys;
    let strafe = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    let forward = (k.up ? 1 : 0) - (k.down ? 1 : 0);
    const len = Math.hypot(strafe, forward);
    if (len > 1) {
      strafe /= len;
      forward /= len;
    }
    if (Math.hypot(this.stick.strafe, this.stick.forward) > len) {
      strafe = this.stick.strafe;
      forward = this.stick.forward;
    }
    const move = cameraRelativeMove(strafe, forward, cameraYaw);
    engine.setMoveInput(move.x, move.z);

    const yaw = engine.getShooter().yaw;
    const keyDir = (k.turnR ? 1 : 0) - (k.turnL ? 1 : 0);
    const mouse = (this.mouseNow + this.mousePrev) / 2;
    this.mousePrev = this.mouseNow;
    this.mouseNow = 0;
    const touchPx = this.touchFilter.filter(this.touchRaw, dt) - this.touchOut;
    this.touchOut += touchPx;
    if (keyDir !== 0) this.yawSource = "keys";
    let delta = mouse + touchPx * TOUCH_RAD_PER_PX + this.keyTurn(keyDir, dt) + this.cursorTurn * CURSOR_TURN * dt;
    if (Math.abs(delta) < 1e-7) delta = 0;
    this.idleTime = delta !== 0 || strafe !== 0 || forward !== 0 ? 0 : this.idleTime + dt;
    if (delta !== 0) {
      this.snap = null;
      if (keyDir !== 0 || this.cursorTurn !== 0) this.assist = null;
    }
    if (this.snap) {
      const sn = this.snap;
      sn.t += dt;
      const want = sn.from + (sn.to - sn.from) * easeOutCubic(Math.min(1, sn.t / sn.dur));
      delta = angleDiff(yaw, want);
      this.keyVel = 0;
      this.idleTime = 0;
      if (sn.t >= sn.dur) this.snap = null;
    } else if (this.assist) {
      const a = this.assist;
      const step = Math.min(Math.abs(angleDiff(yaw, a.target)), ASSIST_RATE * dt);
      delta += a.dir * step;
      a.left -= dt;
      if (a.left <= 0 || step < 1e-5) this.assist = null;
    }
    if (delta !== 0) {
      this.turnedTotal += Math.abs(delta);
      engine.setYaw(wrapAngle(yaw + delta));
    }
  }
}
