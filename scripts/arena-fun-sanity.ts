// Arena 360 fun pass, part 1: level table + unlocks, pickups, powers, fever,
// armored and ticking bombs. `npx tsx scripts/arena-fun-sanity.ts`
// (part 2: scripts/arena-fun-motion.ts; balance bot: scripts/arena-balance.ts)

import { ARENA_CONFIG, ARENA_FUN, levelDef } from "../src/game/arena";
import { DT, arrange, assert, capture, def, fireAt, flushShots, internals, make, near, ok, run, until } from "./arena-kit";

const R = 0, Y = 1, B = 2; // colour indices

// ---- 1. Level table + unlock schedule -----------------------------------------
{
  const want: [number, string][] = [
    [1, "pickups,rainbow,freeze,roll"],
    [2, "pickups,rainbow,freeze,armored,fever,roll"],
    [3, "pickups,rainbow,freeze,mega,armored,fever,boss,roll"],
    [4, "pickups,rainbow,freeze,mega,lightning,armored,fever,ticking,rotation,roll"],
    [5, "pickups,rainbow,freeze,mega,lightning,armored,fever,ticking,roller,roll"],
    [6, "pickups,rainbow,freeze,mega,lightning,armored,fever,boss,ticking,rotation,roller,roll"],
    [7, "pickups,rainbow,freeze,mega,lightning,armored,fever,ticking,roller,roll,doubleRing"],
    [8, "pickups,rainbow,freeze,mega,lightning,armored,fever,ticking,rotation,roller,roll,doubleRing"],
  ];
  for (const [lv, f] of want) assert(levelDef(ARENA_CONFIG, lv).features.join() === f, `L${lv} features ${levelDef(ARENA_CONFIG, lv).features.join()}`);
  const intro = [1, 2, 3, 4, 5, 7].map((lv) => levelDef(ARENA_CONFIG, lv).introduces.join("+"));
  assert(intro.join(" | ") === "pickups+rainbow+freeze+roll | armored+fever | mega+boss | lightning+ticking+rotation | roller | doubleRing", `introduces ${intro.join(" | ")}`);
  const l1 = levelDef(ARENA_CONFIG, 1), l2 = levelDef(ARENA_CONFIG, 2);
  assert(l1.bombs === 60 && Math.abs(l1.creepBase - 0.035 * 0.85) < 1e-12 && l1.par === 60, "L1 keeps today's numbers (60 bombs, 0.02975 w/s)");
  assert(l2.bombs === 75 && Math.abs(l2.creepBase - 0.035 * 0.92) < 1e-12 && l2.armored === 5 && l2.fever, "L2 75 / 0.0322, armored x5, fever");
  const rows = Array.from({ length: 15 }, (_, i) => levelDef(ARENA_CONFIG, i + 1));
  const sig = rows.map((d) => `${d.bombs}/${d.creepBase.toFixed(4)}/a${d.armored}t${d.ticking}r${d.rollers}x${d.rollersLive}/${d.rotation.join(":")}/${d.doubleRing ? "D" : "-"}/${d.boss ? `B${d.boss.mk}` : "-"}/${d.par}`);
  console.log(`  level table:\n    ${sig.map((s, i) => `L${i + 1} ${s}`).join("\n    ")}`);
  const b = [3, 6, 9, 12].map((lv) => levelDef(ARENA_CONFIG, lv).boss!);
  assert(b.map((x) => `${x.mk}:${x.coreHp}:${x.shield}:${x.orbit}:${x.regrow}`).join() === "1:20:8:36:7,2:24:8:42:8,3:26:10:48:8,4:28:12:54:9", "boss Mk table (tuned)");
  const l10 = levelDef(ARENA_CONFIG, 10), l11 = levelDef(ARENA_CONFIG, 11);
  assert(l10.bombs === 138 && l10.rotation[0] === 5 && !l10.doubleRing && l11.doubleRing && l11.rotation.join() === "5,-3", "L10+ twist deck");
  ok("level table, unlock schedule, boss Mk table, L10+ generator");
}

