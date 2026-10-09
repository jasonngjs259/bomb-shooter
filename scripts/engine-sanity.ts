// Headless sanity check for the GameEngine: `npx tsx scripts/engine-sanity.ts`
// Plays seeded games with random aim and asserts the core loop behaves.

import { BOARD_CONFIG, MUZZLE_OFFSET } from "../src/game/constants";
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

// Launch point = muzzle: the loaded bomb sits there, the aim path starts
// there, the shot leaves from exactly there (no jump), and it lands on the
// predicted ghost cell - including aims right next to both walls.
{
  let checked = 0;
  for (const seed of [3, 7, 11, 19, 23, 29]) {
    const g = new GameEngine({ random: mulberry32(seed) });
    g.newGame();
    for (const angle of [8, 12, 35, 60, 90, 118, 150, 168, 172]) {
      if (g.getPhase() !== "ready") break;
      g.setAngle(angle);
      const s = g.getShooter();
      const mz = g.getMuzzle();
      assert(Math.abs(Math.hypot(mz.x - s.x, mz.y - s.y) - MUZZLE_OFFSET) < 1e-9, "muzzle is MUZZLE_OFFSET from the launcher");
      const ang = (Math.atan2(s.y - mz.y, mz.x - s.x) * 180) / Math.PI;
      assert(Math.abs(ang - angle) < 1e-9, "muzzle lies on the aim line");
      const loaded = g.getBomb();
      assert(loaded.x === mz.x && loaded.y === mz.y && !loaded.inFlight, "loaded bomb sits in the muzzle");
      const path = g.getAimPath();
      assert(path.points[0].x === mz.x && path.points[0].y === mz.y, "aim path starts at the muzzle");
      let snapped: { col: number; row: number } | null = null;
      let shotAt: { x: number; y: number } | null = null;
      const offs = [g.on("snap", (p) => (snapped = { col: p.col, row: p.row })), g.on("shoot", (p) => (shotAt = { x: p.x, y: p.y }))];
      assert(g.fire(), "fire");
      const fb = g.getBomb();
      assert(fb.inFlight && fb.x === mz.x && fb.y === mz.y, "shot starts exactly at the loaded position");
      const sp = shotAt as { x: number; y: number } | null;
      assert(sp !== null && sp.x === mz.x && sp.y === mz.y, "shoot event at the muzzle");
      for (let i = 0; i < 600 && g.getPhase() === "shooting"; i++) g.update(1 / 60);
      offs.forEach((off) => off());
      const sn = snapped as { col: number; row: number } | null;
      if (path.target && sn) {
        assert(sn.col === path.target.col && sn.row === path.target.row, `seed ${seed} angle ${angle}: lands on the ghost`);
        checked++;
      }
      for (let i = 0; i < 600 && g.getPhase() === "resolving"; i++) g.update(1 / 60);
    }
  }
  assert(checked >= 20, `ghost landings checked (${checked})`);
  console.log(`launch point: OK, ${checked} shots landed on the ghost (aims 8..172 deg incl. near walls)`);
}

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
