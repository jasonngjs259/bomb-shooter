// Where the synthwave sun and horizon go so the sun is always partly
// visible instead of hiding behind the board.
//  - Open sky above the board (phones, short boards): the sun sits in that
//    gap, sized to fit, its slit lower half just above the ceiling slab.
//  - No room above (desktop, board ~92% of the height): the sun grows wider
//    than the board so it shows on both sides of it and peeks over the top.
// Title mode keeps the original fixed placement (the logo is built over it).

import { BoardLayout } from "../../layout";

export interface SkyPlacement {
  horizon: number; // fraction of the container height
  sunR: number; // sun radius, container points
}

const MIN_ROOM = 48; // smallest gap above the board that can hold a sun

export function placeSky(layout: BoardLayout, title: boolean, sideUnits: number, slabUnits: number): SkyPlacement {
  const W = layout.containerWidth;
  const H = Math.max(1, layout.containerHeight);
  const desktop = W >= 900;
  const baseR = Math.min(0.26 * W, 220);
  if (title) return { horizon: desktop ? 0.45 : 0.38, sunR: baseR };

  const s = layout.scale;
  const boardTop = layout.offsetY - slabUnits * s; // top of the ceiling slab
  const room = boardTop - (layout.skyTop ?? 0);
  let R: number;
  let cy: number;
  if (room >= MIN_ROOM) {
    R = Math.min(baseR, room / 1.85);
    cy = boardTop - 0.75 * R;
  } else {
    const half = layout.width / 2 + sideUnits * s;
    R = Math.min(Math.max(baseR, half + 64), H * 0.45);
    cy = Math.max(boardTop, 0) + 0.45 * R;
  }
  // the shader centres the sun 0.55 R above the horizon
  return { horizon: Math.min(0.95, (cy + 0.55 * R) / H), sunR: R };
}