// ---- 2. Pickup drops ------------------------------------------------------------
{
  const e = make(1);
  e.newGame({ level: 2 });
  const { core, sys } = internals(e);
  const rate = (n: number, setup: () => void, trials = 3000) => {
    let hits = 0;
    for (let i = 0; i < trials; i++) {
      sys.pickups.reset();
      setup();
      sys.pickups.onPop(n, { x: 0, z: -9 });
      if (sys.pickups.list.length) hits++;
    }
    return hits / trials;
  };
  const base = () => { core.combo = 1; core.time = 1; };
  const r = [4, 5, 6, 7, 8, 9].map((n) => rate(n, base));
  near(r[0], 0, 0, "n=4 never drops");
  near(r[1], 0.3, 0.03, "n=5 30%");
  near(r[2], 0.4, 0.03, "n=6 40%");
  near(r[3], 0.6, 0.03, "n=7 60%");
  near(r[4], 0.6, 0.03, "n=8 60%");
  near(r[5], 1, 0, "n>=9 100%");
  near(rate(5, () => { core.combo = 3; core.time = 1; }), 0.45, 0.03, "combo >= 3 adds 15%");
  near(rate(4, () => { core.combo = 1; core.time = 26; }), 1, 0, "pity after 25 s: n=4 drops");
  sys.fever.state.active = true;
  near(rate(6, base), 0.2, 0.03, "fever halves the chance");
  sys.fever.state.active = false;
  // limits: cooldown 6 s, nothing in flight, < 2 on the floor, none while frozen
  sys.pickups.reset();
  core.time = 1;
  sys.pickups.onPop(9, { x: 0, z: -9 });
  core.time = 3;
  sys.pickups.onPop(9, { x: 0, z: -9 });
  assert(sys.pickups.list.length === 1, "6 s drop cooldown / one in flight");
  sys.pickups.reset();
  e.debugSpawnPickup("rainbow", 3, 0);
  e.debugSpawnPickup("mega", -3, 0);
  core.time = 50;
  sys.pickups.onPop(9, { x: 0, z: -9 });
  assert(sys.pickups.list.length === 2, "max 2 on the floor");
  sys.pickups.reset();
  core.freeze = 2;
  sys.pickups.onPop(9, { x: 0, z: -9 });
  assert(sys.pickups.list.length === 0, "no drops while frozen");
  core.freeze = 0;
  // kind weights (L2: rainbow 35 / freeze 25 -> 58% / 42%), freeze x2 at danger >= 0.6
  const kinds = (danger: number) => {
    let fr = 0;
    for (let i = 0; i < 3000; i++) {
      sys.pickups.reset();
      core.danger = danger;
      core.time = 1;
      sys.pickups.onPop(9, { x: 0, z: -9 });
      if (sys.pickups.list[0].kind === "freeze") fr++;
    }
    return fr / 3000;
  };
  near(kinds(0), 25 / 60, 0.03, "freeze weight 25 of 60");
  near(kinds(0.7), 50 / 102.5, 0.03, "freeze x2 and rainbow x1.5 at danger >= 0.6");
  ok("drop table, combo bonus, pity, fever x0.5, cooldown, floor cap, freeze lock, kind weights");

  // L1 teach: the first n >= 4 pop drops a Rainbow
  const t = make(2);
  t.newGame({ level: 1 });
  const ti = internals(t);
  ti.core.time = 1;
  ti.sys.pickups.onPop(4, { x: 0, z: -9 });
  assert(ti.sys.pickups.list[0]?.kind === "rainbow", "L1 teach drop is a Rainbow");
  ok("L1 teach: first n>=4 pop drops a Rainbow");
}

