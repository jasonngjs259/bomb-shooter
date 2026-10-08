// Headless sanity check for the Arena 360 engine: `npx tsx scripts/arena-sanity.ts`
// Seeded simulations that assert the core rules and print tuning numbers.

import { ArenaEngine, ArenaBomb, ArenaConfig } from "../src/game/arena";
import { maxOverlap } from "../src/game/arena/arenaPhysics";

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
const DT = 1 / 60;
const make = (seed: number, config?: Partial<ArenaConfig>) => new ArenaEngine({ random: mulberry32(seed), config });
const idle = (e: ArenaEngine) => e.getBombs().filter((b) => b.state === "idle");
const radial = (b: { x: number; z: number }) => Math.hypot(b.x, b.z);
const run = (e: ArenaEngine, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT) && e.getPhase() === "playing"; i++) e.update(DT);
};
const ok = (name: string, extra = "") => console.log(`  ok  ${name}${extra ? `  (${extra})` : ""}`);

// ---- 1. Field layout ---------------------------------------------------------
{
  for (const seed of [1, 2, 3, 4, 5, 42, 1337]) {
    const e = make(seed);
    assert(e.getPhase() === "title", "starts on title");
    e.newGame({ level: 1 });
    assert(e.getPhase() === "playing", "playing after newGame");
    const c = e.getConfig();
    const bombs = idle(e);
    assert(bombs.length === c.firstLevelBombs && e.getRemaining() === bombs.length, "level 1 bomb count (easier first level)");
    const sectors = new Set(bombs.map((b) => Math.floor(((Math.atan2(b.z, b.x) + Math.PI) / (Math.PI * 2)) * 8) % 8));
    assert(sectors.size === 8, `seed ${seed}: field covers all 8 45-deg sectors (got ${sectors.size})`);
    assert(bombs.every((b) => radial(b) - c.bombRadius > c.arenaRadius + 3), "field starts well outside the arena");
    assert(maxOverlap(bombs, c.bombRadius) < 0.02, "initial layout has no overlap");
    assert(new Set(bombs.map((b) => b.id)).size === bombs.length, "unique ids");
  }
  const e8 = make(7);
  e8.newGame({ level: 6 });
  assert(e8.getRemaining() === 150, "level 6 hits the 150-bomb cap");
  e8.newGame({ level: 12 });
  assert(e8.getRemaining() === 150 && e8.getLevel() === 12, "cap holds at level 12");
  ok(`field generated around 360 deg, ${make(1).getRemaining()} bombs at L1, 150 cap from L6`);
}

// ---- 2. Creep, relaxation, determinism, dt clamp, creep pause ---------------
{
  const e = make(3);
  e.newGame({ level: 2 }); // tuned creep (level 1 is the easier intro level)
  const before = idle(e).reduce((s, b) => s + radial(b), 0) / e.getRemaining();
  e.update(1000);
  assert(e.getTime() <= 1 / 30 + 1e-9, "dt clamped to 1/30");
  run(e, 5);
  const after = idle(e).reduce((s, b) => s + radial(b), 0) / e.getRemaining();
  assert(after < before - 0.2, `creep moves bombs inward (${before.toFixed(2)} -> ${after.toFixed(2)})`);
  run(e, 40);
  const ov = maxOverlap(idle(e), e.getConfig().bombRadius);
  assert(ov < 0.05, `relaxation keeps overlap small (max ${ov.toFixed(4)})`);
  ok("creep inward + no overlap", `mean radius ${before.toFixed(2)} -> ${after.toFixed(2)} in 5s, max overlap after 45s ${ov.toFixed(4)}`);

  const a = make(9), b = make(9);
  a.newGame(); b.newGame();
  run(a, 20); run(b, 20);
  assert(JSON.stringify(a.getBombs()) === JSON.stringify(b.getBombs()), "deterministic for a seed");

  const p = make(4);
  p.newGame();
  p.setCreepPaused(true);
  const snap = idle(p).map((x) => radial(x));
  run(p, 10);
  assert(idle(p).every((x, i) => Math.abs(radial(x) - snap[i]) < 1e-6), "creep paused: no movement");
  assert(p.fire(), "creep paused: firing still works");
  p.setCreepPaused(false);
  run(p, 2);
  assert(idle(p)[0] && radial(idle(p)[0]) < snap[0], "creep resumes");
  const s1 = p.getDangerByAngle(16), s2 = p.getDangerByAngle(16);
  assert(s1 === s2 && s1.length === 16, "getDangerByAngle reuses its array");
  ok("determinism, dt clamp, setCreepPaused, allocation-free danger sectors");
}

