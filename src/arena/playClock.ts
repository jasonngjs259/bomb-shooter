// The par / star clock should only count REAL play: not the intro sweep,
// the CLICK TO PLAY gate, the L1 tutorial, the L5 roll lesson, pause or the
// end sequence. Every UI call site goes through setPlayClockPaused() so the
// engine hook is a one-line wiring:
//   - if the engine has `setPlayClockPaused(paused)` (engine fix in flight),
//     it is called and the engine's star time is trusted as is;
//   - otherwise the UI tracks the held game time itself (offset) and the HUD
//     / end card read playTime() / correctStars() instead of the raw time.
// Framework-free (scripts/arena-keymap.ts tests it with a fake engine).

export interface PlayClockEngine {
  getTime(): number;
  setPlayClockPaused?: (paused: boolean) => void;
}

interface ClockState {
  paused: boolean;
  since: number; // engine time when the hold started
  offset: number; // game seconds held so far this level
}

const states = new WeakMap<object, ClockState>();

const native = (e: PlayClockEngine) => typeof e.setPlayClockPaused === "function";

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
  if (native(e)) e.setPlayClockPaused!(paused);
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
  if (native(e)) e.setPlayClockPaused!(paused);
}

export const isPlayClockPaused = (e: PlayClockEngine) => state(e).paused;

// Game seconds the UI must subtract from the engine's star time (0 when the engine does it).
export function heldTime(e: PlayClockEngine): number {
  if (native(e)) return 0;
  const s = state(e);
  return s.offset + (s.paused ? Math.max(0, e.getTime() - s.since) : 0);
}

// Star / par time of real play.
export const playTime = (e: PlayClockEngine, rawTime: number) => Math.max(0, rawTime - heldTime(e));

// Fix a levelStars-like result with the UI-held time (no-op once the engine counts it).
export function correctStars<T extends { time: number; par: number; fast: boolean; count: number }>(e: PlayClockEngine, ev: T): T {
  const held = heldTime(e);
  if (held <= 0) return ev;
  const time = Math.max(0, ev.time - held);
  const fast = ev.fast || time <= ev.par;
  return { ...ev, time, fast, count: ev.count + (fast && !ev.fast ? 1 : 0) };
}