// ---- 3. Flight, landing, magnet, collect, despawn, slot -------------------------
{
  const e = make(3);
  e.newGame({ level: 2 });
  e.setCreepPaused(true);
  const { core, sys } = internals(e);
  const landed = capture(e, "pickupLanded");
  const radii: number[] = [];
  for (let k = 0; k < 40; k++) {
    sys.pickups.reset();
    core.time = 1;
    const a = (k / 40) * Math.PI * 2;
    sys.pickups.onPop(9, { x: Math.cos(a) * 9, z: Math.sin(a) * 9 });
    const p = sys.pickups.list[0];
    const to = { x: (p as unknown as { toX: number }).toX, z: (p as unknown as { toZ: number }).toZ };
    radii.push(Math.hypot(to.x, to.z));
    assert(Math.hypot(to.x - core.shooter.x, to.z - core.shooter.z) >= 1.0 - 1e-9, "lands >= 1.0 from the player");
  }
  assert(radii.every((r) => (r >= 3.2 - 1e-9 && r <= 4.4 + 1e-9) || Math.abs(r - 2.5) < 1e-9), "lands at r 3.8 +- 0.6 (or the 2.5 fallback)");
  sys.pickups.reset();
  core.time = 1;
  sys.pickups.onPop(9, { x: 0, z: -9 });
  const tFlight = until(e, () => landed.length > 0, 2);
  near(tFlight, 0.7, DT * 1.5, "0.7 s flight");
  // collect radius 0.7, magnet 1.6
  sys.pickups.reset();
  e.debugSpawnPickup("mega", 1.7, 0);
  run(e, 0.5);
  near(sys.pickups.list[0].x, 1.7, 1e-9, "outside 1.6: no magnet");
  sys.pickups.list[0].x = 1.5;
  run(e, 0.1);
  near(sys.pickups.list[0].x, 1.1, 1e-6, "inside 1.6: slides at 4 w/s");
  const got = capture(e, "pickupCollected");
  run(e, 0.2);
  assert(got.length === 1 && got[0].kind === "mega" && got[0].loaded && e.getPowerSlot() === "mega", "collected within 0.7, loaded in the POWER slot");
  // slot full: another shot-type pickup is locked, its timer paused; swap blocked
  e.debugSpawnPickup("rainbow", 1.0, 0);
  run(e, 3);
  const locked = sys.pickups.list[0];
  assert(locked.locked && locked.ttl === ARENA_FUN.pickups.ttl && e.getPowerSlot() === "mega", "locked pickup: not collected, timer paused");
  assert(!e.swapBomb(), "swap blocked while a power is loaded");
  // freeze is instant and stacks to 8 s
  e.debugSpawnPickup("freeze", 0.3, 0);
  e.update(DT);
  near(e.getFreeze(), 5 - DT * 0, DT + 1e-9, "freeze 5 s");
  run(e, 1);
  e.debugSpawnPickup("freeze", 0.3, 0);
  e.update(DT);
  near(e.getFreeze(), 8, DT + 1e-9, "freeze stacks +5 capped at 8 s");
  // fire the power: queue = power -> displaced current -> next
  const cur = e.getCurrentBomb();
  const fired = capture(e, "powerFired");
  e.setYaw(Math.PI / 2);
  assert(e.fire() && fired[0]?.kind === "mega" && e.getPowerSlot() === null && e.getCurrentBomb() === cur, "power fires first, current colour stays queued");
  run(e, 0.2);
  assert(sys.pickups.list.length === 0 && e.getPowerSlot() === "rainbow", "the locked pickup unlocks and magnets in after firing");
  // despawn after 10 s with a 3 s blink
  sys.pickups.reset();
  e.debugSpawnPickup("freeze", 4, 0);
  const expired = capture(e, "pickupExpired");
  run(e, 7.05);
  assert(sys.pickups.list[0].state === "blinking", "blinks in the last 3 s");
  run(e, 3);
  assert(expired.length === 1 && sys.pickups.list.length === 0, "expires at 10 s");
  ok("flight 0.7 s, landing ring, grab 0.7 / magnet 1.6, slot + lock, freeze stack cap, power queue, 10 s despawn");
}

