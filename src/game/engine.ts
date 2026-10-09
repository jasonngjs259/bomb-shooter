/*
 * GameEngine — framework-free bubble-shooter simulation.
 *
 * No React, DOM or React Native imports: the engine is plain TypeScript so the
 * same class drives every renderer (RN Views, Skia 2.5D, three.js 3D) and can
 * run under Node for tests. There are no timers; time only advances through
 * update(dt). Randomness comes from `random` (defaults to Math.random).
 *
 * COORDINATES — logical board units, not pixels. (0,0) is the top-left of the
 * board, +y is down. Board = grid (11 cols x 14 rows of 40-unit hex tiles,
 * rowHeight 34, odd rows offset by half a tile) + a shooter strip below it.
 * All positions returned are CENTRES. Renderers scale units -> screen.
 *
 * PER-FRAME READS (cheap; lists are cached until getRevision() changes):
 *   getBoardMetrics()     sizes, deadline line, tile size/radius
 *   getTiles()            live tiles {id,col,row,x,y,colorIndex,alpha,dropOffset,state}
 *   getCeilingRows()      solid ceiling slabs as y-extents
 *   getShooter()          launcher centre + aim angle
 *   getBomb()             current bomb (loaded in the muzzle, or in flight)
 *   getMuzzle()           launch point: MUZZLE_OFFSET from the launcher along the aim
 *   getNextBomb()         preview slot position + colour
 *   getAimAngle()         degrees, 90 = up, clamped to [8, 172]
 *   getAimPath()          predicted polyline (from the muzzle) with wall bounces + target cell
 *   getDangerLevel()      0..1, how close the lowest tile is to the bottom
 *   getShotsUntilCeiling(), getScore(), getCombo(), getPhase(), getTime()
 *   getRevision()         increments whenever anything visible changed
 *
 * COMMANDS: newGame(), aimAt(x,y), setAngle(deg), nudgeAngle(delta), fire(),
 *   swapBomb(), update(dt).
 *
 * EVENTS (on(name, cb) returns unsubscribe): see EngineEvents in types.ts —
 *   shoot, wallBounce, snap, pop, drop, ceilingDrop, swap, gameOver, won,
 *   scoreChanged, phaseChanged. Use them for FX, audio and haptics.
 *
 * PHASES: title -> ready -> shooting -> (resolving) -> ready ... -> gameOver | won
 */

import * as K from "./constants";
import { TypedEmitter } from "./emitter";
import { animateResolve } from "./animation";
import {
  RandomFn, boardMetrics, ceilingExtents, clamp, collectRenderTiles, countCeilingRows,
  createGrid, fillInitialRows, findCluster, findColors, findFloatingClusters, findSnapCell,
  getBaseScore, hasColorTiles, lowestOccupiedRow, pickExistingColor, pushCeilingRow,
  radToDeg, resetRemoved, setCell, tileCentre,
} from "./grid";
import { Mover, PhysicsWorld, direction, step, traceAimPath } from "./physics";
import {
  AimPath, BoardConfig, BoardMetrics, BombState, Cell, CeilingRow, EngineEvents, FxTile,
  GamePhase, Grid, NextBombState, RenderTile, ShooterState, Vec2,
} from "./types";

export interface GameEngineOptions {
  config?: BoardConfig;
  random?: RandomFn;
}

export class GameEngine {
  readonly config: BoardConfig;
  private readonly random: RandomFn;
  private readonly events = new TypedEmitter<EngineEvents>();
  private readonly metrics: BoardMetrics;
  private readonly shooter: Vec2;
  private readonly nextSlot: Vec2;

  private grid: Grid;
  private phase: GamePhase = "title";
  private angle = 90;
  private bomb: BombState & Mover;
  private nextColor = 0;
  private score = 0;
  private combo = 0;
  private shotsUntilCeiling = K.CEILING_EVERY_SHOTS;
  private ceilingRows = 0;
  private popping: Cell[] = [];
  private dropping: Cell[] = [];
  private time = 0;

