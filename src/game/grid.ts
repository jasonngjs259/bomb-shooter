// Pure hex-grid logic, ported from the CRA version's utils.tsx.
// Coordinates are logical board units with (0,0) at the board's top-left;
// positions returned here are tile CENTRES.

import { CEILING, EMPTY, NEIGHBORS_OFFSETS } from "./constants";
import { BoardConfig, BoardMetrics, Cell, CeilingRow, Grid, GridPos, RenderTile, Vec2 } from "./types";

export type RandomFn = () => number;

// Random int between low and high, inclusive
export const randomRange = (low: number, high: number, rand: RandomFn = Math.random) =>
  Math.floor(low + rand() * (high - low + 1));

export const degToRad = (angle: number) => angle * (Math.PI / 180);
export const radToDeg = (angle: number) => angle * (180 / Math.PI);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const circleIntersection = (
  x1: number,
  y1: number,
  r1: number,
  x2: number,
  y2: number,
  r2: number
) => {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy < (r1 + r2) * (r1 + r2);
};

// Popped tiles score. Kept from the original: 3 tiles = 30, each extra +20.
export const getBaseScore = (totalTiles: number) =>
  totalTiles * 10 + (totalTiles - 3) * 10;

// Width includes the half-tile overhang of the offset rows.
export const gridWidth = (c: BoardConfig) => c.columns * c.tileWidth + c.tileWidth / 2;
export const gridHeight = (c: BoardConfig) => (c.rows - 1) * c.rowHeight + c.tileHeight;

const makeCell = (col: number, row: number): Cell => ({
  col,
  row,
  type: EMPTY,
  id: 0,
  state: "idle",
  alpha: 1,
  dropOffset: 0,
  velocity: 0,
  removed: false,
  processed: false,
});

export const createGrid = (config: BoardConfig): Grid => {
  const cells: Cell[][] = [];
  for (let i = 0; i < config.columns; i++) {
    cells[i] = [];
    for (let j = 0; j < config.rows; j++) cells[i].push(makeCell(i, j));
  }
  return { config, cells, rowOffset: 0, nextId: 1 };
};

// Put a tile (or EMPTY) into a cell, resetting its animation state.
export const setCell = (grid: Grid, cell: Cell, type: number, id?: number) => {
  cell.type = type;
  cell.id = type === EMPTY ? 0 : id ?? grid.nextId++;
  cell.state = "idle";
  cell.alpha = 1;
  cell.dropOffset = 0;
  cell.velocity = 0;
};

export const tileCentre = (grid: Grid, col: number, row: number): Vec2 => {
  const c = grid.config;
  let x = col * c.tileWidth + c.tileWidth / 2;
  // X offset for odd or even rows
  if ((row + grid.rowOffset) % 2) x += c.tileWidth / 2;
  return { x, y: row * c.rowHeight + c.tileHeight / 2 };
};

// Closest grid position for a point (clamped to the board)
export const gridPositionAt = (grid: Grid, x: number, y: number): GridPos => {
  const c = grid.config;
  const row = clamp(Math.round((y - c.tileHeight / 2) / c.rowHeight), 0, c.rows - 1);
  const xOffset = (row + grid.rowOffset) % 2 ? c.tileWidth / 2 : 0;
  const col = clamp(Math.floor((x - xOffset) / c.tileWidth), 0, c.columns - 1);
  return { col, row };
};

export const getNeighbors = (grid: Grid, cell: GridPos): Cell[] => {
  const c = grid.config;
  const offsets = NEIGHBORS_OFFSETS[(cell.row + grid.rowOffset) % 2];
  const out: Cell[] = [];
  for (const [dx, dy] of offsets) {
    const nx = cell.col + dx;
    const ny = cell.row + dy;
    if (nx >= 0 && nx < c.columns && ny >= 0 && ny < c.rows) out.push(grid.cells[nx][ny]);
  }
  return out;
};

export const forEachCell = (grid: Grid, fn: (cell: Cell) => void) => {
  for (const column of grid.cells) for (const cell of column) fn(cell);
};

const resetProcessed = (grid: Grid) => forEachCell(grid, (t) => (t.processed = false));
export const resetRemoved = (grid: Grid) => forEachCell(grid, (t) => (t.removed = false));

// Flood fill from a tile. matchType: only same colour; skipRemoved: ignore
// tiles flagged as removed (used when searching for floating clusters).
export const findCluster = (
  grid: Grid,
  col: number,
  row: number,
  matchType: boolean,
  reset: boolean,
  skipRemoved: boolean
): Cell[] => {
  if (reset) resetProcessed(grid);
  const target = grid.cells[col][row];
  const toProcess = [target];
  target.processed = true;
  const found: Cell[] = [];

  while (toProcess.length > 0) {
    const current = toProcess.pop();
    if (!current || current.type === EMPTY) continue;
    if (skipRemoved && current.removed) continue;
    if (matchType && current.type !== target.type) continue;

    found.push(current);
    for (const n of getNeighbors(grid, current)) {
      if (!n.processed) {
        n.processed = true;
        toProcess.push(n);
      }
    }
  }
  return found;
};

// Clusters not connected to row 0. Ceiling rows always touch row 0, so tiles
// hanging from a lowered ceiling count as attached.
export const findFloatingClusters = (grid: Grid): Cell[][] => {
  resetProcessed(grid);
  const clusters: Cell[][] = [];
  forEachCell(grid, (tile) => {
    if (tile.processed) return;
    const cluster = findCluster(grid, tile.col, tile.row, false, false, true);
    if (cluster.length === 0) return;
    if (!cluster.some((t) => t.row === 0)) clusters.push(cluster);
  });
  return clusters;
};

