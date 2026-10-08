// Headless checks for UI logic from the fun-pass QA fixes:
//  - title layout at the phone landscape sizes (800x360, 844x390, 932x430)
//    plus portrait / desktop: everything on screen, buttons never over the
//    logo / tagline, the pile between the tagline and the buttons;
//  - HUD metrics: the desktop FEVER row fits its card, the short-window
//    mouse chip clears the fever row;
//  - the feature-tip queue and its "seen" rule (Esc / pause before 1.5 s
//    requeues, tap / full hold / 1.5 s on screen = seen);
//  - the play clock: with the real engine (setClockPaused / getPlayTime) the
//    par clock stays 0 in a creep-paused tutorial, the CLICK TO PLAY gate
//    holds it, the end-card time is getPlayTime() and the UI subtracts
//    nothing; the fallback path (engines without it) subtracts held time.
// Run: npx tsx scripts/arena-ui-logic.ts

import { correctStars, heldTime, isPlayClockPaused, nativePlayClock, playTime, resetPlayClock, setPlayClockPaused } from "../src/arena/playClock";
import { ARENA_CONFIG, ArenaEngine, ArenaEvents } from "../src/game/arena";
import {
  DESKTOP_CARD_INNER, DESKTOP_FEVER_W, feverRowWidth, MOUSE_CHIP_W, phoneFeverRow,
} from "../src/ui/arena/arenaHudMetrics";
import { TIP_GAP_MS, TIP_SEEN_MS, TipQueue, tipCountsAsSeen } from "../src/ui/arena/tipQueue";
import { isCompactTitle, MODE_STACK, titleLayout } from "../src/ui/titleLayout";

let checks = 0;
const assert = (cond: unknown, msg: string) => {
  checks++;
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};

console.log("- title layout");
{
  const sizes: [number, number, boolean][] = [
    [800, 360, true], [844, 390, true], [932, 430, true], [667, 375, true], // phones, landscape (compact)
    [375, 667, false], [390, 844, false], [430, 932, false], // phones, portrait
    [1280, 800, false], [1440, 900, false], [1280, 720, false], [1024, 600, true], // desktop windows
  ];
  for (const [w, h, compact] of sizes) {
    const tl = titleLayout(w, h);
    const tag = `${w}x${h}`;
    assert(tl.compact === compact && isCompactTitle(w, h) === compact, `${tag}: compact = ${compact}`);
    const stackBottom = tl.playTop + tl.stackH;
    assert(stackBottom <= h - 8, `${tag}: mode stack (incl. HANGAR + BEST) on screen (${stackBottom.toFixed(0)} <= ${h - 8})`);
    assert(tl.playTop >= tl.tagBottom + 4, `${tag}: buttons below the tagline (${tl.playTop.toFixed(0)} >= ${tl.tagBottom.toFixed(0)})`);
    const subBottom = tl.subY + tl.fontSize * 0.38;
    assert(subBottom <= tl.tagY + 2, `${tag}: SHOOTER above the tagline`);
    assert(tl.logoY - tl.fontSize * 0.6 >= 0 && tl.logoY - tl.slotSize / 2 >= 0, `${tag}: logo + bomb on screen`);
    assert(tl.pileTop >= tl.tagBottom - 1, `${tag}: pile under the tagline`);
    assert(tl.pileGroundY <= tl.playTop, `${tag}: pile above the buttons`);
    if (compact) {
      assert(tl.stackH === MODE_STACK.compact, `${tag}: compact stack`);
      assert(2 * 250 + 16 <= w - 32, `${tag}: ARENA | CLASSIC row fits`);
      assert(stackBottom <= h - 10, `${tag}: HANGAR + BEST fully visible`);
    }
  }
  // the QA cases specifically
  const t932 = titleLayout(932, 430);
  assert(t932.playTop + t932.stackH <= 430, "932x430: HANGAR no longer off-screen");
  const t844 = titleLayout(844, 390);
  assert(t844.playTop + t844.stackH <= 390 - 8, "844x390: BEST line visible");
  const t800 = titleLayout(800, 360);
  assert(t800.playTop > t800.subY + t800.fontSize * 0.38 && t800.playTop > t800.tagBottom, "800x360: buttons clear of SHOOTER + tagline");
}

console.log("- HUD metrics");
{
  assert(feverRowWidth(DESKTOP_FEVER_W, true) <= DESKTOP_CARD_INNER, `desktop FEVER! row fits the card (${feverRowWidth(DESKTOP_FEVER_W, true)} <= ${DESKTOP_CARD_INNER})`);
  for (const w of [800, 844, 932]) {
    const row = phoneFeverRow(w);
    assert(row.right <= w - 12 - MOUSE_CHIP_W, `${w}: mouse chip clears the fever row (${row.right.toFixed(0)} <= ${w - 12 - MOUSE_CHIP_W})`);
    assert(row.left >= 0, `${w}: fever row on screen`);
  }
}

