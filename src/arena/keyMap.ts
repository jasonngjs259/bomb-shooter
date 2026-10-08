// Arena 360 desktop key / mouse mapping (fun-pass spec section 2.5), pure so
// scripts/arena-keymap.ts can test it headlessly:
//   left click / F = FIRE (hold = auto-fire during fever)
//   Space         = ROLL once roll is unlocked (L5+), else FIRE (L1-4 keep
//                   the old muscle memory)
//   X / right click / Shift = SWAP
//   settings rollKey "shift": Space stays FIRE, Shift = ROLL (L5+) and Shift
//                   no longer swaps (before L5 it still swaps)
//   R face threat, Esc / P pause, WASD / arrows move, Q / E turn

import type { RollKey } from "../ui/settings";

export type ArenaAction = "fire" | "roll" | "swap" | "face" | "pause";

export interface KeyContext {
  rollUnlocked: boolean; // engine.getLevelDef().roll
  rollKey: RollKey;
}

export function keyAction(code: string, ctx: KeyContext): ArenaAction | null {
  const rollOnShift = ctx.rollUnlocked && ctx.rollKey === "shift";
  switch (code) {
    case "Space":
      return ctx.rollUnlocked && ctx.rollKey === "space" ? "roll" : "fire";
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
  if (!ctx.rollUnlocked) return { fire: "CLICK/SPACE", roll: null, swap: "X/SHIFT" };
  return ctx.rollKey === "shift"
    ? { fire: "CLICK/F/SPACE", roll: "SHIFT", swap: "X" }
    : { fire: "CLICK/F", roll: "SPACE", swap: "X/SHIFT" };
}
