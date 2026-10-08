// Headless checks for the Arena desktop key mapping (src/arena/keyMap.ts,
// fun-pass spec section 2.5): Space = FIRE before roll unlocks (L1-4) and
// ROLL from L5; F / left click = FIRE; X / right click / Shift = SWAP; the
// rollKey "shift" setting (Space stays FIRE, Shift rolls and stops swapping
// once roll is unlocked); the legend; and the mapped actions against the
// real engine at L4 and L5.
// Run: npx tsx scripts/arena-keymap.ts

import { keyAction, keyLegend, mouseAction } from "../src/arena/keyMap";
import { ArenaEngine } from "../src/game/arena";

let checks = 0;
const assert = (cond: unknown, msg: string) => {
  checks++;
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};

const L4 = { rollUnlocked: false, rollKey: "space" as const };
const L5 = { rollUnlocked: true, rollKey: "space" as const };
const L4s = { rollUnlocked: false, rollKey: "shift" as const };
const L5s = { rollUnlocked: true, rollKey: "shift" as const };

// Space
assert(keyAction("Space", L4) === "fire", "L1-4: Space fires");
assert(keyAction("Space", L5) === "roll", "L5+: Space rolls");
assert(keyAction("Space", L4s) === "fire" && keyAction("Space", L5s) === "fire", "shift setting: Space always fires");
// F
for (const c of [L4, L5, L4s, L5s]) assert(keyAction("KeyF", c) === "fire", "F always fires");
// Shift
for (const code of ["ShiftLeft", "ShiftRight"]) {
  assert(keyAction(code, L4) === "swap" && keyAction(code, L5) === "swap", `${code} swaps (space setting)`);
  assert(keyAction(code, L4s) === "swap", `${code} still swaps before L5 with the shift setting`);
  assert(keyAction(code, L5s) === "roll", `${code} rolls from L5 with the shift setting`);
}
// X / R / pause / unmapped
for (const c of [L4, L5, L4s, L5s]) {
  assert(keyAction("KeyX", c) === "swap", "X swaps");
  assert(keyAction("KeyR", c) === "face", "R faces the threat");
  assert(keyAction("Escape", c) === "pause" && keyAction("KeyP", c) === "pause", "Esc / P pause");
  assert(keyAction("KeyW", c) === null && keyAction("Enter", c) === null, "movement / Enter are not actions");
}
// mouse
assert(mouseAction(0) === "fire" && mouseAction(2) === "swap" && mouseAction(1) === null, "left fire, right swap, middle nothing");
// legend
assert(keyLegend(L4).roll === null && keyLegend(L4).fire.includes("SPACE"), "legend L1-4: no roll, Space fires");
assert(keyLegend(L5).roll === "SPACE" && keyLegend(L5).fire === "CLICK/F" && keyLegend(L5).swap.includes("SHIFT"), "legend L5 space");
assert(keyLegend(L5s).roll === "SHIFT" && keyLegend(L5s).fire.includes("SPACE") && keyLegend(L5s).swap === "X", "legend L5 shift");

// against the real engine: dispatch like useArenaDesktopControls does
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
  return { shots: shots.length, rolls: rolls.length, swaps: swaps.length, state: e.getRoll().state };
};
let r = run(4, "Space", "space");
assert(r.shots === 1 && r.rolls === 0 && r.state === "locked", "engine L4: Space shoots, roll locked");
r = run(5, "Space", "space");
assert(r.rolls === 1 && r.shots === 0, "engine L5: Space rolls");
r = run(5, "KeyF", "space");
assert(r.shots === 1, "engine L5: F shoots");
r = run(5, "ShiftLeft", "shift");
assert(r.rolls === 1 && r.swaps === 0, "engine L5 shift setting: Shift rolls");
r = run(5, "Space", "shift");
assert(r.shots === 1 && r.rolls === 0, "engine L5 shift setting: Space shoots");
r = run(4, "ShiftLeft", "shift");
assert(r.swaps === 1, "engine L4 shift setting: Shift swaps");
// roll(0, 0) without move input rolls backward (-facing)
{
  const e = new ArenaEngine({ random: () => 0.37 });
  e.newGame({ level: 5 });
  e.update(1 / 30);
  const yaw = e.getShooter().yaw;
  e.roll(0, 0);
  e.update(1 / 30);
  const d = e.getRoll();
  assert(Math.abs(d.dirX + Math.cos(yaw)) < 1e-6 && Math.abs(d.dirZ + Math.sin(yaw)) < 1e-6, "no stick input: roll backward");
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
