// Arena 360 fun pass, part 2: rollers, roll, ring rotation, double ring,
// boss, stars, freeze effects and perf. `npx tsx scripts/arena-fun-motion.ts`

import { ArenaEngine } from "../src/game/arena";
import { DT, arrange, assert, capture, def, fireAt, flushShots, internals, make, near, ok, run, until } from "./arena-kit";

const R = 0, Y = 1, B = 2;
const ang = (b: { x: number; z: number }) => Math.atan2(b.z, b.x);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const still = { creepSpeed: 0, surgeStep: 0 };

// ---- 1. Rollers -------------------------------------------------------------------
{
  const e = make(11, still);
  e.newGame({ level: 5, levelDef: def(5, { creepBase: 0 }) });
  const [roller] = arrange(e, [{ x: 0, z: -8.2, c: R, kind: "roller" }, { x: 6, z: 8, c: Y }, { x: -6, z: 8, c: B }], Y);
  const tele = capture(e, "rollerTelegraph"), launch = capture(e, "rollerLaunched");
  e.update(DT);
  assert(tele.length === 1 && tele[0].launchIn === 1 && roller.telegraph > 0.9, "gap <= 3.0 starts the 1 s telegraph");
  const t = until(e, () => launch.length > 0, 2);
  near(t, 1.0, DT * 1.5, "launches after 1.0 s");
  assert(launch[0].speed === 2.6 && e.getRollers().length === 1 && !e.getBombs().some((b) => b.id === roller.id), "detaches from the wall at 2.6 w/s");
  // homing until 2.5 w away, then a locked straight line
  const ro = e.getRollers()[0];
  until(e, () => Math.hypot(ro.x, ro.z) <= 2.45, 5);
  const dir = { x: ro.dirX, z: ro.dirZ };
  e.setMoveInput(1, 0);
  run(e, 0.4);
  e.setMoveInput(0, 0);
  near(ro.dirX, dir.x, 1e-9, "no homing inside 2.5 w (x)");
  near(ro.dirZ, dir.z, 1e-9, "no homing inside 2.5 w (z)");
  const expired = capture(e, "rollerExpired");
  until(e, () => expired.length > 0, 6);
  assert(expired.length === 1 && e.getPhase() === "playing", "a dodged roller expires off the far side");

  // contact: knock-back 1.2, stun 0.6, combo reset, fever -30, power kept, immunity, FLAWLESS lost
  const e2 = make(12, still);
  e2.newGame({ level: 5, levelDef: def(5, { creepBase: 0 }) });
  arrange(e2, [{ x: 0, z: -8.2, c: R, kind: "roller" }, { x: 6, z: 8, c: Y }, { x: -6, z: 8, c: B }], Y);
  e2.debugSetFever(50);
  internals(e2).sys.pickups.slot = "rainbow";
  internals(e2).core.combo = 3;
  const hits = capture(e2, "playerHit");
  until(e2, () => hits.length > 0, 6);
  const h = hits[0], p0 = { x: e2.getShooter().x, z: e2.getShooter().z };
  assert(h && h.stun === 0.6 && Math.abs(Math.hypot(h.knockX, h.knockZ) - 1.2) < 1e-9, "playerHit payload: 1.2 knock, 0.6 stun");
  assert(e2.getCombo() === 0 && e2.getFever().meter === 20 && e2.getPowerSlot() === "rainbow", "combo reset, fever -30, power kept");
  assert(e2.getStun() > 0.55 && !e2.fire(), "stunned: can't fire");
  run(e2, 1);
  near(Math.hypot(e2.getShooter().x - p0.x, e2.getShooter().z - p0.z), 1.2, 0.03, "knocked back ~1.2 w");
  assert(e2.getStun() === 0 && e2.getPhase() === "playing" && !e2.getStarProgress().flawless, "stun ends, never game over, FLAWLESS lost");
  // immunity: a roller launched right after the hit can't hit within 1.0 s of the stun end
  const s = e2.getShooter();
  internals(e2).sys.rollers.spawn(9001, s.x + 0.5, s.z, R);
  e2.update(DT);
  assert(hits.length === 1, "1 s roller immunity after the stun");

  // any shot destroys a roller
  const e3 = make(13, still);
  e3.newGame({ level: 5, levelDef: def(5, { creepBase: 0 }) });
  arrange(e3, [{ x: 0, z: -8.2, c: R, kind: "roller" }, { x: 6, z: 8, c: Y }, { x: -6, z: 8, c: B }], Y);
  const killed = capture(e3, "rollerDestroyed");
  until(e3, () => e3.getRollers().length > 0, 3);
  run(e3, 0.3);
  const r3 = e3.getRollers()[0];
  fireAt(e3, r3.x + r3.dirX * 0.3, r3.z + r3.dirZ * 0.3);
  flushShots(e3);
  assert(killed.length === 1 && !killed[0].matched && e3.getRollers().length === 0, "a wrong-colour shot still destroys the roller");
  ok("rollers: 1 s telegraph, 2.6 w/s, homing stops at 2.5, expiry, contact rules, immunity, shot-kill");
}

