// Headless sanity check for the GameEngine: `npx tsx scripts/engine-sanity.ts`
// Plays seeded games with random aim and asserts the core loop behaves.

import { BOARD_CONFIG } from "../src/game/constants";
import { GameEngine } from "../src/game/engine";
import { getBaseScore } from "../src/game/grid";

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};

// Deterministic RNG so failures are reproducible
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const playGame = (seed: number) => {
  const rand = mulberry32(seed);
  const engine = new GameEngine({ random: rand });
  const counts = { shoot: 0, snap: 0, pop: 0, drop: 0, ceiling: 0, bounce: 0, swap: 0 };
  engine.on("shoot", () => counts.shoot++);
  engine.on("snap", () => counts.snap++);
  engine.on("pop", (e) => {
    counts.pop++;
    assert(e.score > 0 && e.tiles.length >= 3 && e.combo >= 1, "pop payload");
  });
  engine.on("drop", () => counts.drop++);
  engine.on("ceilingDrop", () => counts.ceiling++);
  engine.on("wallBounce", () => counts.bounce++);
  engine.on("swap", () => counts.swap++);

  assert(engine.getPhase() === "title", "starts on title");
  assert(engine.getTiles().length === 11 * 5, "5 filled rows of 11");
  engine.newGame();
  assert(engine.getPhase() === "ready", "ready after newGame");

  // Huge first dt must be clamped (no teleporting bomb)
  engine.update(1000);

  let shots = 0;
  while (shots < 300) {
    const phase = engine.getPhase();
    if (phase === "gameOver" || phase === "won") break;
    if (phase === "ready") {
      engine.setAngle(20 + rand() * 140);
      const path = engine.getAimPath();
      assert(path.points.length >= 2, "aim path has points");
      if (shots % 7 === 0) engine.swapBomb();
      assert(engine.fire(), "fire accepted when ready");
      assert(!engine.fire(), "fire rejected while shooting");
      shots++;
    }
    engine.update(1 / 60);
  }
  const m = engine.getBoardMetrics();
  const danger = engine.getDangerLevel();
  assert(danger >= 0 && danger <= 1, "danger in range");
  for (const t of engine.getTiles()) {
    assert(t.x > 0 && t.x < m.width && t.y > 0 && t.y < m.gridHeight, "tile inside board");
  }
  return { seed, phase: engine.getPhase(), shots, score: engine.getScore(), ceilingRows: engine.getCeilingRows().length, ...counts };
};

const results = [1, 2, 3, 4, 5, 42, 1337].map(playGame);
console.table(results);
for (const r of results) {
  assert(r.phase === "gameOver" || r.phase === "won", `seed ${r.seed} finished`);
  assert(r.snap === r.shoot, `seed ${r.seed} every shot snapped`);
}
assert(results.some((r) => r.pop > 0 && r.score > 0), "some game scored");
assert(results.some((r) => r.ceiling > 0), "ceiling dropped");
assert(results.some((r) => r.bounce > 0), "walls bounced");

// Aim clamping
const e = new GameEngine();
e.aimAt(e.getShooter().x - 100, e.getShooter().y + 50); // below-left
assert(e.getAimAngle() === 172, "clamped left");
e.aimAt(e.getShooter().x + 100, e.getShooter().y + 50); // below-right
assert(e.getAimAngle() === 8, "clamped right");
e.aimAt(e.getShooter().x, 0);
assert(e.getAimAngle() === 90, "straight up");
console.log("engine sanity: OK");

// Win state: a one-colour board clears with a single shot
const w = new GameEngine({ config: { ...BOARD_CONFIG, colorCount: 1, initialRows: 2 } });
let wonFired = false;
w.on("won", () => (wonFired = true));
w.newGame();
w.fire();
for (let i = 0; i < 600 && w.getPhase() !== "won"; i++) w.update(1 / 60);
assert(w.getPhase() === "won" && wonFired, "board cleared -> won");
// 22 board tiles + the shot, combo x1, nothing dropped
assert(w.getScore() === getBaseScore(23), `single-shot clear score (got ${w.getScore()})`);
console.log("win state: OK, score", w.getScore());
