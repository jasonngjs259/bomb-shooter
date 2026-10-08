// Arena 360 default tuning and initial field generation per level.

import { BOMB_COLORS } from "../constants";
import type { RandomFn } from "../grid";
import { SimBomb, SpatialGrid, relaxBombs } from "./arenaPhysics";
import type { ArenaConfig } from "./types";
import { BandSpec, levelDef } from "./arenaLevels";

/*
 * ARENA 360 RULES (numbers = ARENA_CONFIG defaults, all overridable).
 * Read with ArenaEngine.ts (API) and types.ts (data shapes).
 *
 *   Field    Gentle start: L1 60 bombs (creep x0.85), L2 75 (x0.92), L3 90
 *            (x1), then +12 per level; bombs in an annulus r=10.5..16.5 (L3)
 *            around the full 360 deg,
 *            in blobs of 1-2 touching clumps; a clump = 2-4 same-colour
 *            bombs; touching clumps never share a colour. Level n adds 12
 *            bombs (cap 150, reached at L6), the annulus grows outward at the
 *            same density, and base creep +0.01 u/s.
 *   Creep    every idle bomb moves radially inwards at
 *            base * (1 + 0.05 * (dist - arenaRadius)); base = 0.035 u/s at L3
 *            (x0.85 at L1, x0.92 at L2, +0.01 per level after L3),
 *            +0.008 every 20 s of play (a "creepSurge"). Far bombs are faster,
 *            so the field compresses into a wall; circles never overlap
 *            (4 relaxation passes per update).
 *   Lose     any idle bomb with dist - radius <= arenaRadius -> gameOver.
 *            Only creep loses: a shot that would NOT pop and would stick
 *            with its edge within deflectMargin (1.0) of the border deflects
 *            ("miss", deflected: true, combo reset), and a freshly stuck shot
 *            can't end the game for stuckGrace (1.5 s).
 *   Move     3 u/s top speed. Velocity follows the input through a
 *            critically damped spring: omega 22 speeding up (95% in 215 ms),
 *            26 slowing down (95% in 180 ms), 18 when reversing. Centre
 *            clamped to arenaRadius - 0.4 (sliding along the border).
 *   Shoot    fire() needs phase "playing", no shot in flight and the 0.25 s
 *            cooldown elapsed. The shot leaves the muzzle (0.9 in front of the
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
  moveAccel: 22,
  moveDecel: 26,
  moveReverse: 18,
  muzzleOffset: 0.9, // measured: the character's arm-cannon tip at combat rest

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
  earlyLevels: [
    { bombs: 60, creepScale: 0.85 },
    { bombs: 75, creepScale: 0.92 },
  ],
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
  deflectMargin: 1.0,
  stuckGrace: 1.5,
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

// Level n field size and base creep (from the LEVELS table, arenaLevels.ts).
// Kept for older callers; the engine uses levelDef() + fieldBands().
export function levelParams(c: ArenaConfig, level: number): LevelParams {
  const d = levelDef(c, level);
  const outer = Math.sqrt(c.ringInner ** 2 + ((c.ringOuter ** 2 - c.ringInner ** 2) * d.bombs) / c.bombCount);
  return { level: d.level, count: d.bombs, inner: c.ringInner, outer, creepSpeed: d.creepBase };
}

const randInt = (lo: number, hi: number, rand: RandomFn) => Math.floor(lo + rand() * (hi - lo + 1));

const blocked = (bombs: readonly SimBomb[], x: number, z: number, minDist: number) => {
  const sq = minDist * minDist;
  return bombs.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < sq);
};

export const makeBomb = (id: number, x: number, z: number, colorIndex: number, stuck = false): SimBomb => ({
  id, x, z, colorIndex, state: "idle", alpha: 1, age: 0, stuck, kind: "normal", armor: 0, band: 0, timer: null,
  armed: false, telegraph: -1, kick: 0, vx: 0, vz: 0, clump: -1,
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

const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// Inside one of the band's angular gaps (with the bomb's own half-width)?
function inGap(band: BandSpec, x: number, z: number, r: number) {
  if (band.gaps.length === 0) return false;
  const d = Math.hypot(x, z), a = Math.atan2(z, x), pad = Math.asin(Math.min(1, r / Math.max(d, r)));
  return band.gaps.some((g) => angDist(a, g.angle) < g.half + pad);
}

// Spot touching one of `from` (random), free of overlaps, near the annulus.
function adjacentSpot(from: readonly SimBomb[], all: readonly SimBomb[][], p: BandSpec, r: number, rand: RandomFn) {
  let x = 0, z = 0;
  for (let tries = 0; tries < 24; tries++) {
    const f = from[randInt(0, from.length - 1, rand)];
    const a = rand() * Math.PI * 2;
    x = f.x + Math.cos(a) * r * 2.02;
    z = f.z + Math.sin(a) * r * 2.02;
    const d = Math.hypot(x, z);
    if (d >= p.inner - r && d <= p.outer + 2 * r && !inGap(p, x, z, r) && all.every((g) => !blocked(g, x, z, r * 2))) break;
  }
  return { x, z };
}

// u in [0, 1) -> an angle outside the band's gaps (area-uniform over the allowed arc).
function gapFreeAngle(band: BandSpec, u: number) {
  const gaps = [...band.gaps].sort((a, b) => a.angle - b.angle);
  const segs = gaps.map((g, i) => {
    const next = gaps[(i + 1) % gaps.length];
    let end = next.angle - next.half;
    const from = g.angle + g.half;
    while (end <= from) end += Math.PI * 2;
    return { from, len: end - from };
  });
  const total = segs.reduce((s, x) => s + x.len, 0);
  let t = u * total;
  for (const s of segs) {
    if (t < s.len) return s.from + t;
    t -= s.len;
  }
  return segs[0].from;
}

// Build one band of the field. The field is made of BLOBS (one angular
// sector each, random area-uniform radius in the annulus); a blob is
// 1..blobClumpsMax touching CLUMPS of different colours, and a clump is
// clumpMin..clumpMax touching bombs of one colour. Clumps avoid the colours of
// any bomb within 3 units, so starting groups stay small and popping one
// clump can orphan a small neighbour clump.
function generateBand(c: ArenaConfig, p: BandSpec, rand: RandomFn, firstId: number, placed: SimBomb[][]): SimBomb[] {
  const r = c.bombRadius;
  const sizes = clumpSizes(c, p.count, rand);
  const blobs: number[][] = []; // clump sizes per blob
  for (let k = 0; k < sizes.length; ) {
    const n = Math.min(sizes.length - k, randInt(1, c.blobClumpsMax, rand));
    blobs.push(sizes.slice(k, k + n));
    k += n;
  }
  const offset = p.gaps.length === 0 ? rand() * Math.PI * 2 : 0;
  const first = placed.length;
  let id = firstId;

  blobs.forEach((blob, bi) => {
    const blobBombs: SimBomb[] = [];
    for (const size of blob) {
      let seed = { x: 0, z: 0 };
      if (blobBombs.length > 0) {
        seed = adjacentSpot(blobBombs, [...placed, blobBombs], p, r, rand);
      } else {
        for (let tries = 0; tries < 30; tries++) {
          const u = (bi + rand()) / blobs.length;
          const a = p.gaps.length === 0 ? offset + u * Math.PI * 2 : gapFreeAngle(p, u);
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
      for (const b of clump) {
        b.clump = placed.length;
        b.band = p.band;
      }
      placed.push(clump);
      blobBombs.push(...clump);
    }
  });
  return placed.slice(first).flat();
}

// Push any bomb sitting in a gap to the nearest gap edge, and (multi-band
// fields) back inside its band's radial range (fallback placements).
function clearGaps(bombs: readonly SimBomb[], band: BandSpec, r: number, radial: boolean) {
  for (const b of bombs) {
    if (radial) {
      const d = Math.hypot(b.x, b.z), lim = Math.min(Math.max(d, band.inner - r), band.outer + r);
      if (lim !== d) {
        b.x *= lim / d;
        b.z *= lim / d;
      }
    }
    const d = Math.hypot(b.x, b.z), a = Math.atan2(b.z, b.x);
    const pad = Math.asin(Math.min(1, r / Math.max(d, r))) + 0.01;
    for (const g of band.gaps) {
      const diff = Math.atan2(Math.sin(a - g.angle), Math.cos(a - g.angle));
      if (Math.abs(diff) >= g.half + pad) continue;
      const na = g.angle + Math.sign(diff || 1) * (g.half + pad);
      b.x = Math.cos(na) * d;
      b.z = Math.sin(na) * d;
    }
  }
}

// Build the level's field from its bands (see fieldBands in arenaLevels.ts).
// Ids from `firstId`. Every bomb gets its clump index and band tag.
export function generateField(c: ArenaConfig, bands: readonly BandSpec[], rand: RandomFn, firstId: number): SimBomb[] {
  const placed: SimBomb[][] = []; // one entry per clump
  const perBand: SimBomb[][] = [];
  let id = firstId;
  for (const band of bands) {
    const bombs = generateBand(c, band, rand, id, placed);
    id += bombs.length;
    perBand.push(bombs);
  }
  const bombs = placed.flat();
  const grid = new SpatialGrid(WORLD_HALF_EXTENT, c.bombRadius * 2 * c.connectScale);
  // Remove any residual overlap from fallback placements (gaps re-cleared after)
  relaxBombs(bombs, grid, c.bombRadius, 12, []);
  if (bands.length > 1 || bands.some((b) => b.gaps.length > 0)) {
    const radial = bands.length > 1;
    for (let pass = 0; pass < 3; pass++) {
      bands.forEach((band, i) => clearGaps(perBand[i], band, c.bombRadius, radial));
      relaxBombs(bombs, grid, c.bombRadius, 6, []);
    }
    bands.forEach((band, i) => clearGaps(perBand[i], band, c.bombRadius, radial));
  }
  return bombs;
}