  // Change tracking: revision for "anything visible", gridRevision for caches
  private revision = 0;
  private gridRevision = 0;
  private tilesCache: { rev: number; tiles: RenderTile[] } | null = null;
  private aimCache: { key: string; path: AimPath } | null = null;

  constructor(options: GameEngineOptions = {}) {
    this.config = options.config ?? K.BOARD_CONFIG;
    this.random = options.random ?? Math.random;
    this.metrics = boardMetrics(this.config, K.SHOOTER_AREA_HEIGHT);
    const height = this.metrics.height;
    this.shooter = { x: this.metrics.width / 2, y: height - K.SHOOTER_OFFSET_FROM_BOTTOM };
    this.nextSlot = { x: this.shooter.x - K.NEXT_BOMB_OFFSET_X, y: this.shooter.y + K.NEXT_BOMB_OFFSET_Y };
    this.bomb = { ...this.getMuzzle(), dx: 0, dy: -1, colorIndex: 0, visible: true, inFlight: false };
    // Build a board so the title screen has a backdrop
    this.grid = createGrid(this.config);
    this.setupBoard();
  }

  // ---- Events ----------------------------------------------------------------

  on<E extends keyof EngineEvents>(event: E, cb: (payload: EngineEvents[E]) => void) {
    return this.events.on(event, cb);
  }

  // ---- Read-only getters -----------------------------------------------------

  getBoardMetrics(): BoardMetrics { return this.metrics; }
  getPhase(): GamePhase { return this.phase; }
  getScore(): number { return this.score; }
  // Consecutive popping shots (0 after a miss); multiplier = min(combo, 5)
  getCombo(): number { return this.combo; }
  getShotsUntilCeiling(): number { return this.shotsUntilCeiling; }
  getTime(): number { return this.time; }
  getRevision(): number { return this.revision; }
  getAimAngle(): number { return this.angle; }
  getShooter(): ShooterState {
    return { x: this.shooter.x, y: this.shooter.y, angle: this.angle };
  }
  getBomb(): BombState {
    const { x, y, colorIndex, visible, inFlight } = this.bomb;
    return { x, y, colorIndex, visible, inFlight };
  }
  // Where the loaded bomb sits and shots launch: on the aim line, MUZZLE_OFFSET
  // from the launcher centre (the turret's muzzle).
  getMuzzle(): Vec2 {
    const d = direction(this.angle);
    return { x: this.shooter.x + d.dx * K.MUZZLE_OFFSET, y: this.shooter.y + d.dy * K.MUZZLE_OFFSET };
  }
  getNextBomb(): NextBombState {
    return { x: this.nextSlot.x, y: this.nextSlot.y, colorIndex: this.nextColor };
  }

  // True if a board point lies on the next-bomb preview (tap-to-swap)
  isPointOnNextBomb(x: number, y: number) {
    const r = this.config.radius * 1.5;
    return (x - this.nextSlot.x) ** 2 + (y - this.nextSlot.y) ** 2 <= r * r;
  }

  getTiles(): RenderTile[] {
    if (this.tilesCache?.rev !== this.revision) {
      this.tilesCache = { rev: this.revision, tiles: collectRenderTiles(this.grid) };
    }
    return this.tilesCache.tiles;
  }

  getCeilingRows(): CeilingRow[] {
    return ceilingExtents(this.grid, this.ceilingRows);
  }

  // 0 while the lowest tile is above DANGER_START_ROW, 1 one row from losing
  getDangerLevel() {
    const lowest = lowestOccupiedRow(this.grid);
    const from = K.DANGER_START_ROW - 1;
    const to = this.config.rows - 2;
    return clamp((lowest - from) / (to - from), 0, 1);
  }

  // Predicted trajectory for the aim guide. Cached per angle + grid state.
  getAimPath(): AimPath {
    const key = `${this.angle}|${this.gridRevision}`;
    if (this.aimCache?.key !== key) {
      this.aimCache = { key, path: traceAimPath(this.world(), this.getMuzzle(), this.angle) };
    }
    return this.aimCache.path;
  }