// ---- 4. Powers: Rainbow, Mega, Lightning, Freeze effects ------------------------
{
  // Rainbow: touches a red pair and a blue pair -> both pop in ONE combo step
  const e = make(4);
  e.newGame({ level: 4 });
  e.setCreepPaused(true);
  arrange(e, [
    { x: 0, z: -8, c: R }, { x: -0.9, z: -8.2, c: R }, { x: 0.92, z: -7.3, c: B }, { x: 1.5, z: -8.0, c: B }, { x: -5, z: 8, c: Y },
  ], Y);
  internals(e).sys.pickups.slot = "rainbow";
  const pops = capture(e, "pop");
  e.setYaw(-Math.PI / 2);
  assert(e.fire(), "rainbow fired");
  flushShots(e);
  assert(pops.length === 1 && pops[0].bombs.length === 5 && pops[0].combo === 1, `rainbow pops both qualifying colours in one step (${pops.map((p) => p.bombs.length)})`);
  // Rainbow with nothing qualifying adopts the hit colour
  arrange(e, [{ x: 0, z: -9.5, c: R }, { x: 0.92, z: -8.8, c: B }, { x: -5, z: 8, c: Y }], Y);
  internals(e).sys.pickups.slot = "rainbow";
  const sticks = capture(e, "stick");
  e.setYaw(-Math.PI / 2);
  e.fire();
  flushShots(e);
  assert(sticks.length === 1 && sticks[0].colorIndex === R, "non-qualifying rainbow becomes the hit colour");

  // Mega: everything within 2.2 of the contact point, armor ignored, no deflect
  arrange(e, [
    { x: 0, z: -8, c: R }, { x: 1.4, z: -7.6, c: Y, kind: "armored" }, { x: -2.0, z: -7.4, c: B }, { x: 0, z: -9.8, c: B },
    { x: 2.6, z: -7.1, c: Y }, { x: -1.0, z: -8.6, c: Y }, { x: -5, z: 8, c: Y },
  ], Y);
  internals(e).sys.pickups.slot = "mega";
  const blasts = capture(e, "megaBlast");
  const before = new Set(e.getBombs().filter((b) => b.state === "idle").map((b) => b.id));
  e.setYaw(-Math.PI / 2);
  e.fire();
  flushShots(e);
  const left = e.getBombs().filter((b) => b.state === "idle");
  assert(blasts.length === 1 && blasts[0].bombs.length === 4 && left.length === 3 && left.every((b) => before.has(b.id)), `mega removes the 4 bombs within 2.2 incl. armored (${blasts[0]?.bombs.length}, left ${left.length})`);

  // Lightning: one colour, hops <= 3.0, strips armor, max 18
  arrange(e, [
    { x: 0, z: -8, c: R }, { x: 2.5, z: -8, c: R }, { x: 5.0, z: -8, c: R }, { x: 8.5, z: -8, c: R }, { x: 1.2, z: -9, c: B },
    { x: 0, z: -10.5, c: R, kind: "armored" }, { x: -5, z: 8, c: Y },
  ], Y);
  internals(e).sys.pickups.slot = "lightning";
  const chains = capture(e, "lightningChain");
  const armor = capture(e, "armorBroken");
  e.setYaw(-Math.PI / 2);
  e.fire();
  flushShots(e);
  const idle = e.getBombs().filter((b) => b.state === "idle");
  assert(chains[0]?.path.length === 4 && armor.length === 1, `lightning chains 4 reds (got ${chains[0]?.path.length}), strips 1 armor`);
  assert(idle.length === 4 && idle.some((b) => b.x === 8.5) && idle.some((b) => b.colorIndex === B), "far red (3.5) and the blue stay");
  const line = Array.from({ length: 25 }, (_, i) => ({ x: -12 + i * 1.0, z: -8 - (i % 2) * 0.05, c: R }));
  arrange(e, [{ x: 0, z: -7.2, c: R }, ...line.filter((b) => Math.abs(b.x) > 0.95), { x: -5, z: 8, c: Y }], Y);
  internals(e).sys.pickups.slot = "lightning";
  e.setYaw(-Math.PI / 2);
  e.fire();
  flushShots(e);
  assert(chains[1]?.path.length === 18, `lightning caps at 18 (${chains[1]?.path.length})`);
  ok("rainbow multi-colour pop + adopt, mega 2.2 radius (armor ignored), lightning hop 3.0 / one colour / armor strip / max 18");
}

