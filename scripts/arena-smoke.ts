// Headless smoke for the Arena frame driver: builds the real ArenaWorld
// (every three.js object, FX, stickman, camera, radar) and runs it with a
// stub renderer through the intro sweep, play, a win (+ celebration) and a
// loss (+ lose sequence), asserting nothing throws and every frame renders
// the two passes with exactly one present (the radar pass).
// Run: npx tsx --tsconfig scripts/smoke/tsconfig.json scripts/arena-smoke.ts

import { Camera, Object3D, PerspectiveCamera } from "three";
import { ArenaControls } from "../src/arena/ArenaControls";
import { ArenaEngine } from "../src/game/arena";
import { getSimClock } from "../src/game/clock";
import { getFxBus } from "../src/fx/bus";
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

function session(name: string, config: ConstructorParameters<typeof ArenaEngine>[0], drive: (e: ArenaEngine) => void) {
  const engine = new ArenaEngine(config);
  const controls = new ArenaControls();
  const world = new ArenaWorld(engine, controls, getSimClock(engine), getFxBus(engine));
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

console.log(`arena smoke: OK (${stats.draws} draws, ${stats.presents} presents, no throw)`);
