// Arena 360 desktop key / mouse mapping (fun-pass spec section 2.5; roll is
// available from L1), pure so scripts/arena-keymap.ts can test it headlessly:
//   left click / F = FIRE (hold = auto-fire during fever)
//   rollKey "space" (default): Space = ROLL, Shift / X / right click = SWAP
//   rollKey "shift":           Shift = ROLL, Space = FIRE, X / right click = SWAP
//   R face threat, Esc / P pause, WASD / arrows move, Q / E turn
// `rollUnlocked` only matters for a custom levelDef with roll: false (then
// the roll key falls back to its old meaning: Space fires, Shift swaps).

import type { RollKey } from "../ui/settings";

export type ArenaAction = "fire" | "roll" | "swap" | "face" | "pause";

export interface KeyContext {
  rollKey: RollKey;
  rollUnlocked?: boolean; // engine.getLevelDef().roll (true on every table level); default true
}

export function keyAction(code: string, ctx: KeyContext): ArenaAction | null {
  const unlocked = ctx.rollUnlocked !== false;
  const rollOnShift = unlocked && ctx.rollKey === "shift";
  switch (code) {
    case "Space":
      return unlocked && ctx.rollKey === "space" ? "roll" : "fire";
    case "KeyF":
      return "fire";
    case "ShiftLeft":
    case "ShiftRight":
      return rollOnShift ? "roll" : "swap";
    case "KeyX":
      return "swap";
    case "KeyR":
      return "face";
    case "Escape":
    case "KeyP":
      return "pause";
    default:
      return null;
  }
}

// Mouse buttons: 0 = left (fire), 2 = right (swap).
export function mouseAction(button: number): ArenaAction | null {
  return button === 0 ? "fire" : button === 2 ? "swap" : null;
}

// Labels for the HUD legend / tips.
export function keyLegend(ctx: KeyContext): { fire: string; roll: string | null; swap: string } {
  if (ctx.rollUnlocked === false) return { fire: "CLICK/F/SPACE", roll: null, swap: "X/SHIFT" };
  return ctx.rollKey === "shift"
    ? { fire: "CLICK/F/SPACE", roll: "SHIFT", swap: "X" }
    : { fire: "CLICK/F", roll: "SPACE", swap: "X/SHIFT" };
}
