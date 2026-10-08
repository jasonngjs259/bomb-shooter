// Headless smoke for the Arena frame driver: builds the real ArenaWorld
// (every three.js object, FX, stickman, camera, radar) and runs it with a
// stub renderer through the intro sweep, play, a win (+ celebration) and a
// loss (+ lose sequence), asserting nothing throws and every frame renders
// the two passes with exactly one present (the radar pass). Then the real
// character path: the GLB parsed from disk, driven through idle, walk, run,
// strafes, backpedal, turns, shoot, swap, hit, win and death (no throw, no
// NaN, blend weights per group sum to 1, barrel on the laser, no pops).
// Run: npx tsx --tsconfig scripts/smoke/tsconfig.json scripts/arena-smoke.ts

import { readFileSync } from "node:fs";
import { Camera, Object3D, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { ArenaControls } from "../src/arena/ArenaControls";
import { ArenaEngine } from "../src/game/arena";
import { getSimClock } from "../src/game/clock";
import { getFxBus } from "../src/fx/bus";
import { segmentAEnd } from "../src/render/arena/AimLaser";
import { ArenaWorld } from "../src/render/arena/ArenaWorld";
import { PassRenderer, renderArenaFrame } from "../src/render/arena/renderPasses";
import { registerBaseRender } from "../src/render/three/renderer";

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Stub renderer shaped like R3F native's: render() is wrapped to present.
const stats = { draws: 0, presents: 0 };
const gl: PassRenderer = {
  autoClear: true,
  render: (_s: Object3D, _c: Camera) => {
    stats.draws++;
  },
  clearDepth: () => undefined,
  setViewport: () => undefined,
  setScissor: () => undefined,
  setScissorTest: () => undefined,
};
registerBaseRender(gl);
const draw = gl.render;
gl.render = (s: Object3D, c: Camera) => {
  draw(s, c);
  stats.presents++;
};

const W = 1280;
const H = 720;
const DT = 1 / 60;

function session(
  name: string, config: ConstructorParameters<typeof ArenaEngine>[0], drive: (e: ArenaEngine) => void, setup?: (w: ArenaWorld) => void,
) {
  const engine = new ArenaEngine(config);
  const controls = new ArenaControls();
  const world = new ArenaWorld(engine, controls, getSimClock(engine), getFxBus(engine));
  setup?.(world);
  const camera = new PerspectiveCamera(50, W / H, 1, 5000);
  world.setSize(W, H);
  let introDone = false;
  world.onIntroDone = () => (introDone = true);
  engine.newGame();
  engine.setCreepPaused(true);
  world.startIntro();
  let frames = 0;
  let endFrames = -1;
  const step = () => {
    const before = { ...stats };
    world.frame(camera, DT, 1);
    renderArenaFrame(gl, world.root, camera, world.radar, world.radarRect, { width: W, height: H });
    const dd = stats.draws - before.draws;
    const dp = stats.presents - before.presents;
    assert(dp === 1 && dd === (world.radarRect ? 2 : 1), `${name} frame ${frames}: ${dd} draws, ${dp} presents`);
    frames++;
  };
  while (!introDone && frames < 400) step();
  assert(introDone, `${name}: intro sweep finished (${frames} frames)`);
  step();
  assert(world.chase.modeName === "chase", `${name}: first game's camera is in chase mode after the intro (${world.chase.modeName})`);
  const introFrames = frames;
  world.radarRect = { x: W - 156, y: 16, size: 140 };
  world.playing = true;
  engine.setCreepPaused(false);
  while (frames < 6000) {
    if (engine.getPhase() === "playing") drive(engine);
    else if (endFrames < 0) {
      endFrames = frames;
      world.playing = false;
    }
    step();
    if (endFrames >= 0 && frames - endFrames >= 240) break; // 4 s of lose / win sequence
  }
  assert(endFrames >= 0, `${name}: game ended`);
  console.log(`  ok  ${name}: intro ${introFrames} frames, play ${endFrames - introFrames}, end sequence ${frames - endFrames} -> ${engine.getPhase()}`);
  world.dispose();
  return engine.getPhase();
}

// Win: a small one-colour level 1 cleared by an aim-and-fire bot.
const won = session(
  "win",
  { random: mulberry32(5), config: { colorCount: 1, earlyLevels: [{ bombs: 12, creepScale: 0.85 }] } },
  (e) => {
    const s = e.getShooter();
    if (e.getShot() || s.cooldown > 0) return;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const b of e.getBombs()) {
      const d = Math.hypot(b.x - s.x, b.z - s.z);
      if (b.state === "idle" && d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best) {
      e.aimAt(best.x, best.z);
      e.fire();
    }
  }
);
assert(won === "won", `win session ended in ${won}`);

// Lose: fast creep, nobody shoots.
const lost = session("lose", { random: mulberry32(9), config: { creepSpeed: 1.5, earlyLevels: [] } }, () => undefined);
assert(lost === "gameOver", `lose session ended in ${lost}`);

// ---- The animated character (GLB parsed from disk, as the app parses it) ----
const glb = readFileSync(new URL("../src/assets/models/astronaut.glb", import.meta.url));
const bytes = () => Promise.resolve(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer);

async function characterRun() {
  const engine = new ArenaEngine({ random: mulberry32(3), config: { colorCount: 1, earlyLevels: [{ bombs: 12, creepScale: 0.85 }] } });
  const controls = new ArenaControls();
  const world = new ArenaWorld(engine, controls, getSimClock(engine), getFxBus(engine));
  assert(world.avatarKind === "stickman", "stickman until a model is requested");
  await world.loadCharacter(bytes);
  assert(world.avatarKind === "character" && world.character, "character loaded from the GLB");
  const ch = world.character!;
  const camera = new PerspectiveCamera(50, W / H, 1, 5000);
  world.setSize(W, H);
  engine.newGame();
  engine.setCreepPaused(true);
  world.startIntro();
  world.chase.skipIntro();
  world.frame(camera, DT, 1);
  assert(world.chase.modeName === "chase", "skipped intro hands over to the chase camera");
  world.playing = true;
  controls.enabled = true;

  const bones: Object3D[] = [];
  ch.group.traverse((o) => {
    // IK pole targets (PTL / PTR) carry no skin and the right fingers sit
    // inside the arm-cannon sleeve, so their spins don't show
    if ((o as Object3D & { isBone?: boolean }).isBone && !/^PT[LR]$|^(Index|Middle|Ring|Pinky|Thumb)\dR$/.test(o.name)) bones.push(o);
  });
  const prevQ = bones.map(() => new Quaternion());
  const q = new Quaternion();
  const rootQ = new Quaternion();
  const muzzle = new Vector3();
  const barrel = new Vector3();
  const seg = new Vector3();
  const foot = bones.find((b) => b.name === "FootL")!;
  const stats = { frames: 0, maxSumErr: 0, maxGun: 0, gunN: 0, maxPop: 0, popAt: "", nan: false };
  const per: Record<string, { gun: number; slide: number }> = {};
  let label = "";
  let sinceFire = 99;
  let plantPrev: Vector3 | null = null;
  let plantDrift = 0;
  const footW = new Vector3();

  let phaseT = 0;
  const frame = (checkGun: boolean) => {
    phaseT += DT;
    world.frame(camera, DT, 1);
    renderArenaFrame(gl, world.root, camera, world.radar, world.radarRect, { width: W, height: H });
    stats.frames++;
    sinceFire += DT;
    const sums = ch.animator.sums();
    stats.maxSumErr = Math.max(stats.maxSumErr, Math.abs(sums.lower - 1), Math.abs(sums.upper - 1));
    // barrel vs laser segment A (from the muzzle the laser starts at)
    const sh = engine.getShooter();
    segmentAEnd(engine.getAimRay(), sh.yaw, seg);
    ch.muzzleWorld(muzzle);
    ch.barrelWorld(barrel);
    const gun = (barrel.angleTo(seg.sub(muzzle).normalize()) * 180) / Math.PI;
    const p = (per[label] ??= { gun: 0, slide: 0 });
    if (checkGun && sinceFire > 0.3 && ch.state.stance > 0.99 && ch.state.swapReach === 0) {
      stats.maxGun = Math.max(stats.maxGun, gun);
      p.gun = Math.max(p.gun, gun);
      stats.gunN++;
    }
    // pops: largest per-bone rotation step between frames, in the
    // character's own frame (the bot's instant aim snaps are not input a
    // player can make, so the win drive is not measured)
    ch.group.getWorldQuaternion(rootQ).invert();
    bones.forEach((b, i) => {
      b.getWorldQuaternion(q).premultiply(rootQ);
      const step = (q.angleTo(prevQ[i]) * 180) / Math.PI;
      if (stats.frames > 2 && ch.animator.mode === "play" && label !== "win" && step > stats.maxPop) {
        stats.maxPop = step;
        stats.popAt = `${b.name} in ${label}`;
      }
      prevQ[i].copy(q);
      if (!Number.isFinite(q.x + q.y + q.z + q.w) || !Number.isFinite(b.position.x + b.position.y + b.position.z)) stats.nan = true;
    });
    // foot sliding: horizontal drift of the left foot while planted (ankle
    // bone within 2 cm of its lowest height), after 0.5 s in a phase
    foot.getWorldPosition(footW);
    if (footW.y < 0.045 && phaseT > 0.5) {
      if (plantPrev) plantDrift = Math.max(plantDrift, Math.hypot(footW.x - plantPrev.x, footW.z - plantPrev.z));
      else plantPrev = footW.clone();
    } else if (plantPrev) {
      p.slide = Math.max(p.slide, plantDrift);
      plantPrev = null;
      plantDrift = 0;
    }
  };
  const hold = (name: string, secs: number, keys: Partial<ArenaControls["keys"]>, opts: { yawRate?: number; gun?: boolean } = {}) => {
    label = name;
    phaseT = 0;
    plantPrev = null;
    plantDrift = 0;
    Object.assign(controls.keys, { up: false, down: false, left: false, right: false, turnL: false, turnR: false }, keys);
    for (let i = 0; i < Math.round(secs * 60); i++) {
      if (opts.yawRate) controls.addYaw(opts.yawRate * DT);
      frame(opts.gun ?? true);
    }
  };

  hold("idle", 1, {});
  hold("walk", 0.6, { up: true }); // accelerating through the walk tier
  hold("run", 1.5, { up: true });
  hold("strafe L", 1.5, { left: true });
  hold("strafe R", 1.5, { right: true });
  hold("backpedal", 1.5, { down: true });
  hold("diagonal", 1.5, { up: true, right: true });
  hold("stop", 0.6, {});
  hold("turn 150", 1.2, { up: true }, { yawRate: (150 * Math.PI) / 180 });
  hold("turn idle", 1.2, {}, { yawRate: (150 * Math.PI) / 180 });
  hold("settle", 0.5, {});
  label = "shoot";
  for (let k = 0; k < 5; k++) {
    controls.keys.left = true;
    if (engine.fire()) sinceFire = 0;
    for (let i = 0; i < 20; i++) frame(true);
  }
  assert(ch.state.recoil < 1.6, "recoil capped at 1.5x");
  hold("swap", 0.1, {});
  engine.swapBomb();
  hold("swap", 0.6, {});
  ch.flinch();
  hold("hit", 0.6, {}, { gun: false });
  hold("relax", 3, {}, { gun: false });
  assert(ch.state.stance < 0.05, `stance relaxes after 2 s idle (${ch.state.stance.toFixed(2)})`);
  hold("re-raise", 0.15, { turnR: true }, { gun: false });
  assert(ch.state.stance > 0.99, "stance re-raised within 150 ms of input");

  // win: clear the 12-bomb field with an aim-and-fire bot
  label = "win";
  for (let i = 0; i < 4000 && engine.getPhase() === "playing"; i++) {
    const s = engine.getShooter();
    if (!engine.getShot() && s.cooldown <= 0) {
      const t = engine.getBombs().find((b) => b.state === "idle");
      if (t) {
        engine.aimAt(t.x, t.z);
        if (engine.fire()) sinceFire = 0;
      }
    }
    frame(false);
  }
  assert(engine.getPhase() === "won", `character session won (${engine.getPhase()})`);
  world.playing = false;
  for (let i = 0; i < 180; i++) frame(false);
  assert(ch.animator.mode === "win" && ch.animator.fullW === 1, "win clip took over");
  // death on the next level
  world.restart();
  engine.newGame();
  world.playing = true;
  for (let i = 0; i < 30; i++) frame(false);
  ch.lose(engine.getShooter().x + 2, engine.getShooter().z);
  for (let i = 0; i < 120; i++) frame(false);
  assert(ch.animator.mode === "dead" && ch.animator.fullW === 1, "death clip took over");

  assert(!stats.nan, "no NaN in any bone");
  assert(stats.maxSumErr < 1e-3, `blend weights per group sum to 1 (max error ${stats.maxSumErr.toExponential(1)})`);
  assert(stats.maxGun <= 2, `barrel within 2 deg of laser segment A while moving / aiming (max ${stats.maxGun.toFixed(2)} deg)`);
  assert(stats.maxPop <= 20, `no pops: max per-bone step ${stats.maxPop.toFixed(1)} deg per frame (<= 20, ${stats.popAt})`);
  const rows = Object.entries(per).map(([k, v]) => `${k} ${v.gun.toFixed(2)}deg/${(v.slide * 100).toFixed(1)}cm`).join(", ");
  console.log(`  ok  character: ${stats.frames} frames, weight sums max err ${stats.maxSumErr.toExponential(1)}, gun-vs-laser max ${stats.maxGun.toFixed(2)} deg (${stats.gunN} samples), max bone step ${stats.maxPop.toFixed(1)} deg (${stats.popAt})`);
  console.log(`      per phase (gun max / planted-foot drift): ${rows}`);
  world.dispose();
}

characterRun()
  .then(() => console.log(`arena smoke: OK (${stats.draws} draws, ${stats.presents} presents, no throw)`))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
