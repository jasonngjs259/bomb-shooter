// Headless checks for UI logic from the fun-pass QA fixes:
//  - title layout at the phone landscape sizes (800x360, 844x390, 932x430)
//    plus portrait / desktop: everything on screen, buttons never over the
//    logo / tagline, the pile between the tagline and the buttons;
//  - HUD metrics: the desktop FEVER row fits its card, the short-window
//    mouse chip clears the fever row;
//  - the feature-tip queue and its "seen" rule (Esc / pause before 1.5 s
//    requeues, tap / full hold / 1.5 s on screen = seen);
//  - the play clock: held game time (intro, gate, tutorials, pause) is not
//    par time, and levelStars FAST is corrected until the engine counts it.
// Run: npx tsx scripts/arena-ui-logic.ts

import { correctStars, heldTime, isPlayClockPaused, playTime, resetPlayClock, setPlayClockPaused } from "../src/arena/playClock";
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

console.log("- play clock");
{
  const fake = { t: 0, getTime() { return this.t; } };
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
  // engine with its own play clock: delegated, no UI offset
  const calls: boolean[] = [];
  const eng = { t: 5, getTime() { return this.t; }, setPlayClockPaused: (p: boolean) => calls.push(p) };
  resetPlayClock(eng, true);
  setPlayClockPaused(eng, false);
  eng.t = 50;
  setPlayClockPaused(eng, true);
  assert(calls.join() === "true,false,true", "engine API called");
  assert(heldTime(eng) === 0 && playTime(eng, 50) === 50 && correctStars(eng, ev) === ev, "engine counts it: no UI correction");
}

console.log(`arena-ui-logic: ${checks} checks passed`);