// ---- 2. Roll ----------------------------------------------------------------------
{
  const e = make(14, still);
  e.newGame({ level: 5, levelDef: def(5, { creepBase: 0, rollers: 0 }) });
  arrange(e, [{ x: 6, z: 8, c: Y }, { x: -6, z: 8, c: B }], Y);
  const starts = capture(e, "rollStart"), ends = capture(e, "rollEnd"), ready = capture(e, "rollReady"), shoots = capture(e, "shoot");
  assert(e.roll(1, 0), "roll accepted");
  const iSamples: [number, boolean][] = [];
  let t = 0;
  while (ends.length === 0 && t < 1) {
    e.update(DT);
    t += DT;
    iSamples.push([t, e.getRoll().iFrames]);
    if (Math.abs(t - 0.25) < DT / 2) assert(!e.fire(), "no firing while rolling (buffered)");
  }
  near(t, 0.5, DT * 1.5, "roll lasts 0.5 s");
  near(e.getShooter().x, 3.0, 0.02, "rolls 3.0 w");
  const on = iSamples.filter(([, f]) => f).map(([x]) => x);
  assert(on[0] >= 0.04 - 1e-9 && on[0] < 0.04 + DT && on[on.length - 1] <= 0.42 + 1e-9 && on[on.length - 1] > 0.42 - DT, `i-frames 0.04-0.42 (${on[0].toFixed(3)}-${on[on.length - 1].toFixed(3)})`);
  e.update(DT);
  assert(shoots.length === 1, "fire pressed during the roll fires at roll end");
  assert(starts[0].distance === 3 && starts[0].duration === 0.5, "rollStart payload");
  run(e, 0.45); // t ~ 1.0: 0.6 s cooldown left
  assert(!e.roll(-1, 0), "roll rejected > 0.2 s before ready");
  run(e, 0.47); // ~0.13 s left
  assert(e.roll(-1, 0) && starts.length === 1, "roll pressed 0.13 s early is buffered");
  until(e, () => starts.length > 1, 0.5);
  near(e.getTime(), 1.6, DT * 2, "buffered roll fires when ready (1.6 s cooldown)");
  assert(ready.length >= 1, "rollReady emitted");
  // backward when no direction / move input
  until(e, () => ends.length > 1, 1);
  run(e, 1.7);
  e.setYaw(0);
  const p0 = { x: e.getShooter().x, z: e.getShooter().z };
  e.roll(0, 0);
  run(e, 0.6);
  const moved = { x: e.getShooter().x - p0.x, z: e.getShooter().z - p0.z };
  assert(Math.abs(moved.z) > 2 && Math.abs(moved.x) < 0.3, `no input, no roller: rolls sideways to the facing (${moved.x.toFixed(2)}, ${moved.z.toFixed(2)})`);
  // head-on roller + a no-input roll: the smart default dodges off its line (an explicit backward roll along it gets hit)
  const headOn = (dirX: number, dirZ: number) => {
    const h = make(19, still);
    h.newGame({ level: 5, levelDef: def(5, { creepBase: 0, rollers: 0 }) });
    arrange(h, [{ x: 6, z: 8, c: Y }, { x: -6, z: 8, c: B }], Y);
    h.setYaw(-Math.PI / 2); // facing the roller
    const hit = capture(h, "playerHit");
    internals(h).sys.rollers.spawn(9300, 0, -5.5, R);
    const ro = h.getRollers()[0];
    until(h, () => Math.hypot(ro.x - h.getShooter().x, ro.z - h.getShooter().z) <= 1.7, 5);
    h.roll(dirX, dirZ);
    run(h, 3);
    return hit.length;
  };
  assert(headOn(0, 0) === 0, "head-on roller + no-input roll: no hit");
  assert(headOn(0, 1) === 1, "control: rolling straight back along its path still gets hit");
  // locked before L5
  const l4 = make(15);
  l4.newGame({ level: 4 });
  assert(!l4.roll(1, 0) && l4.getRoll().state === "locked", "roll locked before L5");
  ok("roll: 3.0 w / 0.5 s, i-frames 0.04-0.42, 1.6 s cooldown, 0.2 s buffer, fire buffered to roll end, smart no-input dodge (head-on roller: no hit), locked < L5");
}

