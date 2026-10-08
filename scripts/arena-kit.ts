// Shared helpers for the Arena 360 headless scripts (fun-pass tests + balance).

import { ARENA_CONFIG, ArenaConfig, ArenaEngine, ArenaEvents, ArenaFunOverrides, LevelDef, levelDef } from "../src/game/arena";
import type { ArenaCore, Systems } from "../src/game/arena/arenaCore";
import { makeBomb } from "../src/game/arena/arenaLayout";
import type { SimBomb } from "../src/game/arena/arenaPhysics";
import type { BombKind } from "../src/game/arena/funTypes";

export const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};
export const near = (a: number, b: number, tol: number, msg: string) =>
  assert(Math.abs(a - b) <= tol, `${msg} (got ${a.toFixed(4)}, want ${b.toFixed(4)} +- ${tol})`);
export const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const DT = 1 / 60;
export const ok = (name: string, extra = "") => console.log(`  ok  ${name}${extra ? `  (${extra})` : ""}`);

export const make = (seed: number, config?: Partial<ArenaConfig>, fun?: ArenaFunOverrides) =>
  new ArenaEngine({ random: mulberry32(seed), config, fun });

// Engine internals for white-box tests (not part of the public API).
export const internals = (e: ArenaEngine) => e as unknown as { core: ArenaCore; sys: Systems };

export const def = (level: number, patch: Partial<LevelDef> = {}, config: ArenaConfig = ARENA_CONFIG): LevelDef => ({
  ...levelDef(config, level),
  ...patch,
});

// Advance n seconds (stops early when the phase leaves "playing").
export const run = (e: ArenaEngine, seconds: number, each?: () => void) => {
  for (let i = 0; i < Math.round(seconds / DT) && e.getPhase() === "playing"; i++) {
    each?.();
    e.update(DT);
  }
};
export const until = (e: ArenaEngine, cond: () => boolean, maxSeconds = 10) => {
  let t = 0;
  while (!cond() && t < maxSeconds && e.getPhase() === "playing") {
    e.update(DT);
    t += DT;
  }
  return t;
};

export interface Spec { x: number; z: number; c: number; kind?: BombKind; armor?: 0 | 1 }

// Replace the whole field with exactly these bombs (shooter at the origin
// facing -z). Subsystem lists (ticking / rollers) are rebuilt.
export function arrange(e: ArenaEngine, specs: Spec[], current?: number) {
  const { core, sys } = internals(e);
  const pool = core.active.slice();
  while (pool.length < specs.length) pool.push(makeBomb(core.nextId++, 0, 0, 0));
  const keep: SimBomb[] = [];
  specs.forEach((s, i) => {
    const b = pool[i];
    Object.assign(b, {
      x: s.x, z: s.z, colorIndex: s.c, kind: s.kind ?? "normal", armor: s.armor ?? (s.kind === "armored" ? 1 : 0),
      timer: s.kind === "ticking" ? core.def.tickTimer : null, armed: false, telegraph: -1, kick: 0, band: 0, clump: i,
    });
    keep.push(b);
  });
  core.bombs = keep;
  core.refreshActive();
  sys.ticking.reset();
  sys.rollers.reset();
  if (current !== undefined) core.current = core.next = current;
  core.touch();
  return keep;
}

// Collect events of one kind.
export function capture<K extends keyof ArenaEvents>(e: ArenaEngine, name: K): ArenaEvents[K][] {
  const out: ArenaEvents[K][] = [];
  e.on(name, (p) => out.push(p));
  return out;
}

export const fireAt = (e: ArenaEngine, x: number, z: number) => {
  e.aimAt(x, z);
  return e.fire();
};

export const flushShots = (e: ArenaEngine, max = 3) => until(e, () => e.getShots().length === 0, max);