// ---- 5. Fever -------------------------------------------------------------------
{
  const e = make(5, { creepSpeed: 0, surgeStep: 0 });
  e.newGame({ level: 2 });
  const { core } = internals(e);
  arrange(e, [{ x: 0, z: -8, c: R }, { x: 0.9, z: -8.1, c: R }, { x: -5, z: 8, c: Y }, { x: -5.9, z: 8.1, c: Y }, { x: 5, z: 8, c: B }], R);
  const fc = capture(e, "feverChanged");
  e.setYaw(-Math.PI / 2);
  e.fire();
  flushShots(e);
  assert(fc.length === 1 && fc[0].delta === 5, `fill = 5 for a 3-pop at combo 1 (${fc[0]?.delta})`);
  run(e, 4.9);
  near(e.getFever().meter, 5, 1e-9, "no decay for 5 s");
  run(e, 1.1);
  assert(e.getFever().meter < 5 && e.getFever().meter > 1, "decays after 5 s");
  // auto-start at 100, 6 s, 4 shots, 0.18 s cooldown, wild, x2, slow-mo once
  const starts = capture(e, "feverStart"), ends = capture(e, "feverEnd"), slow = capture(e, "slowMo");
  e.debugSetFever(100);
  e.update(DT);
  const feverT0 = e.getTime();
  assert(starts.length === 1 && starts[0].duration === 6 && e.getFever().active, "auto-starts at 100 for 6 s");
  e.setYaw(Math.PI); // open floor: shots fly to max range
  let shots = 0;
  for (let i = 0; i < 40; i++) {
    if (e.fire()) shots++;
    e.update(DT);
  }
  assert(e.getShots().length === 4 && shots === 4, `4 shots in flight (${e.getShots().length})`);
  assert(Math.abs(e.getShots()[0].speed - 24) < 1e-9 && e.getShots()[0].wild, "fever shots fly at 24 and are wild");
  flushShots(e, 2);
  e.fire();
  let cd = 0;
  while (!e.fire() && cd < 1) { e.update(DT); cd += DT; }
  near(cd, 0.18, DT * 1.5, "0.18 s fever cooldown");
  flushShots(e, 2);
  core.current = B; // wrong colour at the yellow pair: wild pops it
  const pops = capture(e, "pop");
  fireAt(e, -5, 8);
  flushShots(e);
  assert(pops.length === 1 && pops[0].bombs.length === 3, "wild shot takes the hit colour and pops a pair");
  assert(pops[0].score === 30 * 2 * Math.min(pops[0].combo, 5), `fever score x2 (${pops[0].score})`);
  assert(slow.length === 1 && slow[0].scale === 0.3 && e.getTimeScale() < 1, "slow-mo 0.3 on the first fever pop");
  until(e, () => ends.length > 0, 8);
  near(e.getTime() - feverT0, 6, DT * 1.5, "fever lasts 6 s");
  assert(e.getFever().lockout > 3.9 && !e.getFever().active, "lockout after fever");
  internals(e).sys.fever.add(20);
  assert(e.getFever().meter === 0, "lockout keeps the meter at 0");
  run(e, 4.1);
  internals(e).sys.fever.add(20);
  assert(e.getFever().meter === 20 && e.getTimeScale() === 1, "fills again after the 4 s lockout; time scale back to 1");
  ok("fever fill / decay / auto-start / 6 s / 4 shots / 0.18 s / 24 u/s / wild / x2 / slow-mo / lockout");
}

// ---- 6. Armored -------------------------------------------------------------------
{
  const e = make(6);
  e.newGame({ level: 2 });
  e.setCreepPaused(true);
  const [, armored, , lone] = arrange(e, [
    { x: 0, z: -9.5, c: R }, { x: -0.9, z: -9.7, c: R, kind: "armored" }, { x: 5, z: 8, c: Y }, { x: 0.9, z: -9.7, c: B, kind: "armored" },
  ], R);
  const broken = capture(e, "armorBroken");
  e.setYaw(-Math.PI / 2);
  e.fire();
  flushShots(e);
  assert(armored.state === "idle" && armored.armor === 0 && broken.some((b) => b.id === armored.id), "first match strips the armor, bomb stays (not orphan-shattered)");
  assert(lone.state === "idle" && lone.armor === 0, "armored orphan loses its armor instead of shattering");
  internals(e).core.current = R;
  for (let i = 0; i < 2; i++) {
    internals(e).core.current = R;
    run(e, 0.3);
    fireAt(e, armored.x, armored.z);
    flushShots(e);
  }
  assert(armored.state !== "idle", "second match pops it");
  ok("armored: 2 matches, exempt from same-resolution orphans, orphan strip");
}