console.log("- tip queue + seen rule");
{
  assert(!tipCountsAsSeen("interrupted", TIP_SEEN_MS - 1) && tipCountsAsSeen("interrupted", TIP_SEEN_MS), "interrupted: seen only after 1.5 s");
  assert(tipCountsAsSeen("tap", 10) && tipCountsAsSeen("timeout", 10), "tap / full hold = seen");
  let now = 0;
  const seen: string[] = [];
  let tips = true;
  const q = new TipQueue<string>({ want: (id) => tips && !seen.includes(id), markSeen: (id) => seen.push(id), now: () => now });
  q.push("lightning");
  q.push("lightning");
  q.push("fever");
  assert(q.pending.length === 2, "no duplicates");
  assert(q.next() === "lightning" && q.showing === "lightning", "first tip shows");
  assert(q.next() === null, "one at a time");
  // Esc / pause after 0.4 s: back to the front, not seen
  now += 400;
  q.tick();
  q.close("interrupted");
  assert(!seen.includes("lightning") && q.pending[0] === "lightning", "Esc before 1.5 s: requeued, not seen");
  assert(q.next() === null, "gap after a close");
  now += TIP_GAP_MS;
  assert(q.next() === "lightning", "comes back after resume");
  // stays 1.5 s -> seen even if interrupted afterwards
  now += TIP_SEEN_MS;
  q.tick();
  assert(seen.includes("lightning"), "1.5 s on screen = seen");
  q.close("interrupted");
  assert(!q.pending.includes("lightning"), "seen tip is not requeued");
  now += TIP_GAP_MS;
  assert(q.next() === "fever", "next tip");
  q.close("tap");
  assert(seen.includes("fever"), "tap = seen");
  // hold (boss phase shift), want filter, clear
  q.push("boss");
  q.holdFor(1600);
  now += TIP_GAP_MS;
  assert(q.next() === null, "held during a phase shift");
  now += 1600;
  tips = false;
  assert(q.next() === null && q.pending.length === 0, "Tips off: dropped");
  tips = true;
  q.push("rotation");
  q.push("wallPush");
  assert(q.next() === "rotation", "shows");
  q.clear();
  assert(q.showing === null && q.pending.length === 0 && !seen.includes("rotation"), "level change: cleared, unseen");
}

console.log("- play clock: fallback (engine without setClockPaused)");
{
  const fake = { t: 0, getTime() { return this.t; } };
  assert(!nativePlayClock(fake), "fake engine is not native");
  resetPlayClock(fake, true); // newGame during the intro
  fake.t = 2.8; // intro sweep
  assert(playTime(fake, fake.t) === 0 && isPlayClockPaused(fake), "intro: no par time");
  setPlayClockPaused(fake, false);
  fake.t = 12.8; // 10 s of play
  setPlayClockPaused(fake, true); // tutorial / gate / pause
  setPlayClockPaused(fake, true); // idempotent
  fake.t = 52.8; // 40 s held
  assert(Math.abs(playTime(fake, fake.t) - 10) < 1e-9, "held time excluded while held");
  setPlayClockPaused(fake, false);
  fake.t = 72.8; // +20 s
  assert(Math.abs(playTime(fake, fake.t) - 30) < 1e-9 && Math.abs(heldTime(fake) - 42.8) < 1e-9, "play time = 30 s");
  const ev = { time: 72.8, par: 60, fast: false, count: 1, clear: true, flawless: false };
  const fixed = correctStars(fake, ev);
  assert(fixed.fast && fixed.count === 2 && Math.abs(fixed.time - 30) < 1e-9, "FAST corrected with the held time");
  resetPlayClock(fake, true);
  assert(heldTime(fake) === 0, "new level resets the clock");
}

console.log("- play clock: either engine method name is native, setPlayClockPaused preferred");
{
  const calls: string[] = [];
  const both = { getTime: () => 0, setPlayClockPaused: (p: boolean) => calls.push(`play:${p}`), setClockPaused: (p: boolean) => calls.push(`clock:${p}`) };
  const alias = { getTime: () => 0, setClockPaused: (p: boolean) => calls.push(`alias:${p}`) };
  const exact = { getTime: () => 0, setPlayClockPaused: (p: boolean) => calls.push(`exact:${p}`) };
  assert(nativePlayClock(both) && nativePlayClock(alias) && nativePlayClock(exact), "either name = native");
  setPlayClockPaused(both, true);
  setPlayClockPaused(alias, true);
  setPlayClockPaused(exact, true);
  assert(calls.join() === "play:true,alias:true,exact:true", `preferred name first (${calls.join()})`);
  assert(heldTime(both) === 0 && heldTime(alias) === 0 && heldTime(exact) === 0, "native: no UI subtraction");
}