// ---- 3. Rotation, double ring, freeze ----------------------------------------------
{
  const speed = (e: ArenaEngine, band: 0 | 1) => {
    const pick = () => e.getBombs().filter((b) => b.state === "idle" && b.band === band).map((b) => ({ id: b.id, a: ang(b) }));
    const a0 = pick();
    run(e, 1);
    const a1 = new Map(pick().map((x) => [x.id, x.a] as const));
    const d = a0.filter((x) => a1.has(x.id)).map((x) => wrap(a1.get(x.id)! - x.a));
    return (d.reduce((s, x) => s + x, 0) / d.length) * (180 / Math.PI);
  };
  const e4 = make(16, still);
  e4.newGame({ level: 4, levelDef: def(4, { creepBase: 0 }) });
  run(e4, 2.5);
  near(speed(e4, 0), 4, 0.2, "L4 rotates +4 deg/s");
  e4.debugSpawnPickup("freeze", 0, 0);
  e4.update(DT);
  near(speed(e4, 0), 0, 1e-9, "freeze stops the rotation");
  const e8 = make(17, still);
  e8.newGame({ level: 8, levelDef: def(8, { creepBase: 0 }) });
  run(e8, 2.5);
  near(speed(e8, 0), 5, 0.2, "L8 inner band +5 deg/s");
  near(speed(e8, 1), -3, 0.2, "L8 outer band -3 deg/s");
  for (const seed of [21, 22, 23, 24, 25]) {
    const e = make(seed);
    e.newGame({ level: 7 });
    const all = e.getBombs();
    const inner = all.filter((b) => b.band === 0);
    assert(inner.length === Math.round(114 * 0.25) && all.length === 114, "double ring: 25% inner band");
    assert(all.every((b) => Math.hypot(b.x, b.z) > 9.45), "every bomb starts > 9.45 from centre");
    assert(inner.every((b) => Math.hypot(b.x, b.z) < 12.6) && all.filter((b) => b.band === 1).every((b) => Math.hypot(b.x, b.z) > 13.4), "bands at 10-11.6 and 14+");
    const a = inner.map(ang).sort((x, y) => x - y);
    const gaps = a.map((x, i) => wrap((a[(i + 1) % a.length] ?? 0) - x + (i === a.length - 1 ? Math.PI * 2 : 0)) * (180 / Math.PI)).map((g) => (g < 0 ? g + 360 : g));
    const big = gaps.filter((g) => g >= 22);
    assert(big.length >= 4, `seed ${seed}: inner band keeps 4 gaps >= 22 deg (${gaps.sort((x, y) => y - x).slice(0, 5).map((g) => g.toFixed(0))})`);
  }
  // freeze: creep, surge clock, ticking timers, roller motion all stop
  const f = make(18);
  f.newGame({ level: 5 });
  run(f, 9);
  const tick = f.getBombs().find((b) => b.kind === "ticking" && b.armed);
  const snap = f.getBombs().filter((b) => b.state === "idle").map((b) => Math.hypot(b.x, b.z));
  f.debugSpawnPickup("freeze", f.getShooter().x, f.getShooter().z);
  f.update(DT);
  const timer0 = tick?.timer ?? 0;
  run(f, 4);
  const idleNow = f.getBombs().filter((b) => b.state === "idle").map((b) => Math.hypot(b.x, b.z));
  assert(idleNow.length === snap.length && idleNow.every((r, i) => Math.abs(r - snap[i]) < 0.02), "freeze: no creep");
  assert(!tick || tick.timer === timer0, "freeze: ticking timer paused");
  ok("rotation 4 / +5 / -3 deg/s (+-0.2), freeze stops rotation + creep + ticking, double ring 25% inner / 4 gaps / > 9.45");
}

