// Headless checks for Arena 360 controls + camera maths:
// `npx tsx scripts/arena-controls.ts`

import { ArenaControls } from "../src/arena/ArenaControls";
import {
  angleDiff, biggestThreat, cameraRelativeMove, chasePose, facing, modelRotationY, RIG_LANDSCAPE, rightOf, rotateY,
  sectorCentre, stickCurve, vFovFor,
} from "../src/arena/arenaMath";
import { ArenaEngine } from "../src/game/arena";
import { poseFor } from "../src/render/arena/stickPose";
import { hasBaseRender, registerBaseRender, renderNoPresent } from "../src/render/three/renderer";
import { Camera, Object3D, PerspectiveCamera, WebGLRenderer } from "three";

let checks = 0;
const assert = (cond: unknown, msg: string) => {
  checks++;
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// 1. yaw -> model rotation: rotating the model's +Z by rotation.y = PI/2 - yaw
//    lands on the facing (cos yaw, sin yaw); model-right (-X) lands on R.
for (const yaw of [-Math.PI / 2, 0, 0.7, Math.PI / 2, 2.5, -2.9]) {
  const f = facing(yaw);
  const fwd = rotateY({ x: 0, z: 1 }, modelRotationY(yaw));
  assert(near(fwd.x, f.x) && near(fwd.z, f.z), `yaw ${yaw}: model +Z -> facing`);
  const r = rightOf(yaw);
  const right = rotateY({ x: -1, z: 0 }, modelRotationY(yaw));
  assert(near(right.x, r.x) && near(right.z, r.z), `yaw ${yaw}: model -X -> camera right`);
}
// default yaw faces -Z with +X on the right (three.js camera looking down -Z)
assert(near(facing(-Math.PI / 2).z, -1) && near(rightOf(-Math.PI / 2).x, 1), "default yaw faces -Z, right = +X");

// 2. camera-relative movement
for (const yaw of [-Math.PI / 2, 0, 1.1, 3]) {
  const f = facing(yaw);
  const r = rightOf(yaw);
  const w = cameraRelativeMove(0, 1, yaw);
  assert(near(w.x, f.x) && near(w.z, f.z), "W moves along the camera facing");
  const d = cameraRelativeMove(1, 0, yaw);
  assert(near(d.x, r.x) && near(d.z, r.z), "D strafes to camera right");
  const diag = cameraRelativeMove(1, 1, yaw);
  assert(near(Math.hypot(diag.x, diag.z), 1), "diagonal normalised");
}
// 3. stick curve: 12% dead zone, full tilt = 1, screen-up = forward
assert(stickCurve(5, 0, 60).strafe === 0, "dead zone");
assert(near(stickCurve(0, -60, 60).forward, 1) && near(stickCurve(60, 0, 60).strafe, 1), "full tilt");
assert(stickCurve(0, 30, 60).forward < 0, "thumb down = backwards");

// 4. FOV: horizontal-locked 78 deg -> 49 at 16:9, 45 at 20:9, 72 portrait
assert(Math.abs(vFovFor(16 / 9) - 49) < 0.6, `16:9 vfov ${vFovFor(16 / 9).toFixed(1)}`);
assert(near(vFovFor(20 / 9), 45, 0.01), "20:9 clamps to 45");
assert(near(vFovFor(9 / 19.5), 72, 0.01), "portrait clamps to 72");

// 5. chase pose: behind (-F*4.8), right of the shoulder (+R*0.95), 3.4 up,
//    looking at the launcher's line of fire (+R*0.22) ~15 deg down
{
  const p = chasePose({ x: 1, z: 2 }, 0, RIG_LANDSCAPE);
  assert(near(p.pos.x, 1 - 4.8) && near(p.pos.z, 2 + 0.95) && near(p.pos.y, 3.4), "chase position");
  assert(near(p.target.x, 1 + 3.5) && near(p.target.z, 2 + 0.22) && near(p.target.y, 1.25), "look target on the line of fire");
  // stickman (feet line) is left of the view centre: camera->target vs camera->player
  const fx = p.target.x - p.pos.x, fz = p.target.z - p.pos.z;
  const px = 1 - p.pos.x, pz = 2 - p.pos.z;
  assert(fx * pz - fz * px < 0, "stickman sits left of centre");
  const pitch = (Math.atan2(p.pos.y - p.target.y, Math.hypot(p.pos.x - p.target.x, p.pos.z - p.target.z)) * 180) / Math.PI;
  assert(pitch > 14 && pitch < 18, `pitch ~16 deg (${pitch.toFixed(1)})`);
}

// 6. controls -> engine: W walks along the camera heading, turn keys and
//    mouse-look change yaw, snap-turn reaches its target
{
  const e = new ArenaEngine({ random: () => 0.42 });
  e.newGame();
  e.setCreepPaused(true);
  const c = new ArenaControls();
  c.enabled = true;
  const camYaw = 0.6;
  c.keys.up = true;
  for (let i = 0; i < 30; i++) {
    c.apply(e, camYaw, 1 / 60);
    e.update(1 / 60);
  }
  const s = e.getShooter();
  const dir = Math.atan2(s.z, s.x);
  assert(Math.hypot(s.x, s.z) > 0.5 && Math.abs(angleDiff(dir, camYaw)) < 0.01, "W walks along camera yaw");
  c.keys.up = false;
  const y0 = e.getShooter().yaw;
  c.addYaw(0.3);
  c.apply(e, camYaw, 1 / 60);
  assert(near(angleDiff(y0, e.getShooter().yaw), 0.3, 1e-9), "mouse-look adds yaw (+ = right)");
  c.snapTo(e.getShooter().yaw, 2.0, 0.28);
  for (let i = 0; i < 20; i++) c.apply(e, camYaw, 1 / 60);
  assert(Math.abs(angleDiff(e.getShooter().yaw, 2.0)) < 1e-6, "snap-turn reaches target in 280 ms");
  c.enabled = false;
  c.addYaw(1);
  c.apply(e, camYaw, 1 / 60);
  assert(Math.abs(angleDiff(e.getShooter().yaw, 2.0)) < 1e-6, "disabled controls ignore input");
}

// 7. threat helper + stick pose signs
{
  const d = new Array<number>(16).fill(0);
  assert(biggestThreat(d) === null, "no threat below 0.5");
  d[5] = 0.6;
  d[9] = 0.9;
  assert(near(biggestThreat(d) ?? -1, sectorCentre(9)), "biggest threat sector");
  const walk = poseFor({ t: 0, dt: 0.1, speed: 1, forwardness: 1, yawRate: 0, recoil: 99, swap: 99, lose: -1, win: -1, loseDirX: 0, loseDirZ: 1 });
  assert(walk.torso > 0, "walking leans the torso forward");
  const lose = poseFor({ t: 1, dt: 0.016, speed: 0, forwardness: 1, yawRate: 0, recoil: 99, swap: 99, lose: 1, win: -1, loseDirX: 0, loseDirZ: 1 });
  assert(lose.pitch < -1.3, "lose pose pitches back ~80 deg");
  const turnR = poseFor({ t: 0, dt: 1, speed: 0, forwardness: 1, yawRate: 3, recoil: 99, swap: 99, lose: -1, win: -1, loseDirX: 0, loseDirZ: 1 });
  assert(turnR.roll > 0, "turning right leans towards model-right (+roll)");
}

// 8. Render passes (QA blocker): three r186 defines render() per instance,
//    so WebGLRenderer.prototype.render does not exist. Multi-pass frames use
//    the instance's original render captured at creation, which keeps
//    working after R3F native wraps gl.render to present (endFrameEXP).
{
  const proto = WebGLRenderer.prototype as unknown as Record<string, unknown>;
  assert(typeof proto.render !== "function", "three has no prototype.render (never call it)");
  const calls: string[] = [];
  const fake = {
    render: (_s: Object3D, _c: Camera) => {
      calls.push("draw");
    },
  };
  registerBaseRender(fake);
  assert(hasBaseRender(fake), "base render captured");
  const original = fake.render;
  fake.render = (sc: Object3D, cam: Camera) => {
    original(sc, cam);
    calls.push("present"); // what R3F native's wrapper adds
  };
  const scene = new Object3D();
  const cam = new PerspectiveCamera();
  renderNoPresent(fake, scene, cam);
  assert(calls.join() === "draw", "main pass draws without presenting");
  fake.render(scene, cam);
  assert(calls.join() === "draw,draw,present", "last pass presents once");
  // (the source scan for prototype method calls: scripts/check-no-prototype-calls.mjs)
}

console.log(`arena controls: ${checks} checks passed`);
