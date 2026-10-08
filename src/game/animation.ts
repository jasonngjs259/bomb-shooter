// Resolve-phase animations: popped tiles fade out in place, floating tiles
// fall with gravity while fading. Cells are cleared when their animation ends.

import {
  DROP_FADE_SPEED,
  DROP_GRAVITY,
  EMPTY,
  POP_FADE_SPEED,
} from "./constants";
import { setCell, tileCentre } from "./grid";
import { Cell, Grid } from "./types";

// Advance one step. Returns true while anything is still animating.
export const animateResolve = (
  grid: Grid,
  popping: Cell[],
  dropping: Cell[],
  dt: number,
  floorY: number
): boolean => {
  let left = false;
  for (const t of popping) {
    if (t.state !== "popping") continue;
    left = true;
    t.alpha -= dt * POP_FADE_SPEED;
    if (t.alpha <= 0) setCell(grid, t, EMPTY);
  }
  for (const t of dropping) {
    if (t.state !== "dropping") continue;
    left = true;
    t.velocity += dt * DROP_GRAVITY;
    t.dropOffset += dt * t.velocity;
    t.alpha -= dt * DROP_FADE_SPEED;
    const y = tileCentre(grid, t.col, t.row).y + t.dropOffset;
    if (t.alpha <= 0 || y > floorY) setCell(grid, t, EMPTY);
  }
  return left;
};
