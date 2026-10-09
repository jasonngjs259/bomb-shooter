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
import {
  enterFullscreen, exitFullscreen, fullscreenEnv, fullscreenMode, FsWindow, onFullscreenChange, prefersFullscreen, setFullscreenLandscape,
  shouldOfferFullscreen,
} from "../src/ui/fullscreen";

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
    // top-right FULL SCREEN + Settings (44pt each, 12 apart, right 16, top 8 + inset 0..47):
    // clear of the logo either vertically or horizontally ("MB" <= 2.1 em wide)
    {
      const btn = { x0: w - 16 - 44 - 12 - 44 - 4, y1: 8 + 47 + 44 + 4 };
      const logoTop = tl.logoY - Math.max(tl.fontSize * 0.6, tl.slotSize / 2);
      const logoRight = tl.slotX + tl.slotSize / 2 + tl.fontSize * (0.04 + 2.1);
      assert(logoTop >= btn.y1 - 47 || logoRight <= btn.x0, `${tag}: full-screen + settings buttons clear of the logo`);
    }
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

console.log("- mobile-web full screen (fake window / document)");
async function fullscreenChecks() {
  interface Fake {
    touch?: boolean; coarse?: boolean; standalone?: "nav" | "media-standalone" | "media-fullscreen" | null; api?: "std" | "webkit" | null;
    ios?: boolean; landscape?: boolean; reject?: boolean;
  }
  const make = (o: Fake) => {
    const calls: string[] = [];
    const listeners = new Map<string, Set<() => void>>();
    const store = new Map<string, string>();
    const doc: Record<string, unknown> = {
      fullscreenElement: null,
      documentElement: {} as Record<string, unknown>,
      addEventListener: (t: string, cb: () => void) => (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(cb),
      removeEventListener: (t: string, cb: () => void) => listeners.get(t)?.delete(cb),
      exitFullscreen: () => {
        calls.push("exit");
        doc.fullscreenElement = null;
        return Promise.resolve();
      },
    };
    const el = doc.documentElement as Record<string, unknown>;
    const enter = (name: string) => (opts?: { navigationUI?: string }) => {
      calls.push(`${name}:${opts?.navigationUI ?? ""}`);
      if (o.reject) return Promise.reject(new Error("denied"));
      doc.fullscreenElement = el;
      return Promise.resolve();
    };
    if (o.api === "std") el.requestFullscreen = enter("request");
    if (o.api === "webkit") el.webkitRequestFullscreen = enter("webkit");
    const w: FsWindow = {
      document: doc as FsWindow["document"],
      navigator: {
        maxTouchPoints: o.touch ? 5 : 0, standalone: o.standalone === "nav" ? true : undefined,
        userAgent: o.ios ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari" : "Mozilla/5.0 (Linux; Android 14) Chrome",
      },
      matchMedia: (q: string) => ({
        matches:
          (q === "(pointer: coarse)" && !!o.coarse) ||
          (q === "(display-mode: standalone)" && o.standalone === "media-standalone") ||
          (q === "(display-mode: fullscreen)" && o.standalone === "media-fullscreen"),
      }),
      screen: { orientation: { lock: (x: string) => (calls.push(`lock:${x}`), Promise.reject(new Error("no lock"))) } },
      innerWidth: o.landscape ? 844 : 390,
      innerHeight: o.landscape ? 390 : 844,
      localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    };
    return { w, calls, doc, fire: (t: string) => listeners.get(t)?.forEach((cb) => cb()) };
  };
  // predicate: web x touch x standalone x already full screen x API
  assert(!shouldOfferFullscreen(fullscreenEnv(make({ touch: true, api: "std" }).w, false)), "native: never");
  assert(!shouldOfferFullscreen(fullscreenEnv(undefined, true)), "no window: never");
  assert(!shouldOfferFullscreen(fullscreenEnv(make({ api: "std" }).w, true)), "desktop mouse (no touch, fine pointer): hidden");
  assert(shouldOfferFullscreen(fullscreenEnv(make({ touch: true, api: "std" }).w, true)), "touch phone web: shown");
  assert(shouldOfferFullscreen(fullscreenEnv(make({ coarse: true, api: "std" }).w, true)), "coarse pointer: shown");
  for (const st of ["nav", "media-standalone", "media-fullscreen"] as const) {
    assert(!shouldOfferFullscreen(fullscreenEnv(make({ touch: true, api: "std", standalone: st }).w, true)), `standalone (${st}): hidden`);
  }
  // API full screen + a Chrome build that also reports display-mode: fullscreen: NOT a home-screen app
  {
    const f = make({ touch: true, api: "std", standalone: "media-fullscreen" });
    assert(!shouldOfferFullscreen(fullscreenEnv(f.w, true)), "display-mode fullscreen without fullscreenElement: home-screen app, hidden");
    f.doc.fullscreenElement = f.doc.documentElement;
    const env = fullscreenEnv(f.w, true);
    assert(env.active && !env.standalone && shouldOfferFullscreen(env), "display-mode fullscreen + fullscreenElement: API full screen, exit button stays");
    f.doc.fullscreenElement = null;
    f.doc.webkitFullscreenElement = f.doc.documentElement;
    assert(shouldOfferFullscreen(fullscreenEnv(f.w, true)) && fullscreenEnv(f.w, true).active, "same with webkitFullscreenElement");
  }
  // modes
  assert(fullscreenMode(fullscreenEnv(make({ touch: true, api: "std" }).w, true)) === "api", "API -> api mode");
  assert(fullscreenMode(fullscreenEnv(make({ touch: true, api: "webkit" }).w, true)) === "api", "webkit API -> api mode");
  const iosEnv = fullscreenEnv(make({ touch: true, api: null, ios: true }).w, true);
  assert(fullscreenMode(iosEnv) === "ios-hint" && iosEnv.ios, "iPhone Safari (no API) -> Add to Home Screen hint");
  assert(fullscreenMode(fullscreenEnv(make({ api: null }).w, true)) === "none", "desktop: none");
  // enter (in the tap), landscape lock attempt ignored on failure, exit, change events
  {
    const f = make({ touch: true, api: "std" });
    setFullscreenLandscape(true);
    const r = await enterFullscreen(f.w);
    assert(r === "entered" && f.calls[0] === "request:hide", "requestFullscreen({ navigationUI: hide })");
    assert(f.calls.includes("lock:landscape"), "Arena: landscape lock attempted (failure ignored)");
    assert(fullscreenEnv(f.w, true).active && shouldOfferFullscreen(fullscreenEnv(f.w, true)), "full screen: still offered (exit icon)");
    assert(prefersFullscreen(f.w), "choice remembered");
    let changes = 0;
    const off = onFullscreenChange(f.w, () => changes++);
    f.doc.fullscreenElement = null; // user swipes out
    f.fire("fullscreenchange");
    f.fire("webkitfullscreenchange");
    assert(changes === 2 && !fullscreenEnv(f.w, true).active, "fullscreenchange / webkitfullscreenchange tracked");
    assert(!prefersFullscreen(f.w), "swipe / back out of full screen clears the remembered choice");
    off();
    f.fire("fullscreenchange");
    assert(changes === 2, "unsubscribed");
    // entering again (change event with fullscreenElement set) keeps the choice; leaving clears it
    const off2 = onFullscreenChange(f.w, () => undefined);
    await enterFullscreen(f.w);
    f.fire("fullscreenchange");
    assert(prefersFullscreen(f.w), "change event while full screen keeps the choice");
    f.doc.fullscreenElement = null;
    f.fire("webkitfullscreenchange");
    assert(!prefersFullscreen(f.w), "webkitfullscreenchange out clears it");
    off2();
    await enterFullscreen(f.w);
    await exitFullscreen(f.w);
    assert(f.calls.includes("exit") && !fullscreenEnv(f.w, true).active && !prefersFullscreen(f.w), "exitFullscreen + choice cleared");
    setFullscreenLandscape(false);
  }
  {
    const f = make({ touch: true, api: "webkit", landscape: false });
    assert((await enterFullscreen(f.w)) === "entered" && f.calls[0] === "webkit:hide" && !f.calls.includes("lock:landscape"), "webkit fallback; portrait title: no lock");
    const g = make({ touch: true, api: "std", landscape: true });
    await enterFullscreen(g.w);
    assert(g.calls.includes("lock:landscape"), "landscape device: lock attempted");
    const d = make({ touch: true, api: "std", reject: true });
    assert((await enterFullscreen(d.w)) === "failed" && !prefersFullscreen(d.w), "denied request: failed, not remembered");
    const i = make({ touch: true, api: null, ios: true });
    assert((await enterFullscreen(i.w)) === "hint" && i.calls.length === 0, "iOS: no API call, hint");
  }
}

fullscreenChecks().then(
  () => console.log(`arena-ui-logic: ${checks} checks passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