// ---- 3. Shooter clamp + fire cooldown ----------------------------------------
{
  const e = make(5, { fireCooldown: 1 });
  e.newGame();
  const c = e.getConfig();
  e.setMoveInput(3, 0); // magnitude clamped to 1
  run(e, 4);
  const s = e.getShooter();
  assert(Math.abs(radial(s) - (c.arenaRadius - c.shooterRadius)) < 1e-6, "shooter clamped at the border");
  assert(Math.abs(s.vx) < 1e-6 || s.vx <= 0, "outward velocity removed at the border");
  e.setMoveInput(0, 0);
  run(e, 1);
  assert(!e.getShooter().moving, "decelerates to a stop");
  // Fire at the nearest bomb: it resolves well within the 1 s cooldown
  const near = idle(e).sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
  e.aimAt(near.x, near.z);
  const predicted = e.getAimRay().hitBombId;
  let stuckOn = -1;
  e.on("stick", (ev) => (stuckOn = ev.hitId));
  assert(e.fire(), "first fire accepted");
  assert(!e.fire(), "second fire rejected while in flight");
  let t = 0;
  while (e.getShot() && t < 2) { e.update(DT); t += DT; }
  assert(stuckOn === predicted && stuckOn >= 0, `shot sticks to the aimed bomb (${stuckOn} vs ${predicted})`);
  assert(t < 0.9 && !e.fire(), "fire rejected during cooldown even with no shot in flight");
  run(e, 1 - t + 0.05);
  assert(e.fire(), "fire accepted after cooldown");
  ok("shooter clamped, shot sticks to the aimed bomb, cooldown respected", `hit after ${t.toFixed(2)}s`);
}

// ---- 4. Idle -> game over -------------------------------------------------------
const idleTimes: number[] = [];
{
  for (const seed of [1, 2, 3, 4, 5, 42, 1337]) {
    const e = make(seed);
    let over: { x: number; z: number; angle: number } | null = null;
    let tiers = 0;
    e.on("gameOver", (g) => (over = g));
    e.on("dangerChanged", () => tiers++);
    e.newGame();
    run(e, 400);
    assert(e.getPhase() === "gameOver" && over, `seed ${seed}: idle play ends in gameOver`);
    const g = over as unknown as { x: number; z: number; angle: number };
    assert(Math.abs(Math.atan2(g.z, g.x) - g.angle) < 1e-9, "gameOver angle matches position");
    assert(radial(g) - e.getConfig().bombRadius <= e.getConfig().arenaRadius + 1e-9, "touching bomb is on the border");
    assert(e.getDangerLevel() === 1 && tiers >= 4, "danger ramps to 1 through every tier");
    idleTimes.push(e.getTime());
  }
  const avg = idleTimes.reduce((a, b) => a + b, 0) / idleTimes.length;
  ok("idle -> gameOver with border angle", `time ${Math.min(...idleTimes).toFixed(1)}..${Math.max(...idleTimes).toFixed(1)}s, mean ${avg.toFixed(1)}s`);
}

// ---- 5. Aimbot: pops, shatter, knock-back, wins ------------------------------
interface BotResult { seed: number; phase: string; time: number; shots: number; pops: number; shattered: number; score: number; maxCombo: number; predictOk: number; predictTotal: number }