// ---- 7. Ticking + lurch -----------------------------------------------------------
{
  const e = make(7, { creepSpeed: 0, surgeStep: 0 });
  e.newGame({ level: 4, levelDef: def(4, { rotation: [0, 0], creepBase: 0, tickTimer: 20 }) });
  const [tick, , gapBomb, tick2] = arrange(e, [
    { x: 0, z: -9.5, c: R, kind: "ticking" }, { x: 5, z: 9, c: Y }, { x: 7.75, z: 0, c: B }, { x: -9, z: 0, c: Y, kind: "ticking" },
  ], Y);
  const armed = capture(e, "tickingArmed"), warn = capture(e, "tickingWarning"), boom = capture(e, "tickingExploded"), lurch = capture(e, "lurch");
  run(e, 7.9);
  assert(armed.length === 0, "nothing arms before 8 s");
  run(e, 0.2);
  assert(armed.length === 1 && armed[0].timer === 20, "first arm at 8 s with a 20 s timer");
  run(e, 14.7);
  assert(armed.length === 1, "stagger: next slot 15 s later");
  run(e, 0.4);
  assert(armed.length === 2, "second bomb arms 15 s after the first");
  run(e, 27.9 - e.getTime());
  assert(warn.filter((w) => w.id === armed[0].id).map((w) => w.remaining).join() === "5,4,3,2,1", "warnings each second <= 5");
  const gap0 = Math.hypot(gapBomb.x, gapBomb.z) - 0.45 - 6;
  run(e, 0.6);
  assert(boom.length === 1 && boom[0].id === armed[0].id, "detonates at 0");
  near(lurch[0].distance, Math.min(0.8, gap0 - 0.6), 1e-9, "lurch = min(0.8, gap - 0.6)");
  run(e, 0.5);
  near(Math.hypot(gapBomb.x, gapBomb.z) - 0.45 - 6, 0.6, 0.02, "lurch alone leaves the closest bomb 0.6 from the border");
  assert(!internals(e).sys.stars.read().flawless && e.getCombo() === 0, "lurch breaks FLAWLESS and resets combo");
  // the gap-0.7 case: lurch 0.1, never game over
  const e2 = make(8, { creepSpeed: 0, surgeStep: 0 });
  e2.newGame({ level: 4, levelDef: def(4, { rotation: [0, 0], creepBase: 0, tickTimer: 20 }) });
  arrange(e2, [{ x: 0, z: -9.5, c: R, kind: "ticking" }, { x: 7.15, z: 0, c: B }, { x: 5, z: 9, c: Y }], Y);
  const l2 = capture(e2, "lurch");
  e2.debugArmTicking();
  run(e2, 21);
  near(l2[0].distance, 0.1, 1e-6, "gap 0.7 -> lurch 0.1");
  assert(e2.getPhase() === "playing", "a lurch alone never ends the game");
  // defuse
  const defused = capture(e, "tickingDefused");
  const score0 = e.getScore();
  internals(e).core.current = Y;
  run(e, 0.3);
  arrange(e, [{ x: 0, z: -8, c: Y, kind: "ticking" }, { x: 0.9, z: -8.1, c: Y }, { x: 5, z: 9, c: B }], Y);
  e.debugArmTicking();
  e.setYaw(-Math.PI / 2);
  e.fire();
  flushShots(e);
  assert(defused.length === 1 && e.getScore() - score0 >= 100, "popping a ticking bomb defuses it (+100)");
  void tick;
  void tick2;
  ok("ticking: 8 s first arm, 15 s stagger, 20 s timer, 5..1 warnings, capped lurch (0.7 gap -> 0.1, no game over), defuse +100");
}

