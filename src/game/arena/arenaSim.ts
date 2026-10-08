// Arena 360 per-step simulation helpers used by ArenaEngine: shooter
// movement, creep, fade animations, danger metrics, orphans and knock-back.
// They mutate the objects passed in and never touch engine state directly.

import { RandomFn, clamp } from "../grid";
import type { GroupFinder } from "./arenaMatch";
import { SimBomb, SpatialGrid, relaxBombs } from "./arenaPhysics";
import type { ArenaConfig, ShooterState, Vec2XZ } from "./types";

const MOVING_SPEED = 0.15; // shooter counts as "moving" above this speed

export const wrapAngle = (a: number) => {
  let w = (a + Math.PI) % (Math.PI * 2);
  if (w <= 0) w += Math.PI * 2;
  return w - Math.PI; // (-PI, PI]
};

export function updateMuzzle(s: ShooterState, c: ArenaConfig) {
  s.muzzleX = s.x + Math.cos(s.yaw) * c.muzzleOffset;
  s.muzzleZ = s.z + Math.sin(s.yaw) * c.muzzleOffset;
}

// Velocity follows input * moveSpeed through a critically damped spring
// (closed form, so the start/stop curve is the same at any frame rate);
// omega depends on speeding up / slowing down / reversing. Then clamp the
// body inside the arena, sliding along the border.
export function stepShooter(s: ShooterState, input: Vec2XZ, c: ArenaConfig, dt: number) {
  const tx = input.x * c.moveSpeed, tz = input.z * c.moveSpeed;
  const omega = tx * s.vx + tz * s.vz < 0 ? c.moveReverse : tx * tx + tz * tz >= s.vx * s.vx + s.vz * s.vz ? c.moveAccel : c.moveDecel;
  const e = Math.exp(-omega * dt);
  const dx = s.vx - tx, dz = s.vz - tz;
  const cx = (s.ax + omega * dx) * dt, cz = (s.az + omega * dz) * dt;
  s.vx = tx + (dx + cx) * e;
  s.vz = tz + (dz + cz) * e;
  s.ax = (s.ax - omega * cx) * e;
  s.az = (s.az - omega * cz) * e;
  if (Math.abs(s.vx) < 1e-6 && tx === 0) s.vx = s.ax = 0;
  if (Math.abs(s.vz) < 1e-6 && tz === 0) s.vz = s.az = 0;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const lim = c.arenaRadius - c.shooterRadius, d = Math.hypot(s.x, s.z);
  if (d > lim) {
    const nx = s.x / d, nz = s.z / d;
    s.x = nx * lim;
    s.z = nz * lim;
    const out = s.vx * nx + s.vz * nz; // drop the outward velocity only
    if (out > 0) {
      s.vx -= out * nx;
      s.vz -= out * nz;
    }
    const outA = s.ax * nx + s.az * nz;
    if (outA > 0) {
      s.ax -= outA * nx;
      s.az -= outA * nz;
    }
  }
  s.moving = Math.hypot(s.vx, s.vz) > MOVING_SPEED;
  s.cooldown = Math.max(0, s.cooldown - dt);
  updateMuzzle(s, c);
}

// Radial creep (faster further out) + decaying knock-back kick, then relax.
export function stepCreep(
  active: SimBomb[], c: ArenaConfig, base: number, dt: number, grid: SpatialGrid, scratch: number[]
) {
  const damp = Math.exp(-c.knockbackDamping * dt);
  for (const b of active) {
    const d = Math.hypot(b.x, b.z);
    if (d < 1e-6) continue;
    const creep = base * (1 + c.creepDistanceFactor * Math.max(0, d - c.arenaRadius));
    const move = (b.kick - creep) * dt;
    b.x += (b.x / d) * move;
    b.z += (b.z / d) * move;
    b.kick *= damp;
  }
  return relaxBombs(active, grid, c.bombRadius, c.relaxIterations, scratch);
}

// Age every bomb; fade popping/shattering ones (shattering also drift) and
// compact finished ones out of the array in place.
export function animateFx(bombs: SimBomb[], c: ArenaConfig, dt: number) {
  let w = 0;
  for (const b of bombs) {
    b.age += dt;
    if (b.state !== "idle") {
      const life = b.state === "popping" ? c.popDuration : c.shatterDuration;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.alpha = Math.max(0, 1 - b.age / life);
      if (b.alpha <= 0) continue;
    }
    bombs[w++] = b;
  }
  bombs.length = w;
}