// Colours still on the board
export const findColors = (grid: Grid): number[] => {
  const seen = new Set<number>();
  forEachCell(grid, (t) => {
    if (t.type >= 0 && t.state === "idle") seen.add(t.type);
  });
  return [...seen].sort((a, b) => a - b);
};

// Random colour that still exists on the board (any colour if board is empty)
export const pickExistingColor = (grid: Grid, rand: RandomFn = Math.random) => {
  const colors = findColors(grid);
  if (colors.length === 0) return randomRange(0, grid.config.colorCount - 1, rand);
  return colors[randomRange(0, colors.length - 1, rand)];
};

// Fill the first rows like the original createLevel: runs of two, then a
// different colour.
export const fillInitialRows = (grid: Grid, rand: RandomFn = Math.random) => {
  const c = grid.config;
  for (let j = 0; j < c.rows; j++) {
    let color = randomRange(0, c.colorCount - 1, rand);
    let count = 0;
    for (let i = 0; i < c.columns; i++) {
      if (count >= 2) {
        let next = randomRange(0, c.colorCount - 1, rand);
        if (next === color) next = (next + 1) % c.colorCount;
        color = next;
        count = 0;
      }
      count++;
      setCell(grid, grid.cells[i][j], j < c.initialRows ? color : EMPTY);
    }
  }
};

// Push a solid ceiling row in from the top, moving everything down one row.
export const pushCeilingRow = (grid: Grid) => {
  const c = grid.config;
  for (let i = 0; i < c.columns; i++) {
    for (let j = c.rows - 1; j > 0; j--) {
      const above = grid.cells[i][j - 1];
      setCell(grid, grid.cells[i][j], above.type, above.id);
    }
    setCell(grid, grid.cells[i][0], CEILING);
  }
  // Flip parity so shifted tiles keep their x position
  grid.rowOffset = (grid.rowOffset + 1) % 2;
};

export const countCeilingRows = (grid: Grid) => {
  let n = 0;
  while (n < grid.config.rows && grid.cells[0][n].type === CEILING) n++;
  return n;
};

// Lowest row containing anything solid (-1 if the board is empty)
export const lowestOccupiedRow = (grid: Grid) => {
  for (let j = grid.config.rows - 1; j >= 0; j--) {
    for (let i = 0; i < grid.config.columns; i++) {
      const t = grid.cells[i][j];
      if (t.type !== EMPTY && t.state === "idle") return j;
    }
  }
  return -1;
};

export const hasColorTiles = (grid: Grid) => findColors(grid).length > 0;

const isSolid = (t: Cell) => t.type !== EMPTY && t.state === "idle";

// Pick the empty cell a bomb at (x,y) should snap into: the nearest empty cell
// around the closest grid position, preferring cells attached to something.
export const findSnapCell = (grid: Grid, x: number, y: number, minRow: number): Cell | null => {
  const base = gridPositionAt(grid, x, Math.max(y, minRow * grid.config.rowHeight));
  let candidates: Cell[] = [grid.cells[base.col][base.row], ...getNeighbors(grid, base)];
  // Widen to the second ring if the first one is full
  if (!candidates.some((t) => t.type === EMPTY)) {
    candidates = candidates.flatMap((t) => getNeighbors(grid, t));
  }

  let best: Cell | null = null;
  let bestScore = Infinity;
  for (const t of candidates) {
    if (t.type !== EMPTY || t.row < minRow) continue;
    const attached = t.row === minRow || getNeighbors(grid, t).some(isSolid);
    const p = tileCentre(grid, t.col, t.row);
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    // Unattached cells are only used when nothing attached is available
    const score = attached ? d : d + 1e9;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
};

// ---- Read models for renderers ----------------------------------------------

export const boardMetrics = (c: BoardConfig, shooterAreaHeight: number): BoardMetrics => {
  const gh = gridHeight(c);
  return {
    width: gridWidth(c),
    height: gh + shooterAreaHeight,
    gridHeight: gh,
    deadlineY: (c.rows - 1) * c.rowHeight,
    columns: c.columns,
    rows: c.rows,
    tileSize: c.tileWidth,
    rowHeight: c.rowHeight,
    radius: c.radius,
  };
};

// Coloured tiles (including ones animating out), top row first
export const collectRenderTiles = (grid: Grid): RenderTile[] => {
  const tiles: RenderTile[] = [];
  const { rows, columns } = grid.config;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const t = grid.cells[col][row];
      if (t.type < 0) continue;
      const { x, y } = tileCentre(grid, col, row);
      const { id, alpha, dropOffset, state } = t;
      tiles.push({ id, col, row, x, y, colorIndex: t.type, alpha, dropOffset, state });
    }
  }
  return tiles;
};

// Ceiling slabs tile the top of the board without overlap; the last slab's
// bottom is exactly the line where bombs stop.
export const ceilingExtents = (grid: Grid, ceilingRows: number): CeilingRow[] => {
  const { rowHeight } = grid.config;
  return Array.from({ length: ceilingRows }, (_, row) => ({
    row,
    top: row * rowHeight,
    bottom: (row + 1) * rowHeight,
  }));
};
