// Arena 360 default tuning and initial field generation per level.

import { BOMB_COLORS } from "../constants";
import type { RandomFn } from "../grid";
import { SimBomb, SpatialGrid, relaxBombs } from "./arenaPhysics";
import type { ArenaConfig } from "./types";

/*
 * ARENA 360 RULES (numbers = ARENA_CONFIG defaults, all overridable).
 * Read with ArenaEngine.ts (API) and types.ts (data shapes).
 *
 *   Field    L1: 90 bombs in an annulus r=10.5..16.5 around the full 360 deg,
 *            in blobs of 1-2 touching clumps; a clump = 2-4 same-colour
 *            bombs; touching clumps never share a colour. Level n adds 12
 *            bombs (cap 150, reached at L6), the annulus grows outward at the
 *            same density, and base creep +0.01 u/s.
 *   Creep    every idle bomb moves radially inwards at
 *            base * (1 + 0.05 * (dist - arenaRadius)); base = 0.035 u/s at L1,
 *            +0.008 every 20 s of play (a "creepSurge"). Far bombs are faster,
 *            so the field compresses into a wall; circles never overlap
 *            (4 relaxation passes per update). Idle L1 loss: ~66-73 s.
 *   Lose     any idle bomb with dist - radius <= arenaRadius -> gameOver.
 *            Only creep loses: a shot that would stick on/inside the border
            without popping deflects instead ("miss", deflected: true,
            combo reset).
 *   Move     3 u/s top speed, accel 24 / decel 30 u/s^2, centre clamped to
 *            arenaRadius - 0.4 (sliding along the border).
 *   Shoot    fire() needs phase "playing", no shot in flight and the 0.25 s
 *            cooldown elapsed. The shot leaves the muzzle (0.7 in front of the
 *            body) at 18 u/s, straight. Touching an idle bomb -> it sticks at
 *            the contact point (tangent), joins the field and the creep.
 *            After 28 units without contact it fizzles ("miss", combo reset).
 *   Match    connected same-colour group (centres <= 2r * 1.1) of >= 3 that
 *            includes the stuck shot pops. Otherwise combo resets.
 *   Shatter  after a pop, any connected group (any colour) of <= 2 bombs that
 *            touched a popped bomb is now an orphan and shatters (bonus).
 *   Knock    a pop kicks idle bombs within 2 + n*r of its centre outwards
 *            (radially from the arena centre) at 0.5 u/s per removed bomb,
 *            fading with distance; the kick decays at 3/s.
 *   Score    (popped*10 + (popped-3)*10 + shattered*20) * min(combo, 5).
 *   Colours  current/next are always colours still present in the field.
 *   Win      no idle bombs left -> won.
 */

// Default rules. Tuned so level 1 is winnable but tense: an idle player is
// overrun after roughly 70 s (see scripts/arena-sanity.ts for measurements).
export const ARENA_CONFIG: ArenaConfig = {
  arenaRadius: 6,
  bombRadius: 0.45,
  colorCount: BOMB_COLORS.length,

  shooterRadius: 0.4,
  moveSpeed: 3,
  moveAccel: 24,
  moveDecel: 30,
  muzzleOffset: 0.7,

  shotSpeed: 18,
  shotRange: 28,
  fireCooldown: 0.25,

  connectScale: 1.1,
  minMatch: 3,
  orphanMaxSize: 2,
  relaxIterations: 4,

  ringInner: 10.5,
  ringOuter: 16.5,
  bombCount: 90,
  bombsPerLevel: 12,
  maxBombs: 150,
  clumpMin: 2,
  clumpMax: 4,
  blobClumpsMax: 2,

  creepSpeed: 0.035,
  creepPerLevel: 0.01,
  creepDistanceFactor: 0.05,
  surgeInterval: 20,
  surgeStep: 0.008,

  knockbackPerBomb: 0.5,
  knockbackRadius: 2,
  knockbackDamping: 3,

  dangerRange: 3,
  popDuration: 0.3,
  shatterDuration: 0.7,
  shatterSpeed: 3,
};

// Largest |x| / |z| the spatial grid covers (bombs beyond it still work).
export const WORLD_HALF_EXTENT = 34;
// Largest simulation step; protects against tab-switch / first-frame spikes.
export const ARENA_MAX_DT = 1 / 30;

export interface LevelParams {
  level: number;
  count: number; // bombs in the field
  inner: number; // annulus radii of bomb centres
  outer: number;
  creepSpeed: number; // base inward speed before surges
}

// Level n: +bombsPerLevel bombs (capped), same density (the annulus grows
// outward), +creepPerLevel base speed.
export function levelParams(c: ArenaConfig, level: number): LevelParams {
  const lv = Math.max(1, Math.floor(level));
  const count = Math.min(c.maxBombs, c.bombCount + (lv - 1) * c.bombsPerLevel);
  const inner = c.ringInner;
  const baseArea = c.ringOuter ** 2 - inner ** 2;
  const outer = Math.sqrt(inner ** 2 + (baseArea * count) / c.bombCount);
  return { level: lv, count, inner, outer, creepSpeed: c.creepSpeed + (lv - 1) * c.creepPerLevel };
}

