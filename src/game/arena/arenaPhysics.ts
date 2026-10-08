// Arena 360 physics helpers: a uniform spatial grid, soft circle-circle
// relaxation and ray-vs-circle casts. Pure functions over SimBomb arrays;
// nothing here allocates per call except where noted (scratch is reused).

import type { ArenaBomb } from "./types";

// Engine-side bomb: the public ArenaBomb plus simulation-only fields.
export interface SimBomb extends ArenaBomb {
  kick: number; // outward radial speed from knock-back (decays)
  vx: number; // drift velocity while shattering
  vz: number;
  clump: number; // layout clump index (specials never share one), -1 for stuck shots / spawned bombs
}

// ---- Spatial grid -------------------------------------------------------------

// Counting-sort grid over a square [-half, half]^2. Rebuilt from scratch each
// time (O(n + cells)); points outside the square clamp into the edge cells,
// which stays correct, just less selective.
export class SpatialGrid {
  private readonly dim: number;
  private readonly start: Int32Array;
  private readonly cursor: Int32Array;
  private items = new Int32Array(256);

  constructor(private readonly half: number, private readonly cellSize: number) {
    this.dim = Math.max(1, Math.ceil((2 * half) / cellSize));
    this.start = new Int32Array(this.dim * this.dim + 1);
    this.cursor = new Int32Array(this.dim * this.dim);
  }

  private axis(v: number) {
    const c = Math.floor((v + this.half) / this.cellSize);
    return c < 0 ? 0 : c >= this.dim ? this.dim - 1 : c;
  }

  build(bombs: readonly SimBomb[]) {
    const n = bombs.length;
    if (this.items.length < n) this.items = new Int32Array(n * 2);
    this.cursor.fill(0);
    for (let i = 0; i < n; i++) {
      this.cursor[this.axis(bombs[i].z) * this.dim + this.axis(bombs[i].x)]++;
    }
    let sum = 0;
    for (let c = 0; c < this.cursor.length; c++) {
      this.start[c] = sum;
      sum += this.cursor[c];
      this.cursor[c] = this.start[c];
    }
    this.start[this.cursor.length] = sum;
    for (let i = 0; i < n; i++) {
      const c = this.axis(bombs[i].z) * this.dim + this.axis(bombs[i].x);
      this.items[this.cursor[c]++] = i;
    }
  }

  // Indices (into the array passed to build) of bombs whose cell overlaps the
  // square around (x, z). Callers still test the exact distance.
  query(x: number, z: number, radius: number, out: number[]): number[] {
    out.length = 0;
    const x0 = this.axis(x - radius), x1 = this.axis(x + radius);
    const z0 = this.axis(z - radius), z1 = this.axis(z + radius);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cz * this.dim + cx;
        for (let k = this.start[c]; k < this.start[c + 1]; k++) out.push(this.items[k]);
      }
    }
    return out;
  }
}

// ---- Relaxation -------------------------------------------------------------------

// Push overlapping circles apart (each moves half the overlap along the line
// between centres). Gauss-Seidel style, `iterations` passes. Returns the
// largest overlap seen in the final pass (0 = fully separated).
export function relaxBombs(
  bombs: readonly SimBomb[],
  grid: SpatialGrid,
  radius: number,
  iterations: number,
  scratch: number[]
): number {
  const minDist = radius * 2;
  const minSq = minDist * minDist;
  let worst = 0;
  for (let it = 0; it < iterations; it++) {
    worst = 0;
    grid.build(bombs);
    for (let i = 0; i < bombs.length; i++) {
      const a = bombs[i];
      grid.query(a.x, a.z, minDist, scratch);
      for (const j of scratch) {
        if (j <= i) continue;
        const b = bombs[j];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const dSq = dx * dx + dz * dz;
        if (dSq >= minSq) continue;
        const d = Math.sqrt(dSq);
        const overlap = minDist - d;
        if (d < 1e-6) {
          // Coincident: separate along an id-derived direction (deterministic)
          const ang = ((a.id * 7919 + b.id * 104729) % 6283) / 1000;
          dx = Math.cos(ang);
          dz = Math.sin(ang);
        } else {
          dx /= d;
          dz /= d;
        }
        if (overlap > worst) worst = overlap;
        const push = overlap * 0.5;
        a.x -= dx * push;
        a.z -= dz * push;
        b.x += dx * push;
        b.z += dz * push;
      }
    }
  }
  return worst;
}

// Move only `bomb` out of any circle it overlaps (used to seat a stuck shot).
export function separateOne(bomb: SimBomb, others: readonly SimBomb[], radius: number, iterations: number) {
  const minDist = radius * 2;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (const o of others) {
      if (o === bomb) continue;
      const dx = bomb.x - o.x;
      const dz = bomb.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d >= minDist - 1e-4) continue;
      if (d < 1e-6) {
        bomb.x += minDist;
      } else {
        bomb.x += (dx / d) * (minDist - d);
        bomb.z += (dz / d) * (minDist - d);
      }
      moved = true;
    }
    if (!moved) return;
  }
}

// Largest pairwise overlap (diagnostics / tests). O(n^2).
export function maxOverlap(bombs: readonly ArenaBomb[], radius: number): number {
  let worst = 0;
  for (let i = 0; i < bombs.length; i++) {
    for (let j = i + 1; j < bombs.length; j++) {
      const o = radius * 2 - Math.hypot(bombs[i].x - bombs[j].x, bombs[i].z - bombs[j].z);
      if (o > worst) worst = o;
    }
  }
  return worst;
}

// ---- Ray casts ----------------------------------------------------------------------

export interface RayHit {
  t: number; // distance along the ray to the contact (centre of the moving circle)
  index: number; // index into the bombs array, -1 = no hit
}

// Distance along a unit ray (o + d*t) at which a circle of radius `sum` around
// (cx, cz) is first touched, or -1. A start point already inside returns 0.
export function rayCircle(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, sum: number) {
  const mx = ox - cx;
  const mz = oz - cz;
  const c = mx * mx + mz * mz - sum * sum;
  if (c <= 0) return 0;
  const b = mx * dx + mz * dz;
  if (b > 0) return -1; // pointing away
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b - Math.sqrt(disc);
}

// First bomb a moving circle of radius `radius` touches when swept from
// (ox, oz) along unit (dx, dz) for up to maxDist. Writes into `out`.
export function raycastBombs(
  bombs: readonly SimBomb[],
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDist: number,
  radius: number,
  out: RayHit
): RayHit {
  out.t = maxDist;
  out.index = -1;
  const sum = radius * 2;
  for (let i = 0; i < bombs.length; i++) {
    const t = rayCircle(ox, oz, dx, dz, bombs[i].x, bombs[i].z, sum);
    if (t >= 0 && t <= out.t) {
      out.t = t;
      out.index = i;
    }
  }
  if (out.index < 0) out.t = maxDist;
  return out;
}