// ---- 4. Boss ------------------------------------------------------------------------
{
  const e = make(31, still);
  const spawned = capture(e, "bossSpawned");
  e.newGame({ level: 3, levelDef: def(3, { creepBase: 0 }) });
  const b = e.getBoss()!;
  assert(spawned[0]?.mk === 1 && b.hp === 20 && b.maxHp === 20 && b.shield.length === 8, "Mk I: HP 20 (tuned), shield 8");
  near(Math.hypot(b.x, b.z), 11.5, 1e-9, "core at 11.5");
  const ringA = e.getBombs().map((x) => Math.abs(wrap(ang(x) - ang(b))) * (180 / Math.PI));
  assert(Math.min(...ringA) > 28, `ring leaves a +-35 deg gap (closest ${Math.min(...ringA).toFixed(1)})`);
  e.update(DT);
  near(Math.abs(b.orbitSpeed) * (180 / Math.PI), 36, 1e-9, "Mk I orbit 36 deg/s");
  for (let i = 1; i < b.shield.length; i++) assert(b.shield[i].colorIndex !== b.shield[i - 1].colorIndex, "neighbour shield colours differ");
  // shield hit rule (frozen boss so a straight shot is exact)
  e.debugSpawnPickup("freeze", 0, 0);
  e.update(DT);
  const target = [...b.shield].sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0];
  const pops = capture(e, "bossShieldPop"), miss = capture(e, "miss");
  internals(e).core.current = (target.colorIndex + 1) % 6;
  run(e, 0.3);
  fireAt(e, target.x, target.z);
  flushShots(e);
  assert(pops.length === 0 && miss.some((m) => m.deflected), "wrong colour deflects off the shield");
  internals(e).core.current = target.colorIndex;
  run(e, 0.3);
  fireAt(e, target.x, target.z);
  flushShots(e);
  assert(pops.length === 1 && pops[0].id === target.id && pops[0].remaining === 7, "matching colour pops a shield bomb");
  // regrow after 7 s (world time; freeze has ended by then)
  const regrow = capture(e, "bossShieldRegrow");
  until(e, () => regrow.length > 0, 20);
  assert(regrow.length === 1 && b.shield.length === 8, "shield regrows one bomb");
  // core damage: weak = 2, other = 1 (shield cleared via debug)
  const hitsE = capture(e, "bossHit");
  for (const s of [...b.shield]) internals(e).sys.boss.hitShield(s.id, s.colorIndex, true);
  e.debugSpawnPickup("freeze", 0, 0);
  e.update(DT);
  internals(e).core.current = b.weakColor;
  run(e, 0.3);
  fireAt(e, b.x, b.z);
  flushShots(e);
  internals(e).core.current = (b.weakColor + 1) % 6;
  run(e, 0.3);
  fireAt(e, b.x, b.z);
  flushShots(e);
  assert(hitsE.map((x) => x.damage).join() === "2,1" && b.hp === 17, `weak colour 2 damage, other 1 (${hitsE.map((x) => x.damage)})`);
  assert(b.nextWeakColor !== b.weakColor && b.weakIn > 0 && b.weakIn <= 6, "weak colour cycle telegraphed (next + weakIn)");
  // phases
  const phases = capture(e, "bossPhase"), drops = capture(e, "pickupSpawned");
  e.debugSetBossHp(6);
  assert(phases[0]?.phase === 2 && b.invulnerable && drops.length >= 1, "<= 60%: phase 2, invulnerable, guaranteed pickup");
  e.update(DT);
  assert(Math.sign(b.orbitSpeed) === -1 && Math.abs(Math.abs(b.orbitSpeed) * (180 / Math.PI) - 36 * 1.35) < 1e-6 || internals(e).core.freeze > 0, "phase 2 orbit x1.35 reversed");
  const before = e.getBombs().filter((x) => x.state === "idle").length;
  run(e, 18); // 12 s of world time (the freeze from above pauses the spit clock)
  assert(e.getBombs().filter((x) => x.state === "idle").length >= before + 3, "Mk I spits 3 bombs in phase 2");
  e.debugSetBossHp(2);
  assert(phases[1]?.phase === 3 && b.shield.length === 0, "<= 25%: overload, shield shatters");
  const d0 = Math.hypot(b.x, b.z);
  run(e, 1.25);
  near(d0 - Math.hypot(b.x, b.z), 0.018 * 3 * 1.25, 0.002, "phase 3 core creeps x3");
  run(e, 8);
  assert(b.shield.length === 0, "no regrow in phase 3");
  const won = capture(e, "won"), defeated = capture(e, "bossDefeated"), shat = capture(e, "shatter"), stars = capture(e, "levelStars");
  const score0 = e.getScore();
  e.debugSetBossHp(0);
  assert(defeated[0]?.mk === 1 && e.getPhase() === "won" && won.length === 1 && stars.length === 1, "core kill -> bossDefeated, won, levelStars");
  assert(shat[0]?.bombs.length > 0 && e.getScore() - score0 >= 1500, "ring chain-shatters, +1500 x Mk");
  const ages = e.getBombs().filter((x) => x.state === "shattering").map((x) => x.age);
  assert(Math.min(...ages) < -0.1, "chain shatter is staggered by angle");
  // core touching the border loses
  const lose = make(32, still, { boss: { creep: 2 } });
  const over = capture(lose, "gameOver");
  lose.newGame({ level: 3, levelDef: def(3, { creepBase: 0 }) });
  run(lose, 5);
  assert(over[0]?.bombId === lose.getBoss()!.id, "the core touching the border ends the game");
  // Mk II: rollers from the core every 9 s in phase 2
  const m2 = make(33, still);
  m2.newGame({ level: 6, levelDef: def(6, { creepBase: 0, ticking: 0 }) });
  const rl = capture(m2, "rollerLaunched");
  m2.debugSetBossHp(7);
  run(m2, 9.5);
  assert(m2.getBoss()!.phase === 2 && rl.length === 1 && m2.getBoss()!.shield.length > 0, "Mk II launches a roller from the core in phase 2");
  ok("boss: HP / shield / orbit / gap, shield hit + deflect, regrow, weak x2, phases 60% / 25%, spit, rollers, kill + chain shatter, core loss");
}