// Gap from a bomb's edge to the border line (<= 0 = touching / crossed).
export const centroid = (bombs: readonly SimBomb[]) => {
  const c = { x: 0, z: 0 };
  for (const b of bombs) {
    c.x += b.x / bombs.length;
    c.z += b.z / bombs.length;
  }
  return c;
};

export const borderGap = (b: SimBomb, c: ArenaConfig) => Math.hypot(b.x, b.z) - c.bombRadius - c.arenaRadius;

export const dangerFromGap = (gap: number, c: ArenaConfig) =>
  Number.isFinite(gap) ? clamp(1 - gap / c.dangerRange, 0, 1) : 0;

// Max danger per angular sector into `out` (resized, not reallocated).
export function dangerSectors(active: readonly SimBomb[], c: ArenaConfig, sectors: number, out: number[]) {
  out.length = sectors;
  out.fill(0);
  for (const b of active) {
    let a = Math.atan2(b.z, b.x);
    if (a < 0) a += Math.PI * 2;
    const s = Math.min(sectors - 1, Math.floor((a / (Math.PI * 2)) * sectors));
    out[s] = Math.max(out[s], dangerFromGap(borderGap(b, c), c));
  }
  return out;
}

// Orphans after a pop: idle components of <= orphanMaxSize bombs (any colour)
// that touched a popped bomb. `grid` must be built from `active`.
export function findOrphans(
  active: readonly SimBomb[], popped: readonly SimBomb[], c: ArenaConfig,
  grid: SpatialGrid, finder: GroupFinder, link: number, scratch: number[]
): SimBomb[] {
  const seeds: number[] = [];
  for (const p of popped) {
    for (const j of grid.query(p.x, p.z, link, scratch)) {
      const o = active[j];
      if ((o.x - p.x) ** 2 + (o.z - p.z) ** 2 <= link * link) seeds.push(j);
    }
  }
  return finder.smallComponents(active, grid, seeds, link, c.orphanMaxSize).map((i) => active[i]);
}

// Kick idle bombs near `centre` radially outward (from the arena centre).
export function applyKnockback(active: readonly SimBomb[], c: ArenaConfig, centre: Vec2XZ, popped: number, removed: number) {
  const reach = c.knockbackRadius + popped * c.bombRadius;
  for (const b of active) {
    const dc = Math.hypot(b.x - centre.x, b.z - centre.z);
    if (dc < reach) b.kick += c.knockbackPerBomb * removed * (1 - dc / reach);
  }
}

// Mark a bomb as shattering: drift outward (from the arena centre) and fade.
export function startShatter(b: SimBomb, c: ArenaConfig) {
  const d = Math.hypot(b.x, b.z) || 1;
  b.state = "shattering";
  b.age = 0;
  b.vx = (b.x / d) * c.shatterSpeed;
  b.vz = (b.z / d) * c.shatterSpeed;
}

// Idle bomb on/over the border that ends the game: any creeping bomb, but
// not a shot stuck less than stuckGrace seconds ago.
export function loseCandidate(active: readonly SimBomb[], c: ArenaConfig): SimBomb | null {
  let best: SimBomb | null = null;
  let bestGap = 0;
  for (const b of active) {
    if (b.stuck && b.age < c.stuckGrace) continue;
    const gap = borderGap(b, c);
    if (gap <= bestGap) {
      bestGap = gap;
      best = b;
    }
  }
  return best;
}

// Idle bomb nearest to crossing the border (null if the field is empty).
export function closestToBorder(active: readonly SimBomb[], c: ArenaConfig): SimBomb | null {
  let best: SimBomb | null = null;
  let bestGap = Infinity;
  for (const b of active) {
    const gap = borderGap(b, c);
    if (gap < bestGap) {
      bestGap = gap;
      best = b;
    }
  }
  return best;
}

export const hasColor = (active: readonly SimBomb[], ci: number) => active.some((b) => b.colorIndex === ci);

// Random colour still present among idle bombs (any colour if none left).
export function pickPresentColor(active: readonly SimBomb[], colorCount: number, random: RandomFn): number {
  const present: number[] = [];
  for (const b of active) if (!present.includes(b.colorIndex)) present.push(b.colorIndex);
  if (present.length === 0) return Math.floor(random() * colorCount);
  return present[Math.floor(random() * present.length)];
}