const randInt = (lo: number, hi: number, rand: RandomFn) => Math.floor(lo + rand() * (hi - lo + 1));

const blocked = (bombs: readonly SimBomb[], x: number, z: number, minDist: number) => {
  const sq = minDist * minDist;
  return bombs.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < sq);
};

export const makeBomb = (id: number, x: number, z: number, colorIndex: number, stuck = false): SimBomb => ({
  id, x, z, colorIndex, state: "idle", alpha: 1, age: 0, stuck, kick: 0, vx: 0, vz: 0,
});

// Clump sizes summing to `count` (never leaves a lone 1 unless count is 1).
function clumpSizes(c: ArenaConfig, count: number, rand: RandomFn): number[] {
  const sizes: number[] = [];
  let left = count;
  while (left > 0) {
    let s = Math.min(left, randInt(c.clumpMin, c.clumpMax, rand));
    if (left - s === 1) s = s < c.clumpMax ? s + 1 : s - 1;
    sizes.push(s);
    left -= s;
  }
  return sizes;
}

// Spot touching one of `from` (random), free of overlaps, near the annulus.
function adjacentSpot(from: readonly SimBomb[], all: readonly SimBomb[][], p: LevelParams, r: number, rand: RandomFn) {
  let x = 0, z = 0;
  for (let tries = 0; tries < 24; tries++) {
    const f = from[randInt(0, from.length - 1, rand)];
    const a = rand() * Math.PI * 2;
    x = f.x + Math.cos(a) * r * 2.02;
    z = f.z + Math.sin(a) * r * 2.02;
    const d = Math.hypot(x, z);
    if (d >= p.inner - r && d <= p.outer + 2 * r && all.every((g) => !blocked(g, x, z, r * 2))) break;
  }
  return { x, z };
}

// Build the level's field around the full 360 degrees. The field is made of
// BLOBS (one angular sector each, random area-uniform radius in the annulus);
// a blob is 1..blobClumpsMax touching CLUMPS of different colours, and a
// clump is clumpMin..clumpMax touching bombs of one colour. Clumps avoid the
// colours of any bomb within 3 units, so starting groups stay small and
// popping one clump can orphan a small neighbour clump. Ids from `firstId`.
export function generateField(c: ArenaConfig, level: number, rand: RandomFn, firstId: number): SimBomb[] {
  const p = levelParams(c, level);
  const r = c.bombRadius;
  const sizes = clumpSizes(c, p.count, rand);
  const blobs: number[][] = []; // clump sizes per blob
  for (let k = 0; k < sizes.length; ) {
    const n = Math.min(sizes.length - k, randInt(1, c.blobClumpsMax, rand));
    blobs.push(sizes.slice(k, k + n));
    k += n;
  }
  const placed: SimBomb[][] = []; // one entry per clump
  const offset = rand() * Math.PI * 2;
  let id = firstId;

  blobs.forEach((blob, bi) => {
    const blobBombs: SimBomb[] = [];
    for (const size of blob) {
      let seed = { x: 0, z: 0 };
      if (blobBombs.length > 0) {
        seed = adjacentSpot(blobBombs, [...placed, blobBombs], p, r, rand);
      } else {
        for (let tries = 0; tries < 30; tries++) {
          const a = offset + ((bi + rand()) / blobs.length) * Math.PI * 2;
          const rad = Math.sqrt(p.inner ** 2 + rand() * (p.outer ** 2 - p.inner ** 2));
          seed = { x: Math.cos(a) * rad, z: Math.sin(a) * rad };
          if (placed.every((g) => !blocked(g, seed.x, seed.z, r * 2 * 1.8))) break;
        }
      }
      const near = new Set<number>();
      for (const g of placed) for (const b of g) if (Math.hypot(b.x - seed.x, b.z - seed.z) < 3) near.add(b.colorIndex);
      for (const b of blobBombs) near.add(b.colorIndex);
      const all = [...Array(c.colorCount).keys()];
      const free = all.filter((i) => !near.has(i));
      const pool = free.length > 0 ? free : all;
      const color = pool[randInt(0, pool.length - 1, rand)];

      const clump: SimBomb[] = [makeBomb(id++, seed.x, seed.z, color)];
      for (let m = 1; m < size; m++) {
        const s = adjacentSpot(clump, [...placed, blobBombs, clump], p, r, rand);
        clump.push(makeBomb(id++, s.x, s.z, color));
      }
      placed.push(clump);
      blobBombs.push(...clump);
    }
  });

  // Remove any residual overlap from fallback placements
  const bombs = placed.flat();
  relaxBombs(bombs, new SpatialGrid(WORLD_HALF_EXTENT, r * 2 * c.connectScale), r, 12, []);
  return bombs;
}
