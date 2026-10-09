// Headless checks for the Arena desktop key mapping (src/arena/keyMap.ts):
// roll is available from L1, so Space = ROLL on every level (default), F /
// left click = FIRE, Shift / X / right click = SWAP; with rollKey "shift",
// Shift = ROLL and Space = FIRE. Also the legend, the live setting switch,
// the real engine on L1-L5, the backward roll and fever hold-to-fire.
// Run: npx tsx scripts/arena-keymap.ts

import { keyAction, keyLegend, mouseAction } from "../src/arena/keyMap";
import { ArenaEngine } from "../src/game/arena";

let checks = 0;
const assert = (cond: unknown, msg: string) => {
  checks++;
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};

const SP = { rollKey: "space" as const };
const SH = { rollKey: "shift" as const };
const SPu = { rollKey: "space" as const, rollUnlocked: true };
const SHu = { rollKey: "shift" as const, rollUnlocked: true };
const SPl = { rollKey: "space" as const, rollUnlocked: false }; // custom levelDef roll: false only
const SHl = { rollKey: "shift" as const, rollUnlocked: false };

// default "space": Space rolls on every level; click / F fire; Shift / X / right click swap
assert(keyAction("Space", SP) === "roll" && keyAction("Space", SPu) === "roll", "space setting: Space rolls (every level)");
for (const code of ["ShiftLeft", "ShiftRight"]) assert(keyAction(code, SP) === "swap", `space setting: ${code} swaps`);
// "shift": Shift rolls, Space fires, X / right click swap
assert(keyAction("Space", SH) === "fire" && keyAction("Space", SHu) === "fire", "shift setting: Space fires");
for (const code of ["ShiftLeft", "ShiftRight"]) assert(keyAction(code, SH) === "roll" && keyAction(code, SHu) === "roll", `shift setting: ${code} rolls`);
// a level without roll (custom levelDef only): old meanings
assert(keyAction("Space", SPl) === "fire" && keyAction("ShiftLeft", SHl) === "swap", "roll: false level: Space fires, Shift swaps");
for (const c of [SP, SH, SPu, SHu, SPl, SHl]) {
  assert(keyAction("KeyF", c) === "fire", "F always fires");
  assert(keyAction("KeyX", c) === "swap", "X swaps");
  assert(keyAction("KeyR", c) === "face", "R faces the threat");
  assert(keyAction("Escape", c) === "pause" && keyAction("KeyP", c) === "pause", "Esc / P pause");
  assert(keyAction("KeyW", c) === null && keyAction("Enter", c) === null, "movement / Enter are not actions");
}
// mouse
assert(mouseAction(0) === "fire" && mouseAction(2) === "swap" && mouseAction(1) === null, "left fire, right swap, middle nothing");
// legend
assert(keyLegend(SP).roll === "SPACE" && keyLegend(SP).fire === "CLICK/F" && keyLegend(SP).swap === "X/SHIFT", "legend space");
assert(keyLegend(SH).roll === "SHIFT" && keyLegend(SH).fire === "CLICK/F/SPACE" && keyLegend(SH).swap === "X", "legend shift");
assert(keyLegend(SPl).roll === null, "legend without roll");

// against the real engine: dispatch like useArenaDesktopControls does, on L1-L5 and a boss level
const run = (level: number, code: string, rollKey: "space" | "shift") => {
  const e = new ArenaEngine({ random: () => 0.37 });
  e.newGame({ level });
  for (let i = 0; i < 3; i++) e.update(1 / 30);
  const shots: number[] = [];
  const rolls: number[] = [];
  const swaps: number[] = [];
  e.on("shoot", () => shots.push(1));
  e.on("rollStart", () => rolls.push(1));
  e.on("swap", () => swaps.push(1));
  const a = keyAction(code, { rollUnlocked: e.getLevelDef().roll, rollKey });
  if (a === "fire") e.fire();
  else if (a === "roll") e.roll(0, 0);
  else if (a === "swap") e.swapBomb();
  e.update(1 / 30);
  return { shots: shots.length, rolls: rolls.length, swaps: swaps.length };
};
for (const lv of [1, 2, 3, 4, 5]) {
  let r = run(lv, "Space", "space");
  assert(r.rolls === 1 && r.shots === 0, `engine L${lv}: Space rolls (space setting), never fires`);
  r = run(lv, "KeyF", "space");
  assert(r.shots === 1 && r.rolls === 0, `engine L${lv}: F fires`);
  r = run(lv, "ShiftLeft", "space");
  assert(r.swaps === 1 && r.rolls === 0, `engine L${lv}: Shift swaps (space setting)`);
  r = run(lv, "ShiftLeft", "shift");
  assert(r.rolls === 1 && r.swaps === 0, `engine L${lv}: Shift rolls (shift setting)`);
  r = run(lv, "Space", "shift");
  assert(r.shots === 1 && r.rolls === 0, `engine L${lv}: Space fires (shift setting)`);
}
// the setting is read per key press: switching it mid-level takes effect at once
{
  const e = new ArenaEngine({ random: () => 0.37 });
  e.newGame({ level: 1 });
  e.update(1 / 30);
  let rollKey: "space" | "shift" = "space";
  const ctx = () => ({ rollUnlocked: e.getLevelDef().roll, rollKey });
  assert(keyAction("Space", ctx()) === "roll", "before the switch: Space rolls");
  rollKey = "shift";
  assert(keyAction("Space", ctx()) === "fire" && keyAction("ShiftLeft", ctx()) === "roll", "after the switch: no restart needed");
}
// roll(0, 0) without move input and no roller near: a sideways dodge (perpendicular to the facing)
{
  const e = new ArenaEngine({ random: () => 0.37 });
  e.newGame({ level: 5 });
  e.update(1 / 30);
  const yaw = e.getShooter().yaw;
  e.roll(0, 0);
  e.update(1 / 30);
  const d = e.getRoll();
  assert(Math.abs(d.dirX * Math.cos(yaw) + d.dirZ * Math.sin(yaw)) < 1e-6 && Math.abs(Math.hypot(d.dirX, d.dirZ) - 1) < 1e-6, "no stick input: sideways smart roll");
}
// fever hold: setFireHeld auto-fires only in fever
{
  const e = new ArenaEngine({ random: () => 0.37 });
  e.newGame({ level: 2 });
  let shots = 0;
  e.on("shoot", () => shots++);
  e.setFireHeld(true);
  for (let i = 0; i < 30; i++) e.update(1 / 30);
  assert(shots === 0, "hold outside fever: no auto-fire");
  e.debugSetFever(100);
  for (let i = 0; i < 30; i++) e.update(1 / 30);
  assert(shots >= 3, `hold in fever: auto-fire (${shots} in 1 s)`);
  e.setFireHeld(false);
}

console.log(`arena-keymap: ${checks} checks passed`);
