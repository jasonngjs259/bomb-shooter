// Bomb flight: wall bounces, collision, and the aim-guide trace. The real
// flight and the guide share step() so the guide is always accurate.

import {
  AIM_PATH_MAX_BOUNCES,
  AIM_PATH_MAX_LENGTH,
  COLLISION_RADIUS_SCALE,
  FLIGHT_SUBSTEP,
} from "./constants";
import { degToRad, findSnapCell, tileCentre } from "./grid";
import { AimPath, Grid, Vec2 } from "./types";

export interface Mover {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

// What the physics needs to know about the current board
export interface PhysicsWorld {
  grid: Grid;
  width: number; // board width (walls at 0 and width)
  ceilingRows: number; // solid rows at the top
}

export const direction = (angle: number) => ({
  dx: Math.cos(degToRad(angle)),
  dy: -Math.sin(degToRad(angle)),
});

// Does a bomb centred at (x,y) touch the ceiling or a resting tile?
export const collides = (w: PhysicsWorld, x: number, y: number) => {
  const { radius, rowHeight, rows, columns } = w.grid.config;
  if (y <= w.ceilingRows * rowHeight + radius) return true;
  const reach = 2 * radius * COLLISION_RADIUS_SCALE;
  // Only rows near y can be touched
  const r0 = Math.max(w.ceilingRows, Math.floor((y - 2 * radius) / rowHeight) - 1);
  const r1 = Math.min(rows - 1, Math.ceil(y / rowHeight) + 1);
  for (let row = r0; row <= r1; row++) {
    for (let col = 0; col < columns; col++) {
      const t = w.grid.cells[col][row];
      if (t.type < 0 || t.state !== "idle") continue;
      const p = tileCentre(w.grid, col, row);
      if ((p.x - x) ** 2 + (p.y - y) ** 2 < reach * reach) return true;
    }
  }
  return false;
};

// Advance a mover by `dist`, bouncing off the side walls.
export const step = (w: PhysicsWorld, m: Mover, dist: number) => {
  const r = w.grid.config.radius;
  const right = w.width - r;
  m.x += m.dx * dist;
  m.y += m.dy * dist;
  let bounced = false;
  if (m.x <= r) {
    m.x = r;
    m.dx = Math.abs(m.dx);
    bounced = true;
  } else if (m.x >= right) {
    m.x = right;
    m.dx = -Math.abs(m.dx);
    bounced = true;
  }
  return { bounced, hit: collides(w, m.x, m.y) };
};

// Predicted trajectory from `origin` at `angle`: start, each bounce, end,
// plus the cell the bomb would snap into.
export const traceAimPath = (w: PhysicsWorld, origin: Vec2, angle: number): AimPath => {
  const m: Mover = { x: origin.x, y: origin.y, ...direction(angle) };
  const points: Vec2[] = [{ x: m.x, y: m.y }];
  let target: AimPath["target"] = null;
  let travelled = 0;
  let bounces = 0;
  while (travelled < AIM_PATH_MAX_LENGTH && bounces <= AIM_PATH_MAX_BOUNCES) {
    const res = step(w, m, FLIGHT_SUBSTEP);
    travelled += FLIGHT_SUBSTEP;
    if (res.bounced) {
      points.push({ x: m.x, y: m.y });
      bounces++;
    }
    if (res.hit) {
      const cell = findSnapCell(w.grid, m.x, m.y, w.ceilingRows);
      if (cell) target = { col: cell.col, row: cell.row, ...tileCentre(w.grid, cell.col, cell.row) };
      break;
    }
  }
  points.push({ x: m.x, y: m.y });
  return { points, target };
};