// ---- 8. Wall push solvability + danger colour assist ----------------------------
{
  // A lone red bomb 0.2 from the border and NO red ever on hand: wrong-colour
  // shots must push it back (gap grows) and repeated pushes buy >= 10 s.
  const setup = (seed: number) => {
    const e = make(seed);
    e.newGame({ level: 2 });
    const [red] = arrange(e, [{ x: 0, z: -(6.45 + 0.2), c: R }, { x: 6, z: 8, c: Y }, { x: 6.9, z: 8.1, c: Y }], Y);
    return { e, red };
  };
  const gapOf = (b: { x: number; z: number }) => Math.hypot(b.x, b.z) - 6.45;
  const idleRun = setup(51);
  run(idleRun.e, 60);
  const idleSurvive = idleRun.e.getTime();
  assert(idleRun.e.getPhase() === "gameOver", "untouched, the red bomb ends the game");

  const { e, red } = setup(51);
  const pushes = capture(e, "wallPush");
  let last = -9, gainFirst = NaN;
  while (e.getPhase() === "playing" && e.getTime() < 120) {
    internals(e).core.current = internals(e).core.next = Y; // never the matching colour
    if (e.getTime() - last >= 1.2 && e.getShots().length === 0 && gapOf(red) <= 0.95) {
      const g0 = gapOf(red);
      if (fireAt(e, red.x, red.z)) {
        last = e.getTime();
        flushShots(e);
        run(e, 0.4);
        if (Number.isNaN(gainFirst)) gainFirst = gapOf(red) - g0;
        continue;
      }
    }
    e.update(DT);
  }
  const pushSurvive = e.getTime();
  assert(gainFirst > 0.8, `a wrong-colour push shoves the bomb back (gap +${gainFirst.toFixed(2)})`);
  assert(pushSurvive - idleSurvive >= 10, `repeated pushes buy >= 10 s (${idleSurvive.toFixed(1)} s -> ${pushSurvive.toFixed(1)} s, ${pushes.length} pushes)`);
  const solvable = `${idleSurvive.toFixed(1)} s idle vs ${pushSurvive >= 120 ? ">= 120" : pushSurvive.toFixed(1)} s pushing (${pushes.length} pushes), first push +${gainFirst.toFixed(2)} w`;

  // ... and it is always solvable: push for room, then pair + pop with red
  const s2 = setup(52);
  const s2e = s2.e;
  for (let k = 0; k < 2; k++) {
    internals(s2e).core.current = Y;
    fireAt(s2e, s2.red.x, s2.red.z);
    flushShots(s2e);
    run(s2e, 1.3);
  }
  for (let k = 0; k < 2; k++) {
    internals(s2e).core.current = R;
    fireAt(s2e, s2.red.x, s2.red.z);
    flushShots(s2e);
    run(s2e, 0.3);
  }
  assert(s2.red.state !== "idle" && s2e.getPhase() === "playing", "push, then same-colour pair + pop clears the near-border single");

  // repeat pushes within 2 s are halved; armored / ticking keep armor + timer
  const s3 = setup(53);
  const w = capture(s3.e, "wallPush");
  Object.assign(s3.red, { kind: "armored", armor: 1 });
  internals(s3.e).core.current = Y;
  fireAt(s3.e, s3.red.x, s3.red.z);
  flushShots(s3.e);
  run(s3.e, 0.3);
  s3.red.x = 0;
  s3.red.z = -(6.45 + 0.3);
  internals(s3.e).core.current = Y;
  fireAt(s3.e, s3.red.x, s3.red.z);
  flushShots(s3.e);
  assert(w.length === 2 && w[1].distance === w[0].distance * 0.5 && s3.red.armor === 1, "second push within 2 s is halved; armor kept");

  // danger colour assist: with a bomb near the line, ~60% (+ uniform share) of picks are its colour
  const a = make(54);
  a.newGame({ level: 2 });
  arrange(a, [{ x: 0, z: -(6.45 + 0.5), c: R }, { x: 6, z: 8, c: Y }, { x: -6, z: 8, c: B }, { x: 6, z: -8, c: 3 }], Y);
  let reds = 0;
  for (let i = 0; i < 3000; i++) if (internals(a).core.pickShotColor() === R) reds++;
  near(reds / 3000, 0.6 + 0.4 / 4, 0.03, "danger assist favours the near-border colour");
  ok("wall push: solvable near-border single, >= 10 s from pushes, pair + pop, halved repeats, armor kept, colour assist", solvable);
}

console.log("arena fun sanity (part 1): OK");