// human = turn at most 150 deg/s (via turn()) and decide at most every 1.2 s.
function aimbot(seed: number, human = false, level = 1, pace = 1.2, turnDeg = 150): BotResult {
  const e = make(seed);
  const c = e.getConfig();
  const r: BotResult = { seed, phase: "", time: 0, shots: 0, pops: 0, shattered: 0, score: 0, maxCombo: 0, predictOk: 0, predictTotal: 0 };
  let predicted: number[] = [];
  let knock: { ids: number[]; radii: number[]; frame: number } | null = null;
  let frames = 0;
  const knockDeltas: number[] = [];
  e.on("pop", (p) => {
    r.pops++;
    r.maxCombo = Math.max(r.maxCombo, p.combo);
    assert(p.bombs.length >= c.minMatch && p.score > 0, "pop payload");
    const popped = new Set(p.bombs.map((b) => b.id));
    if (predicted.length > 0) {
      r.predictTotal++;
      if (predicted.every((id) => popped.has(id))) r.predictOk++;
    }
    const near = idle(e).filter((b) => Math.hypot(b.x - p.centre.x, b.z - p.centre.z) < 1.6);
    if (!knock && near.length > 0) knock = { ids: near.map((b) => b.id), radii: near.map(radial), frame: frames };
  });
  e.on("shatter", (s) => (r.shattered += s.bombs.length));
  e.newGame({ level });

  const usefulHit = (wantPop: boolean) => {
    const s = e.getShooter();
    const cands = idle(e).filter((b) => b.colorIndex === e.getCurrentBomb())
      .sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
    for (const b of cands.slice(0, 12)) {
      e.aimAt(b.x, b.z);
      const ray = e.getAimRay();
      if (wantPop ? ray.wouldPopIds.length > 0 : ray.hitBombId === b.id) return { target: b, ray };
    }
    return null;
  };

  let plan: { yaw: number; target: ArenaBomb | null; predicted: number[] } | null = null;
  let lastShot = -99;
  while (e.getPhase() === "playing" && frames < 60 * 300) {
    frames++;
    const s = e.getShooter();
    assert(radial(s) <= c.arenaRadius - c.shooterRadius + 1e-6, "bot shooter stays inside the arena");
    const ready = !e.getShot() && s.cooldown === 0 && (!human || e.getTime() - lastShot >= pace);
    if (ready && !plan) {
      const yaw0 = s.yaw;
      let pick = usefulHit(true);
      if (!pick) { e.swapBomb(); pick = usefulHit(true); }
      if (!pick) pick = usefulHit(false); // build a pair instead
      if (!pick) {
        // Nothing useful: discard into a gap if one exists
        for (let k = 0; k < 64; k++) {
          e.setYaw((k / 64) * Math.PI * 2);
          if (e.getAimRay().hitBombId === null) break;
        }
      }
      plan = { yaw: e.getShooter().yaw, target: pick ? pick.target : null, predicted: pick ? [...pick.ray.wouldPopIds] : [] };
      if (human) e.setYaw(yaw0); // a human has to turn there first
      const t = plan.target;
      // Walk toward far targets for better angles, otherwise drift to centre
      if (t && Math.hypot(t.x - s.x, t.z - s.z) > 6) e.setMoveInput(t.x - s.x, t.z - s.z);
      else e.setMoveInput(-s.x * 0.3, -s.z * 0.3);
    }
    if (plan) {
      let diff = plan.yaw - e.getShooter().yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const maxTurn = human ? (turnDeg * Math.PI / 180) * DT : Math.PI * 2;
      e.turn(Math.max(-maxTurn, Math.min(maxTurn, diff)));
      if (Math.abs(diff) <= maxTurn) {
        predicted = human ? [] : plan.predicted;
        if (e.fire()) { r.shots++; lastShot = e.getTime(); }
        plan = null;
      }
    }
    e.update(DT);
    if (knock) {
      const k: { ids: number[]; radii: number[]; frame: number } = knock;
      if (frames === k.frame + 15) {
        const now = new Map(idle(e).map((b) => [b.id, radial(b)] as const));
        k.ids.forEach((id, i) => { const v = now.get(id); if (v !== undefined) knockDeltas.push(v - k.radii[i]); });
      }
    }
  }
  if (knockDeltas.length > 0) {
    const mean = knockDeltas.reduce((a, b) => a + b, 0) / knockDeltas.length;
    assert(mean > 0, `knock-back pushes neighbours outward (mean ${mean.toFixed(3)})`);
  }
  return { ...r, phase: e.getPhase(), time: +e.getTime().toFixed(1), score: e.getScore() };
}

{
  const results = [1, 2, 3, 4, 5, 6, 7, 8, 42, 1337].map((s) => aimbot(s));
  console.log("  aimbot (instant aim):");
  console.table(results);
  for (const r of results) assert(r.phase === "won" || r.phase === "gameOver", `seed ${r.seed} finished`);
  const wins = results.filter((r) => r.phase === "won");
  assert(results.every((r) => r.pops > 0), "every bot game pops something");
  assert(results.some((r) => r.shattered > 0), "orphans shatter");
  assert(wins.length > 0, "aimbot clears level 1 in some seeds");
  const pt = results.reduce((a, r) => [a[0] + r.predictOk, a[1] + r.predictTotal], [0, 0]);
  assert(pt[0] / pt[1] > 0.9, "wouldPopIds predicts the popped group");
  const times = wins.map((w) => w.time).sort((a, b) => a - b);
  ok("aimbot", `${wins.length}/${results.length} won, clear time ${times[0]}..${times[times.length - 1]}s (median ${times[Math.floor(times.length / 2)]}s), wouldPop prediction ${pt[0]}/${pt[1]}`);
}

