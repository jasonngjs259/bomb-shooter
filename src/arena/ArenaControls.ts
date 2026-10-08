// Input state for Arena 360, written by the desktop (keyboard + pointer
// lock) and touch (joystick, turn drag, buttons) handlers and applied to the
// engine once per GL frame by apply(). Plain mutable fields: input never
// causes a React render.

import type { ArenaEngine } from "../game/arena";
import { angleDiff, cameraRelativeMove, DEG, wrapAngle } from "./arenaMath";

const KEY_TURN = 150 * DEG; // rad/s, Q/E and arrows
const KEY_RAMP = 0.1; // s to full key turn rate
const CURSOR_TURN = 180 * DEG; // rad/s at the screen edge (no pointer lock)
const ASSIST_RATE = 6 * DEG; // rad/s
const ASSIST_MAX = 0.3; // s
const ASSIST_CONE = 3 * DEG;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export class ArenaControls {
  enabled = false;
  readonly keys = { up: false, down: false, left: false, right: false, turnL: false, turnR: false };
  readonly stick = { strafe: 0, forward: 0 }; // touch joystick, -1..1
  cursorTurn = 0; // -1..1, cursor-offset turning (pointer lock refused)
  turnedTotal = 0; // rad, for the tutorial
  private yawDelta = 0;
  private keyRamp = 0;
  private snap: { from: number; to: number; t: number; dur: number } | null = null;
  private assist: { dir: number; left: number; target: number } | null = null;

  // Mouse-look / drag turn (rad, + = turn right).
  addYaw(rad: number) {
    if (!this.enabled || !Number.isFinite(rad)) return;
    this.yawDelta += rad;
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
    this.yawDelta = 0;
    this.keyRamp = 0;
    this.snap = null;
    this.assist = null;
  }

  // Once per frame. cameraYaw: the (lagging) camera heading for movement.
  apply(engine: ArenaEngine, cameraYaw: number, dt: number) {
    if (!this.enabled) {
      engine.setMoveInput(0, 0);
      this.yawDelta = 0;
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
    this.keyRamp = keyDir !== 0 ? Math.min(1, this.keyRamp + dt / KEY_RAMP) : 0;
    let delta = this.yawDelta + keyDir * this.keyRamp * KEY_TURN * dt + this.cursorTurn * CURSOR_TURN * dt;
    this.yawDelta = 0;
    if (delta !== 0) {
      this.snap = null;
      if (keyDir !== 0 || this.cursorTurn !== 0) this.assist = null;
    }
    if (this.snap) {
      const sn = this.snap;
      sn.t += dt;
      const want = sn.from + (sn.to - sn.from) * easeOutCubic(Math.min(1, sn.t / sn.dur));
      delta = angleDiff(yaw, want);
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