  // ---- Commands --------------------------------------------------------------

  newGame() {
    const previous = this.score;
    this.setupBoard();
    this.events.emit("scoreChanged", { score: 0, delta: -previous });
    this.setPhase("ready");
  }

  // Aim at a board point (pointer position in logical units)
  aimAt(x: number, y: number) {
    let a = radToDeg(Math.atan2(this.shooter.y - y, x - this.shooter.x));
    if (a < 0) a += 360; // 0..360
    // Pointer below the launcher: snap to the nearer side (original behaviour)
    if (a > 90 && a < 270) a = Math.min(a, K.AIM_MAX_ANGLE);
    else if (a < K.AIM_MIN_ANGLE || a >= 270) a = K.AIM_MIN_ANGLE;
    this.setAngle(a);
  }

  setAngle(deg: number) {
    const a = clamp(deg, K.AIM_MIN_ANGLE, K.AIM_MAX_ANGLE);
    if (a === this.angle) return;
    this.angle = a;
    if (!this.bomb.inFlight) Object.assign(this.bomb, this.getMuzzle()); // loaded bomb turns with the barrel
    this.touch();
  }

  nudgeAngle(deltaDeg: number) {
    this.setAngle(this.angle + deltaDeg);
  }

  // Launch the loaded bomb. Returns false if not allowed right now.
  fire(): boolean {
    if (this.phase !== "ready") return false;
    const d = direction(this.angle);
    Object.assign(this.bomb, { ...this.getMuzzle(), dx: d.dx, dy: d.dy, inFlight: true, visible: true });
    this.events.emit("shoot", { x: this.bomb.x, y: this.bomb.y, angle: this.angle, colorIndex: this.bomb.colorIndex });
    this.setPhase("shooting");
    return true;
  }

  // Swap the loaded bomb with the next one
  swapBomb(): boolean {
    if (this.phase !== "ready") return false;
    [this.bomb.colorIndex, this.nextColor] = [this.nextColor, this.bomb.colorIndex];
    this.events.emit("swap", { colorIndex: this.bomb.colorIndex, nextColorIndex: this.nextColor });
    this.touch();
    return true;
  }

  update(dt: number) {
    const step = clamp(dt, 0, K.MAX_DT);
    this.time += step;
    if (this.phase === "shooting") this.updateFlight(step);
    else if (this.phase === "resolving") this.updateResolve(step);
  }

  // ---- Internals -------------------------------------------------------------

  private touch() {
    this.revision++;
  }

  private gridChanged() {
    this.gridRevision++;
    this.touch();
  }

  private setPhase(phase: GamePhase) {
    if (phase === this.phase) return;
    const previous = this.phase;
    this.phase = phase;
    this.touch();
    this.events.emit("phaseChanged", { phase, previous });
  }

  private setupBoard() {
    this.grid = createGrid(this.config);
    fillInitialRows(this.grid, this.random);
    this.ceilingRows = 0;
    this.score = 0;
    this.combo = 0;
    this.shotsUntilCeiling = K.CEILING_EVERY_SHOTS;
    this.angle = 90;
    this.popping = [];
    this.dropping = [];
    this.nextColor = pickExistingColor(this.grid, this.random);
    this.loadNextBomb();
    this.gridChanged();
  }

  private world(): PhysicsWorld {
    return { grid: this.grid, width: this.metrics.width, ceilingRows: this.ceilingRows };
  }

  private updateFlight(dt: number) {
    let remaining = K.BOMB_SPEED * dt;
    const world = this.world();
    while (remaining > 0) {
      const d = Math.min(K.FLIGHT_SUBSTEP, remaining);
      remaining -= d;
      const res = step(world, this.bomb, d);
      if (res.bounced) this.events.emit("wallBounce", { x: this.bomb.x, y: this.bomb.y });
      if (res.hit) {
        this.snap();
        break;
      }
    }
    this.touch();
  }