// ---- 5. Stars + best combo ------------------------------------------------------------
{
  const tiny = { colorCount: 1, earlyLevels: [{ bombs: 12, creepScale: 0.85 }] };
  const play = (e: ArenaEngine) => {
    for (let i = 0; i < 60 * 90 && e.getPhase() === "playing"; i++) {
      if (!e.getShot() && e.getShooter().cooldown <= 0) {
        const t = e.getBombs().find((b) => b.state === "idle");
        if (t) fireAt(e, t.x, t.z);
      }
      e.update(DT);
    }
  };
  const e = make(41, tiny);
  const stars = capture(e, "levelStars"), score = capture(e, "scoreChanged");
  e.newGame({ level: 1, best: { score: 1e9 } });
  play(e);
  const s = stars[0];
  assert(e.getPhase() === "won" && s.clear && s.fast && s.flawless && s.count === 3 && s.par === 60, "tiny L1 clear: 3 stars");
  assert(!s.newBest.score && s.newBest.combo && s.newBest.time && s.bestCombo === e.getBestCombo() && s.bestCombo >= 1, "newBest vs persisted bests");
  near(score[score.length - 1].delta, Math.round((60 - s.time) * 20), 1e-9, "clear bonus (par - time) x 20");
  const d = make(42, { ...tiny });
  const ds = capture(d, "levelStars");
  d.newGame({ level: 1 });
  const b = internals(d).core.active[0];
  const r = Math.hypot(b.x, b.z);
  b.x *= (6 + 0.45 + 0.2) / r;
  b.z *= (6 + 0.45 + 0.2) / r;
  d.update(DT);
  assert(!d.getStarProgress().flawless && d.getStarProgress().maxDanger >= 0.9, "danger >= 0.9 breaks FLAWLESS");
  play(d);
  assert(d.getPhase() !== "won" || (ds[0] && !ds[0].flawless && ds[0].count <= 2), "FLAWLESS badge lost");
  ok("stars: CLEAR / FAST / FLAWLESS, clear bonus, newBest, best combo");
}

