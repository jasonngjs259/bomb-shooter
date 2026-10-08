// Headless smoke for the Arena frame driver: builds the real ArenaWorld
// (every three.js object, FX, stickman, camera, radar) and runs it with a
// stub renderer through the intro sweep, play, a win (+ celebration) and a
// loss (+ lose sequence), asserting nothing throws and every frame renders
// the two passes with exactly one present (the radar pass). Then the real
// character path: the GLB parsed from disk, driven through idle, walk, run,
// strafes, backpedal, turns, shoot, swap, hit, win and death (no throw, no
// NaN, blend weights per group sum to 1, barrel on the laser, no pops).
// Fun pass: the real world (character loaded) through a level-5 session
// (wall rollers, ticking + a detonation lurch, armored, a dodge roll, every
// pickup kind incl. MEGA and LIGHTNING, FEVER), a level-3 boss fight to the
// kill (shield, phases, Mk I spit, defeat beat + chain shatter), a
// counter-rotating double ring (L8) and a busy boss moment (L6 phase 2 in
// fever with 2 rollers and 2 pickups) on both quality tiers: no throw, no
// NaN, draw calls within the spec budget (<= 52, low <= 46) and a frame-time
// sanity check.
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
import { countDraws } from "../src/render/arena/drawStats";
import { updateSettings } from "../src/ui/settings";
import { InstancedMesh, Mesh } from "three";

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
      if (stats.frames > 2 && ch.animator.mode === "play" && label !== "win" && label !== "lose" && step > stats.maxPop) {
        stats.maxPop = step;
        stats.popAt = `${b.name} in ${label}`;
      }
      prevQ[i].copy(q);
      if (!Number.isFinite(q.x + q.y + q.z + q.w) || !Number.isFinite(b.position.x + b.position.y + b.position.z)) stats.nan = true;
    });
    // foot sliding: horizontal drift of the left foot while planted (ankle
    // bone within 2 cm of its lowest height), after 0.5 s in a phase
    foot.getWorldPosition(footW);
    if (footW.y < 0.045 && phaseT > 0.5 && label !== "win" && label !== "lose") {
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
  label = "lose";
  // death on the next level, through the real lose sequence (fast creep,
  // FX timing, hit-stop): he falls, stays down for 4 s, and no bone jumps
  world.restart();
  engine.newGame();
  world.playing = true;
  for (let i = 0; i < 30; i++) frame(false);
  (engine as unknown as { creepBase: number }).creepBase = 3;
  engine.setCreepPaused(false);
  for (let i = 0; i < 600 && engine.getPhase() === "playing"; i++) frame(false);
  assert(engine.getPhase() === "gameOver", "character session lost");
  world.playing = false;
  // the hit-stop holds the sim for 150 ms of real time; headless frames are
  // far faster than that, so let it pass
  for (const until = Date.now() + 200; Date.now() < until; );
  const hipsBone = bones.find((b) => b.name === "Hips")!;
  const hipsW = new Vector3();
  const wq = bones.map((b) => b.getWorldQuaternion(new Quaternion()));
  let loseStep = 0;
  let loseAt = "";
  let lowFrom = -1;
  let maxHipsAfter = 0;
  for (let i = 0; i < Math.round(6 * 60); i++) {
    frame(false);
    bones.forEach((b, k) => {
      b.getWorldQuaternion(q);
      const st = (q.angleTo(wq[k]) * 180) / Math.PI;
      if (st > loseStep) {
        loseStep = st;
        loseAt = `${b.name} @${(i / 60).toFixed(2)}s`;
      }
      wq[k].copy(q);
    });
    const hy = hipsBone.getWorldPosition(hipsW).y;
    if (lowFrom < 0 && hy < 0.2) lowFrom = i; // landed
    if (lowFrom >= 0) maxHipsAfter = Math.max(maxHipsAfter, hy);
  }
  const lowFor = lowFrom < 0 ? 0 : (Math.round(6 * 60) - lowFrom) / 60;
  assert(lowFor >= 4 && maxHipsAfter < 0.3, `dead: hips stay below 0.3 for ${lowFor.toFixed(1)} s (max ${maxHipsAfter.toFixed(2)})`);
  assert(loseStep <= 20, `lose sequence: max bone step ${loseStep.toFixed(1)} deg / frame (<= 20, ${loseAt})`);
  console.log(`  ok  character death: down after ${(lowFrom / 60).toFixed(2)} s, hips max ${maxHipsAfter.toFixed(2)} for ${lowFor.toFixed(1)} s, max bone step ${loseStep.toFixed(1)} deg (${loseAt})`);
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

// ---- Fun pass sessions ----------------------------------------------------------
interface FunStats { maxDraws: number; maxLowDraws: number; frames: number; ms: number[] }
const fun: FunStats = { maxDraws: 0, maxLowDraws: 0, frames: 0, ms: [] };

function finiteScene(world: ArenaWorld, camera: PerspectiveCamera, where: string) {
  assert(Number.isFinite(camera.position.x + camera.position.y + camera.position.z + camera.fov), `${where}: camera finite`);
  world.root.traverse((o) => {
    const im = o as InstancedMesh;
    if (im.isInstancedMesh && im.visible) {
      const a = im.instanceMatrix.array;
      for (let i = 0; i < im.count * 16; i++) if (!Number.isFinite(a[i])) throw new Error(`ASSERT: ${where}: NaN in ${im.name || im.geometry.type} instance ${Math.floor(i / 16)}`);
    }
    const m = o as Mesh;
    if (m.isMesh && m.visible && !Number.isFinite(m.position.x + m.position.y + m.position.z + m.scale.x)) {
      throw new Error(`ASSERT: ${where}: NaN transform on ${m.name || m.geometry.type}`);
    }
  });
}

async function funSession(
  name: string, level: number, seed: number, frames: number,
  drive: (e: ArenaEngine, w: ArenaWorld, i: number) => void, until?: (e: ArenaEngine) => boolean,
) {
  const engine = new ArenaEngine({ random: mulberry32(seed) });
  const controls = new ArenaControls();
  const world = new ArenaWorld(engine, controls, getSimClock(engine), getFxBus(engine));
  await world.loadCharacter(bytes);
  assert(world.avatarKind === "character", `${name}: character loaded`);
  world.setSkin({ trim: "#FF3DCB", cannon: "#FFD23F", plates: "#B8C2D9" });
  const camera = new PerspectiveCamera(50, W / H, 1, 5000);
  world.setSize(W, H);
  world.radarRect = { x: W - 156, y: 16, size: 140 };
  engine.newGame({ level });
  world.restart();
  world.startIntro();
  world.chase.skipIntro();
  world.playing = true;
  controls.enabled = true;
  engine.setCreepPaused(false);
  const events: Record<string, number> = {};
  const names = [
    "pickupSpawned", "pickupCollected", "megaBlast", "lightningChain", "freezeStart", "feverStart", "feverEnd", "armorBroken", "tickingArmed",
    "tickingExploded", "lurch", "rollerTelegraph", "rollerLaunched", "rollerDestroyed", "playerHit", "rollStart", "rollEnd", "bossShieldPop",
    "bossHit", "bossPhase", "bossDefeated", "levelStars", "slowMo",
  ] as const;
  const offs = names.map((n) => engine.on(n, () => (events[n] = (events[n] ?? 0) + 1)));
  let i = 0;
  for (; i < frames; i++) {
    if (engine.getPhase() === "playing") drive(engine, world, i);
    const t0 = performance.now();
    world.frame(camera, DT, 1);
    fun.ms.push(performance.now() - t0);
    renderArenaFrame(gl, world.root, camera, world.radar, world.radarRect, { width: W, height: H });
    if (i % 20 === 0) {
      finiteScene(world, camera, `${name} frame ${i}`);
      const draws = countDraws(world.root) + countDraws(world.radar.scene);
      fun.maxDraws = Math.max(fun.maxDraws, draws);
      assert(draws <= 52, `${name} frame ${i}: ${draws} draw calls (budget 52)`);
    }
    if (until?.(engine)) break;
  }
  fun.frames += i;
  offs.forEach((off) => off());
  return { engine, world, camera, events, frames: i };
}

// simple bot: aim at the nearest target (roller first, else an idle bomb), fire when ready
function bot(e: ArenaEngine) {
  const s = e.getShooter();
  const r = e.getRollers()[0];
  if (r) {
    e.aimAt(r.x, r.z);
    e.fire();
    return;
  }
  if (s.cooldown > 0) return;
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (const b of e.getBombs()) {
    const d = Math.hypot(b.x - s.x, b.z - s.z);
    if (b.state === "idle" && b.colorIndex === e.getCurrentBomb() && d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (best) e.aimAt(best.x, best.z);
  e.fire();
}

async function funRuns() {
  // L5: rollers, ticking, armored, roll, every pickup, fever
  updateSettings({ quality: "high" }, false);
  const l5 = await funSession("L5", 5, 11, 60 * 40, (e, w, i) => {
    const s = e.getShooter();
    const ahead = (d: number) => [s.x + Math.cos(s.yaw) * d, s.z + Math.sin(s.yaw) * d] as const;
    if (i === 30) w.debug.armTicking();
    if (i === 40) w.debug.launchRoller(undefined, 0.7);
    if (i === 140) w.debug.roll(0, 0);
    if (i === 300) e.debugSpawnPickup("mega", s.x, s.z);
    if (i === 302) {
      e.aimAt(e.getBombs()[0].x, e.getBombs()[0].z);
      e.fire();
    }
    if (i === 420) e.debugSpawnPickup("lightning", s.x, s.z);
    if (i === 422) {
      const b = e.getBombs().find((q) => q.state === "idle");
      if (b) e.aimAt(b.x, b.z);
      e.fire();
    }
    if (i === 520) e.debugSpawnPickup("freeze", s.x, s.z);
    if (i === 600) {
      const [x, z] = ahead(2.5);
      e.debugSpawnPickup("rainbow", x, z); // flies nowhere (debug): sits on the floor
    }
    if (i === 700) w.debug.setFever(100);
    if (i === 900) w.debug.launchRoller();
    if (i > 700 && i < 1100) e.setFireHeld(true);
    if (i === 1100) e.setFireHeld(false);
    if (i > 1100 && i % 4 === 0) bot(e);
    if (i > 1300 && i % 10 === 0) e.roll(Math.cos(i), Math.sin(i));
    if (i === 1500) w.debug.armTicking();
    if (i < 700 && i > 160 && i % 12 === 0 && i % 100 > 10) bot(e);
  }, (e) => e.getPhase() !== "playing");
  const ev5 = l5.events;
  for (const k of ["rollerLaunched", "rollStart", "rollEnd", "megaBlast", "lightningChain", "freezeStart", "feverStart", "tickingArmed", "pickupCollected"]) {
    assert((ev5[k] ?? 0) > 0, `L5 session saw ${k} (${JSON.stringify(ev5)})`);
  }
  const ch5 = l5.world.character!;
  assert(ch5.animator.hasRoll, "the Roll clip was found");
  console.log(`  ok  fun L5: ${l5.frames} frames -> ${l5.engine.getPhase()}, events ${JSON.stringify(ev5)}`);
  // detonation + lurch: arm one and run its timer out with nobody shooting
  const lurch = await funSession("L5 lurch", 5, 12, 60 * 30, (e, w, i) => {
    if (i === 5) w.debug.armTicking();
  }, (e) => (e.getBombs().every((b) => !(b.kind === "ticking" && b.armed)) && e.getTime() > 2));
  assert((lurch.events.tickingExploded ?? 0) > 0 && (lurch.events.lurch ?? 0) > 0, `ticking bomb detonated + lurched (${JSON.stringify(lurch.events)})`);
  console.log(`  ok  fun lurch: detonation after ${(lurch.frames / 60).toFixed(1)} s`);
  // the roller hits a player who stands still: knock-back, stun stars, HitRecieve
  const hit = await funSession("L5 hit", 5, 13, 60 * 8, (e, w, i) => {
    if (i === 5) w.debug.launchRoller(undefined, 1);
  }, (e) => e.getStun() > 0);
  assert((hit.events.playerHit ?? 0) > 0, `roller hit the player (${JSON.stringify(hit.events)})`);
  for (let k = 0; k < 40; k++) {
    hit.world.frame(hit.camera, DT, 1);
    finiteScene(hit.world, hit.camera, "after hit");
  }
  console.log("  ok  fun player hit: knock-back + stun");

  // L3 boss: shield pops, phases (Mk I spit), core hits, defeat
  const boss = await funSession("L3 boss", 3, 21, 60 * 90, (e, w, i) => {
    const b = e.getBoss();
    if (!b) return;
    if (i === 240) w.debug.setBossHp(Math.floor(b.maxHp * 0.55)); // phase 2: spit every 12 s
    if (i === 60 * 16) w.debug.setBossHp(Math.floor(b.maxHp * 0.2)); // phase 3: shield shatters
    // aim at a shield bomb of the current colour, else at the core
    const s = e.getShooter();
    const sh = b.shield.find((q) => q.colorIndex === e.getCurrentBomb() && q.scale >= 1);
    if (sh) {
      const lead = Math.hypot(sh.x - s.x, sh.z - s.z) / 18;
      const a = sh.angle + b.orbitSpeed * lead;
      e.aimAt(b.x + Math.cos(a) * b.shieldRadius, b.z + Math.sin(a) * b.shieldRadius);
    } else e.aimAt(b.x, b.z);
    if (i % 16 === 0) e.fire();
  }, (e) => e.getPhase() === "won" && !!e.getBoss());
  for (let k = 0; k < 240; k++) {
    boss.world.frame(boss.camera, DT, 1);
    renderArenaFrame(gl, boss.world.root, boss.camera, boss.world.radar, boss.world.radarRect, { width: W, height: H });
    if (k % 20 === 0) finiteScene(boss.world, boss.camera, `boss end ${k}`);
  }
  const evb = boss.events;
  assert(boss.engine.getPhase() === "won", `boss defeated (${boss.engine.getPhase()}, hp ${boss.engine.getBoss()?.hp}, events ${JSON.stringify(evb)})`);
  for (const k of ["bossHit", "bossPhase", "bossDefeated", "levelStars"]) assert((evb[k] ?? 0) > 0, `boss session saw ${k}`);
  console.log(`  ok  fun L3 boss: defeated after ${(boss.frames / 60).toFixed(1)} s, events ${JSON.stringify(evb)}`);

  // L8: counter-rotating double ring
  const dbl = await funSession("L8 double ring", 8, 31, 60 * 20, (e, w, i) => {
    if (i % 10 === 0) bot(e);
  });
  assert(dbl.engine.getLevelDef().doubleRing, "L8 is a double ring");
  console.log(`  ok  fun L8 double ring: ${dbl.frames} frames -> ${dbl.engine.getPhase()}`);

  // busy: L6 boss in phase 2, fever, 2 rollers, 2 pickups, on both tiers
  for (const q of ["high", "low"] as const) {
    updateSettings({ quality: q }, false);
    let peak = 0;
    let busyAt = "";
    const busy = await funSession(`busy ${q}`, 6, 41, 60 * 3, (e, w, i) => {
      const b = e.getBoss();
      const s = e.getShooter();
      if (i === 2 && b) w.debug.setBossHp(Math.floor(b.maxHp * 0.55));
      if (i === 4) {
        e.debugSpawnPickup("rainbow", s.x + 2.2, s.z + 1.5);
        e.debugSpawnPickup("freeze", s.x - 2.2, s.z + 1.5);
      }
      if (i === 6) w.debug.setFever(100);
      if (i === 8 || i === 10) {
        // two different inner-face bombs (the default pick would repeat)
        const inner = e.getBombs().filter((q) => q.state === "idle" && q.telegraph < 0).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
        w.debug.launchRoller(inner[i === 8 ? 0 : 6].id, 0.2);
      }
      if (i > 10) e.setFireHeld(true);
      // measure once both rollers roll (telegraph 1 s), fever on, boss up
      if (i >= 75 && e.getRollers().length >= 2 && e.getFever().active) {
        const d = countDraws(w.root) + countDraws(w.radar.scene);
        if (d > peak) {
          peak = d;
          busyAt = `frame ${i}: fever on, ${e.getRollers().length} rollers, ${e.getPickups().length} pickups, ${e.getShots().length} shots, boss P${e.getBoss()?.phase}`;
        }
      }
    });
    assert(peak > 0, `busy ${q}: reached the busy moment (fever + 2 rollers)`);
    const budget = q === "low" ? 46 : 52;
    assert(peak <= budget, `busy ${q}: ${peak} draw calls (budget ${budget})`);
    if (q === "low") fun.maxLowDraws = peak;
    console.log(`  ok  fun busy (${q}): ${busyAt} -> ${peak} draws (budget ${budget})`);
    void busy;
  }
  updateSettings({ quality: "high" }, false);

  const ms = fun.ms.slice(30).sort((a, b) => a - b);
  const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
  const p95 = ms[Math.floor(ms.length * 0.95)];
  assert(avg < 8 && p95 < 16, `frame time: avg ${avg.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms (headless JS, avg < 8, p95 < 16)`);
  console.log(`  ok  fun frames ${fun.frames}: max ${fun.maxDraws} draws (low tier ${fun.maxLowDraws}), world.frame avg ${avg.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
}

characterRun()
  .then(funRuns)
  .then(() => console.log(`arena smoke: OK (${stats.draws} draws, ${stats.presents} presents, no throw)`))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