  private snap() {
    const cell = findSnapCell(this.grid, this.bomb.x, this.bomb.y, this.ceilingRows);
    this.bomb.inFlight = false;
    this.bomb.visible = false;
    if (!cell) {
      this.endGame();
      return;
    }
    setCell(this.grid, cell, this.bomb.colorIndex);
    const p = tileCentre(this.grid, cell.col, cell.row);
    this.gridChanged();
    this.events.emit("snap", { ...p, col: cell.col, row: cell.row, colorIndex: cell.type });

    const cluster = findCluster(this.grid, cell.col, cell.row, true, true, false);
    if (cluster.length >= 3) {
      this.startPop(cluster);
    } else {
      this.combo = 0;
      this.finishShot();
    }
  }

  private startPop(cluster: Cell[]) {
    resetRemoved(this.grid);
    for (const t of cluster) t.removed = true;
    const floating = findFloatingClusters(this.grid)
      .flat()
      .filter((t) => t.type >= 0);

    // Score: popped tiles + bonus per dropped tile, times the combo multiplier
    this.combo++;
    const multiplier = Math.min(this.combo, K.MAX_COMBO_MULTIPLIER);
    const gained = (getBaseScore(cluster.length) + floating.length * K.DROP_BONUS_PER_TILE) * multiplier;
    this.score += gained;

    for (const t of cluster) t.state = "popping";
    for (const t of floating) {
      t.state = "dropping";
      t.velocity = K.DROP_START_SPEED;
    }
    this.popping = cluster;
    this.dropping = floating;
    this.gridChanged();
    this.setPhase("resolving");

    const popped = this.toFx(cluster);
    const centre = {
      x: popped.reduce((s, t) => s + t.x, 0) / popped.length,
      y: popped.reduce((s, t) => s + t.y, 0) / popped.length,
    };
    this.events.emit("pop", { tiles: popped, score: gained, combo: this.combo, centre });
    if (floating.length > 0) this.events.emit("drop", { tiles: this.toFx(floating) });
    this.events.emit("scoreChanged", { score: this.score, delta: gained });
  }

  private updateResolve(dt: number) {
    const floorY = this.metrics.height + this.config.radius;
    const animating = animateResolve(this.grid, this.popping, this.dropping, dt, floorY);
    this.touch();
    if (!animating) {
      this.popping = [];
      this.dropping = [];
      this.finishShot();
    }
  }

  // After a shot settles: win check, ceiling countdown, lose check, reload.
  private finishShot() {
    this.gridChanged();
    if (!hasColorTiles(this.grid)) {
      this.setPhase("won");
      this.events.emit("won", { score: this.score });
      return;
    }
    this.shotsUntilCeiling--;
    if (this.shotsUntilCeiling <= 0) {
      pushCeilingRow(this.grid);
      this.ceilingRows = countCeilingRows(this.grid);
      this.shotsUntilCeiling = K.CEILING_EVERY_SHOTS;
      this.gridChanged();
      this.events.emit("ceilingDrop", { ceilingRows: this.ceilingRows });
    }
    if (lowestOccupiedRow(this.grid) >= this.config.rows - 1) {
      this.endGame();
      return;
    }
    this.loadNextBomb();
    this.setPhase("ready");
  }

  private endGame() {
    this.bomb.visible = false;
    this.setPhase("gameOver");
    this.events.emit("gameOver", { score: this.score });
  }

  private loadNextBomb() {
    // Never hand out a colour that no longer exists on the board
    const colors = findColors(this.grid);
    let current = this.nextColor;
    if (colors.length > 0 && !colors.includes(current)) current = pickExistingColor(this.grid, this.random);
    Object.assign(this.bomb, { ...this.getMuzzle(), colorIndex: current, visible: true, inFlight: false });
    this.nextColor = pickExistingColor(this.grid, this.random);
  }

  private toFx(cells: Cell[]): FxTile[] {
    return cells.map((t) => ({ ...tileCentre(this.grid, t.col, t.row), colorIndex: t.type }));
  }
}