{
  // Human-like bots: turn rate capped, one decision per `pace` seconds.
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const report = (name: string, level: number, pace: number, turnDeg: number) => {
    const results = seeds.map((s) => aimbot(s, true, level, pace, turnDeg));
    const wins = results.filter((r) => r.phase === "won");
    const t = wins.map((w) => w.time).sort((a, b) => a - b);
    const lost = results.filter((r) => r.phase === "gameOver").map((r) => `${r.seed}@${r.time}s(${r.pops}p)`);
    console.log(`  ${name} L${level} (${turnDeg} deg/s turn, >=${pace} s/shot): ${wins.length}/${results.length} won` +
      (t.length ? `, clear ${t[0]}..${t[t.length - 1]}s median ${t[Math.floor(t.length / 2)]}s` : "") +
      (lost.length ? `; lost: ${lost.join(" ")}` : ""));
    return wins.length / results.length;
  };
  const l1 = report("human-ish bot", 1, 1.2, 150);
  const casual = report("casual bot", 1, 2.0, 110);
  report("human-ish bot", 2, 1.2, 150);
  assert(l1 >= 0.9 && casual >= 0.6, "level 1 is winnable for first-time players");
}

// ---- 6. Win state with a one-colour field -----------------------------------
{
  const e = make(11, { colorCount: 1, bombCount: 12, firstLevelBombs: 0, ringInner: 7, ringOuter: 8 });
  let won = false;
  e.on("won", () => (won = true));
  e.newGame();
  for (let i = 0; i < 60 * 60 && e.getPhase() === "playing"; i++) {
    if (!e.getShot()) {
      const b = idle(e)[0];
      e.aimAt(b.x, b.z);
      e.fire();
    }
    e.update(DT);
  }
  assert(e.getPhase() === "won" && won && e.getRemaining() === 0, "one-colour field clears -> won");
  ok("won when the field is empty", `score ${e.getScore()}`);
}

// ---- 6b. Deflect: a non-popping shot that would stick inside the border ----
{
  let checked = 0;
  for (const seed of [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]) {
    const e = make(seed, { ringInner: 7.1, ringOuter: 8.1, bombCount: 30, firstLevelBombs: 0 });
    e.newGame();
    e.setCreepPaused(true);
    run(e, 0.5); // let the tight test field settle (it can relax over the line)
    if (e.getPhase() !== "playing") continue;
    const c = e.getConfig();
    let target: ArenaBomb | null = null;
    for (const b of idle(e)) {
      e.aimAt(b.x, b.z);
      const ray = e.getAimRay();
      if (ray.landing && ray.wouldPopIds.length === 0 && radial(ray.landing) - c.bombRadius <= c.arenaRadius) {
        target = b;
        break;
      }
    }
    if (!target) continue;
    const remaining = e.getRemaining();
    const ids = new Set(e.getBombs().map((b) => b.id));
    let deflected = false;
    let lost = false;
    let stuckGap = Infinity;
    e.on("miss", (m) => (deflected = m.deflected === true));
    e.on("stick", (st) => (stuckGap = Math.hypot(st.x, st.z) - c.bombRadius - c.arenaRadius));
    e.on("gameOver", () => (lost = true));
    assert(e.fire(), "deflect: fired");
    for (let i = 0; i < 120 && e.getShot(); i++) e.update(DT);
    assert(!lost && e.getPhase() === "playing", `seed ${seed}: a shot near the border never ends the game`);
    if (!deflected) {
      // separation pushed it clear of the border: a normal stick is fine
      assert(stuckGap > 0, `seed ${seed}: shot either deflects or sticks outside the border`);
      continue;
    }
    assert(e.getRemaining() === remaining && e.getCombo() === 0, "deflected shot does not join the field");
    assert(e.getBombs().every((b) => ids.has(b.id)), "no new bomb added");
    checked++;
  }
  assert(checked >= 2, `deflect scenario found (${checked})`);
  ok("non-popping shot inside the border deflects (miss.deflected), only creep loses", `${checked} seeds`);
}

// ---- 7. Perf: 150 bombs --------------------------------------------------------
{
  const e = make(99);
  e.newGame({ level: 9 });
  for (let i = 0; i < 60; i++) e.update(DT); // warm up
  const n = 1200;
  const t0 = performance.now();
  for (let i = 0; i < n && e.getPhase() === "playing"; i++) {
    e.update(DT);
    e.getAimRay();
    e.getDangerByAngle(16);
  }
  const ms = (performance.now() - t0) / n;
  console.log(`  perf: ${e.getRemaining()} bombs, update+getAimRay+getDangerByAngle avg ${ms.toFixed(3)} ms/frame`);
  assert(ms < 4, "fast enough for 60fps");
}
console.log("arena sanity: OK");
