import { BoardConfig } from "./types";

// Special cell types. Colour indices are >= 0.
export const EMPTY = -1;
export const CEILING = -2;

// Hex neighbour offsets [dCol, dRow], indexed by row parity (after rowOffset).
export const NEIGHBORS_OFFSETS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]], // even rows
  [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]], // odd (shifted) rows
];

// Bomb palette, indexed by colorIndex. Renderers may restyle these but should
// keep the hue order so colours stay recognisable across renderers.
export const BOMB_COLORS = [
  "#ff4d5e", // red
  "#ffd23f", // yellow
  "#3d8bff", // blue
  "#43d36b", // green
  "#a45cff", // purple
  "#2fe0e0", // cyan
] as const;

// Portrait board: 11 columns, hex rows offset by half a tile.
export const BOARD_CONFIG: BoardConfig = {
  columns: 11,
  rows: 14,
  tileWidth: 40,
  tileHeight: 40,
  rowHeight: 34,
  radius: 20,
  initialRows: 5,
  colorCount: BOMB_COLORS.length,
};

// Space below the grid for the launcher and the next-bomb preview.
export const SHOOTER_AREA_HEIGHT = 96;
// Launcher centre, measured up from the bottom of the board.
export const SHOOTER_OFFSET_FROM_BOTTOM = 46;
// The loaded bomb sits in the launcher's muzzle, this far from the launcher
// centre along the aim; shots launch from there and the aim path starts there.
export const MUZZLE_OFFSET = 52;
// Next-bomb preview: a socket on the launcher's left side, this far left of
// and below the launcher centre (renderers draw it here; taps hit-test here).
// (placed so the loaded bomb at the 172 deg aim limit keeps a clear gap)
export const NEXT_BOMB_OFFSET_X = 2.3 * BOARD_CONFIG.tileWidth;
export const NEXT_BOMB_OFFSET_Y = 20;

// Aim limits (degrees, 90 = straight up), as in the original game.
export const AIM_MIN_ANGLE = 8;
export const AIM_MAX_ANGLE = 172;

// Bomb flight.
export const BOMB_SPEED = 900; // logical units / second
export const FLIGHT_SUBSTEP = 4; // max units per collision step (no tunnelling)
// Slightly smaller than a full tile so bombs can slip through narrow gaps.
export const COLLISION_RADIUS_SCALE = 0.85;

// Aim guide tracing limits.
export const AIM_PATH_MAX_LENGTH = 2000;
export const AIM_PATH_MAX_BOUNCES = 8;

// Ceiling: a new solid row is pushed in from the top every N shots.
export const CEILING_EVERY_SHOTS = 5;

// Scoring.
export const DROP_BONUS_PER_TILE = 20;
export const MAX_COMBO_MULTIPLIER = 5;

// Resolve animations (per second).
export const POP_FADE_SPEED = 6;
export const DROP_START_SPEED = 120;
export const DROP_GRAVITY = 1400;
export const DROP_FADE_SPEED = 1.6;

// Danger meter starts rising once the lowest tile reaches this row.
export const DANGER_START_ROW = 7;

// Largest simulation step; protects against tab-switch / first-frame spikes.
export const MAX_DT = 1 / 30;