console.log("- play clock: native (real ArenaEngine par clock)");
{
  const step = (e: ArenaEngine, sec: number) => {
    for (let i = 0; i < Math.round(sec * 30) && e.getPhase() === "playing"; i++) e.update(1 / 30);
  };
  const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
  const e = new ArenaEngine({ random: () => 0.41 });
  assert(nativePlayClock(e), "ArenaEngine has the par clock: native");
  // mount: newGame, creep held for the intro sweep + L1 tutorial
  e.newGame({ level: 1 });
  e.setCreepPaused(true);
  resetPlayClock(e, true);
  step(e, 6);
  assert(e.getTime() > 5.9, "simulation runs during the tutorial");
  assert(e.getPlayTime() === 0 && e.getStarProgress().time === 0, "par clock stays 0 while the creep is paused (tutorial)");
  assert(playTime(e) === 0 && heldTime(e) === 0, "UI reads 0, subtracts nothing");
  // play
  e.setCreepPaused(false);
  setPlayClockPaused(e, false);
  step(e, 3);
  const p1 = e.getPlayTime();
  assert(near(p1, 3, 0.05), `3 s of play counted (${p1.toFixed(3)})`);
  // CLICK TO PLAY gate: creep running (for the clock test), clock held through the helper
  setPlayClockPaused(e, true);
  const raw0 = e.getTime();
  step(e, 2);
  assert(e.getTime() - raw0 > 1.9, "simulation keeps running behind the gate");
  assert(near(e.getPlayTime(), p1), "gate holds the par clock (setPlayClockPaused -> setClockPaused)");
  setPlayClockPaused(e, false);
  step(e, 1);
  // no double subtraction: the UI value IS the engine value
  assert(heldTime(e) === 0 && near(playTime(e), e.getPlayTime()) && near(e.getStarProgress().time, e.getPlayTime()), "no double subtraction (HUD = getStarProgress().time = getPlayTime())");
  assert(e.getTime() - e.getPlayTime() > 7.5, "raw time includes the held 8 s; par clock does not");
  // pause menu: update(0)
  const p2 = e.getPlayTime();
  for (let i = 0; i < 30; i++) e.update(0);
  assert(near(e.getPlayTime(), p2), "dt 0 (pause) holds the clock");

  // end card: won.time / levelStars.time = getPlayTime(), used as is
  const w = new ArenaEngine({ random: () => 0.41, config: { earlyLevels: [{ bombs: 3, creepScale: 0.85 }, ...ARENA_CONFIG.earlyLevels.slice(1)] } });
  let wonTime = -1;
  let starsEv: ArenaEvents["levelStars"] | null = null;
  let playAtWin = -1;
  w.on("won", ({ time }) => {
    wonTime = time;
    playAtWin = w.getPlayTime(); // what useArenaSession stores as the result time
  });
  w.on("levelStars", (x) => (starsEv = x));
  w.newGame({ level: 1 });
  w.setCreepPaused(true);
  resetPlayClock(w, true);
  step(w, 4); // intro + tutorial: not par time
  w.setCreepPaused(false);
  setPlayClockPaused(w, false);
  for (let i = 0; i < 6000 && w.getPhase() === "playing"; i++) {
    if (i % 20 === 0) {
      const b = w.getBombs().find((x) => x.state === "idle");
      if (b) w.aimAt(b.x, b.z);
      if (!w.getPowerSlot()) w.debugSpawnPickup("mega", w.getShooter().x, w.getShooter().z);
      w.fire();
    }
    w.update(1 / 30);
  }
  assert(w.getPhase() === "won" && starsEv !== null, "debug win reached");
  const ev = starsEv as unknown as ArenaEvents["levelStars"];
  assert(near(wonTime, playAtWin) && near(ev.time, playAtWin), "end-card time = won.time = levelStars.time = getPlayTime()");
  assert(w.getTime() - ev.time > 3.9, "the 4 s intro/tutorial is not in the end-card time");
  assert(correctStars(w, ev) === ev, "no UI correction on native levelStars (no double subtraction)");
}

console.log(`arena-ui-logic: ${checks} checks passed`);
