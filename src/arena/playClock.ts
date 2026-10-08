// The par / star clock only counts REAL play: not the intro sweep, the
// CLICK TO PLAY gate, the L1 tutorial, the L5 roll lesson, pause or the end
// sequence. Every UI call site goes through setPlayClockPaused().
//
// NATIVE (the real ArenaEngine): the engine owns the par clock,
// `setPlayClockPaused(paused)` (or its alias `setClockPaused`) + `getPlayTime()`. It already stops the clock while
// the creep is paused (intro, tutorials) and on dt 0 (pause), and
// getStarProgress().time / won.time / levelStars.time / bossDefeated.time are
// all par-clock times. The UI only adds the gates the creep pause doesn't
// cover (CLICK TO PLAY) and must NOT subtract anything itself.
//
// FALLBACK (an engine with neither method, e.g. older builds / fakes): the
// UI tracks the held game time and playTime() / correctStars() subtract it.
// Framework-free (scripts/arena-ui-logic.ts tests both paths).

export interface PlayClockEngine {
  getTime(): number;
  setPlayClockPaused?: (paused: boolean) => void; // preferred engine name
  setClockPaused?: (paused: boolean) => void; // alias
  getPlayTime?: () => number;
}

interface ClockState {
  paused: boolean;
  since: number; // engine time when the hold started (fallback)
  offset: number; // game seconds held so far this level (fallback)
}

const states = new WeakMap<object, ClockState>();

// Does the engine keep the par clock itself? (either method name)
export const nativePlayClock = (e: PlayClockEngine) =>
  typeof e.setPlayClockPaused === "function" || typeof e.setClockPaused === "function";

// Engine call: setPlayClockPaused preferred, setClockPaused as the fallback alias.
function engineHold(e: PlayClockEngine, paused: boolean) {
  if (typeof e.setPlayClockPaused === "function") e.setPlayClockPaused(paused);
  else if (typeof e.setClockPaused === "function") e.setClockPaused(paused);
}

function state(e: PlayClockEngine): ClockState {
  let s = states.get(e);
  if (!s) {
    s = { paused: false, since: 0, offset: 0 };
    states.set(e, s);
  }
  return s;
}

// Hold / release the play clock (idempotent).
export function setPlayClockPaused(e: PlayClockEngine, paused: boolean) {
  const s = state(e);
  if (nativePlayClock(e)) {
    engineHold(e, paused);
    s.paused = paused;
    return;
  }
  if (s.paused === paused) return;
  if (paused) s.since = e.getTime();
  else s.offset += Math.max(0, e.getTime() - s.since);
  s.paused = paused;
}

// After newGame(): a fresh level clock, held or not.
export function resetPlayClock(e: PlayClockEngine, paused: boolean) {
  const s = state(e);
  s.offset = 0;
  s.since = e.getTime();
  s.paused = paused;
  if (nativePlayClock(e)) engineHold(e, paused);
}

export const isPlayClockPaused = (e: PlayClockEngine) => state(e).paused;

// Game seconds the UI must subtract from an engine time (always 0 when native).
export function heldTime(e: PlayClockEngine): number {
  if (nativePlayClock(e)) return 0;
  const s = state(e);
  return s.offset + (s.paused ? Math.max(0, e.getTime() - s.since) : 0);
}

// Par time of real play: the engine's getPlayTime() when native, else the
// raw time minus the UI-held time.
export function playTime(e: PlayClockEngine, rawTime = e.getTime()): number {
  if (nativePlayClock(e)) return typeof e.getPlayTime === "function" ? e.getPlayTime() : rawTime;
  return Math.max(0, rawTime - heldTime(e));
}

// Fallback only: fix a levelStars-like result with the UI-held time (no-op when native).
export function correctStars<T extends { time: number; par: number; fast: boolean; count: number }>(e: PlayClockEngine, ev: T): T {
  const held = heldTime(e);
  if (held <= 0) return ev;
  const time = Math.max(0, ev.time - held);
  const fast = ev.fast || time <= ev.par;
  return { ...ev, time, fast, count: ev.count + (fast && !ev.fast ? 1 : 0) };
}
