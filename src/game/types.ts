import type { GameEngine } from "./engine";

// Shared game types. Everything here is plain data so the engine stays
// framework-free and any renderer (RN Views, Skia, three.js) can consume it.

export interface Vec2 {
  x: number;
  y: number;
}

export type GamePhase =
  | "title" // before the first game; board is a static backdrop
  | "ready" // waiting for the player to aim / fire
  | "shooting" // bomb in flight
  | "resolving" // pop + drop animations running
  | "gameOver" // a tile reached the bottom row
  | "won"; // every coloured tile cleared

// Animation state of a grid cell. Popping/dropping cells are still in the
// grid while they animate out, but no longer count for collisions.
export type TileState = "idle" | "popping" | "dropping";

export interface BoardConfig {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  rowHeight: number;
  radius: number;
  initialRows: number;
  colorCount: number;
}

// One slot of the hex grid. `type` is a colour index (>= 0), EMPTY or CEILING.
export interface Cell {
  col: number;
  row: number;
  type: number;
  id: number; // stable id of the tile occupying the cell (moves with it)
  state: TileState;
  alpha: number;
  dropOffset: number; // extra y applied while falling (logical units)
  velocity: number;
  removed: boolean; // scratch flag for floating-cluster search
  processed: boolean; // scratch flag for flood fill
}

export interface Grid {
  config: BoardConfig;
  cells: Cell[][]; // cells[col][row]
  // Toggled each time a ceiling row is pushed in, so existing tiles keep
  // their x position while moving down one row.
  rowOffset: number;
  nextId: number; // id source for newly placed tiles
}

export interface GridPos {
  col: number;
  row: number;
}

// ---- Renderer-facing read models ------------------------------------------

export interface BoardMetrics {
  width: number; // full logical board width
  height: number; // full logical board height (grid + shooter area)
  gridHeight: number; // height of the tile area
  deadlineY: number; // top of the bottom row; a tile here = game over
  columns: number;
  rows: number;
  tileSize: number;
  rowHeight: number;
  radius: number;
}

export interface RenderTile {
  id: number;
  col: number;
  row: number;
  x: number; // centre, logical units (without dropOffset)
  y: number;
  colorIndex: number;
  alpha: number;
  dropOffset: number;
  state: TileState;
}

export interface CeilingRow {
  row: number;
  top: number; // logical y extents of the slab
  bottom: number;
}

export interface ShooterState {
  x: number; // centre of the launcher
  y: number;
  angle: number; // degrees, 90 = straight up
}

export interface BombState {
  x: number; // centre
  y: number;
  colorIndex: number;
  visible: boolean;
  inFlight: boolean;
}

export interface NextBombState {
  x: number; // centre of the preview slot
  y: number;
  colorIndex: number;
}

export interface AimPath {
  points: Vec2[]; // start, every wall bounce, end
  target: (GridPos & Vec2) | null; // cell the bomb would snap into
}

export interface FxTile {
  x: number;
  y: number;
  colorIndex: number;
}

// ---- Events -----------------------------------------------------------------

export interface EngineEvents {
  shoot: { x: number; y: number; angle: number; colorIndex: number };
  wallBounce: Vec2;
  snap: { x: number; y: number; col: number; row: number; colorIndex: number };
  pop: { tiles: FxTile[]; score: number; combo: number; centre: Vec2 };
  drop: { tiles: FxTile[] };
  ceilingDrop: { ceilingRows: number };
  swap: { colorIndex: number; nextColorIndex: number };
  gameOver: { score: number };
  won: { score: number };
  scoreChanged: { score: number; delta: number };
  phaseChanged: { phase: GamePhase; previous: GamePhase };
}

export type EngineEventName = keyof EngineEvents;
export type EngineListener<K extends EngineEventName> = (
  payload: EngineEvents[K]
) => void;

// The subset of the engine a renderer may use (no commands).
export type GameEngineView = Pick<
  GameEngine,
  | "config"
  | "on"
  | "getBoardMetrics"
  | "getPhase"
  | "getScore"
  | "getCombo"
  | "getShotsUntilCeiling"
  | "getTime"
  | "getRevision"
  | "getAimAngle"
  | "getShooter"
  | "getBomb"
  | "getNextBomb"
  | "getTiles"
  | "getCeilingRows"
  | "getDangerLevel"
  | "getAimPath"
>;