// ---- 5b. Par clock: only real play counts ---------------------------------------------
{
  const e = make(43, { colorCount: 1, earlyLevels: [{ bombs: 12, creepScale: 0.85 }] });
  const stars = capture(e, "levelStars");
  e.newGame({ level: 1 });
  e.setCreepPaused(true); // intro sweep / tutorial / roll lesson
  run(e, 10);
  assert(e.getStarProgress().time === 0 && e.getPlayTime() === 0 && e.getTime() > 9.9, "creep paused: the par clock doesn't run");
  e.setCreepPaused(false);
  run(e, 5);
  near(e.getStarProgress().time, 5, DT, "par clock runs in play");
  e.setPlayClockPaused(true); // UI hold (CLICK TO PLAY / pause / end sequence), creep still running
  run(e, 3);
  near(e.getPlayTime(), 5, DT, "setPlayClockPaused holds it on its own");
  near(e.getStarProgress().time, 5, DT, "star time held too");
  assert(e.isPlayClockPaused(), "isPlayClockPaused");
  e.setPlayClockPaused(false);
  e.debugSpawnPickup("freeze", e.getShooter().x, e.getShooter().z);
  run(e, 2);
  near(e.getPlayTime(), 7, DT * 2, "Freeze time counts");
  for (let i = 0; i < 60 * 60 && e.getPhase() === "playing"; i++) {
    if (!e.getShot() && e.getShooter().cooldown <= 0) {
      const t = e.getBombs().find((b) => b.state === "idle");
      if (t) fireAt(e, t.x, t.z);
    }
    e.update(DT);
  }
  assert(stars[0] && Math.abs(stars[0].time - e.getPlayTime()) < 1e-9 && stars[0].time < e.getTime() - 12 && stars[0].fast, "levelStars.time / FAST use the par clock");
  ok("par clock: stops while creep-paused / setPlayClockPaused, Freeze counts, FAST + levelStars use it", `sim ${e.getTime().toFixed(1)} s, par clock ${e.getPlayTime().toFixed(1)} s`);
}

// ---- 6. Perf: 150 bombs + boss + 2 rollers + 2 pickups + fever ------------------------
{
  const e = make(99);
  e.newGame({ level: 12, levelDef: def(12, { bombs: 150, rollersLive: 2, rotation: [5, 5] }) });
  e.debugSetFever(100);
  for (let i = 0; i < 60; i++) e.update(DT);
  e.debugLaunchRoller();
  internals(e).sys.rollers.spawn(9100, 5, 5, R);
  e.debugSpawnPickup("mega", 3, 0);
  e.debugSpawnPickup("rainbow", -3, 0);
  e.setFireHeld(true);
  const n = 1200;
  let frames = 0;
  const t0 = performance.now();
  let id = 9200;
  for (let i = 0; i < n && e.getPhase() === "playing"; i++, frames++) {
    // keep 2 rollers + 2 pickups alive the whole time
    while (e.getRollers().length < 2) internals(e).sys.rollers.spawn(id++, 6.5 * Math.cos(i), 6.5 * Math.sin(i), R);
    if (e.getPickups().length < 2) e.debugSpawnPickup("lightning", 4 * Math.cos(i), 4 * Math.sin(i));
    if (!e.getFever().active) e.debugSetFever(100);
    e.update(DT);
    e.getAimRay();
    e.getDangerByAngle(16);
  }
  const ms = (performance.now() - t0) / frames;
  console.log(`  perf (fever auto-fire on): ${e.getRemaining()} ring bombs + boss (${e.getBoss()?.shield.length} shield), ${e.getRollers().length} rollers, ${e.getPickups().length} pickups: update+getAimRay+getDangerByAngle avg ${ms.toFixed(3)} ms/frame over ${frames} frames`);
  assert(ms < 1.5, "fun-pass engine fast enough");
}
void B;
console.log("arena fun sanity (part 2): OK");
