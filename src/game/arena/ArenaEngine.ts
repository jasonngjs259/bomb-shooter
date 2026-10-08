/*
 * ArenaEngine — framework-free "Arena 360" simulation (3rd-person mode).
 *
 * No React, three.js, DOM or React Native imports. Time only advances through
 * update(dt) (clamped to 1/30 s); randomness only comes from `random`, so a
 * seeded RNG + the same inputs replays identically.
 *
 * WORLD — flat ground plane, units ~ metres, positions (x, z), origin = arena
 * centre. Angles/yaw are radians from +x towards +z: dir = (cos a, sin a).
 * The arena is a circle (arenaRadius 6); its edge is the BORDER LINE. Bombs
 * (radius 0.45) start in a ring around it and creep inwards; the shooter lives
 * inside and fires straight along its yaw. Height is a renderer concern.
 *
 * PER-FRAME READS (live objects; treat as read-only, copy to keep):
 *   getBombs()            every bomb incl. fading ones {id,x,z,colorIndex,state,alpha,age,stuck}
 *   getShooter()          {x,z,yaw,vx,vz,moving,muzzleX,muzzleZ,cooldown}
 *   getShot()             the in-flight shot or null (max one at a time)
 *   getCurrentBomb(), getNextBomb()   colour indices (BOMB_COLORS)
 *   getAimRay()           muzzle -> first bomb touched (or max range), landing point and
 *                         wouldPopIds (bombs that pop if the current bomb lands there)
 *   getDangerLevel()      0..1, 1 = a bomb edge is at the border
 *   getDangerByAngle(n)   0..1 per sector, sector 0 starts at angle 0 (+x), towards +z.
 *                         Allocation-free: returns a reused array, valid until the next update.
 *   getBorderGap(), getCreepSpeed(), isCreepPaused(), getScore(), getCombo(), getLevel(),
 *   getPhase(), getRemaining(), getTime(), getRevision(), getConfig()
 *
 * COMMANDS: newGame({level, keepScore}), update(dt), setMoveInput(x, z)
 *   (WORLD-space vector, magnitude <= 1), setYaw(rad), turn(delta), aimAt(x, z),
 *   fire(), swapBomb(), setCreepPaused(paused) (tutorial: freezes creep and the
 *   surge clock; moving, aiming, firing, popping and knock-back still work).
 *
 * EVENTS (on(name, cb) returns unsubscribe; payloads: ArenaEvents in types.ts):
 *   shoot, stick, pop, shatter, miss (deflected: true = a non-popping shot that
 *   would sit within deflectMargin of the border bounced off), creepSurge, dangerChanged, swap,
 *   gameOver, won, scoreChanged, phaseChanged.
 * RULES + tuned numbers: next to ARENA_CONFIG in arenaLayout.ts.
 * PHASES: title -> playing -> gameOver | won   (newGame() from any phase)
 */

import { DROP_BONUS_PER_TILE, MAX_COMBO_MULTIPLIER } from "../constants";
import { TypedEmitter } from "../emitter";
import { RandomFn, clamp, getBaseScore } from "../grid";
import { GroupFinder } from "./arenaMatch";
import { ARENA_CONFIG, ARENA_MAX_DT, WORLD_HALF_EXTENT, generateField, levelParams, makeBomb } from "./arenaLayout";
import { RayHit, SimBomb, SpatialGrid, raycastBombs, separateOne } from "./arenaPhysics";
import {
  animateFx, applyKnockback, borderGap, centroid, closestToBorder, loseCandidate, dangerFromGap, dangerSectors, findOrphans, hasColor,
  pickPresentColor, startShatter, stepCreep, stepShooter, updateMuzzle, wrapAngle,
} from "./arenaSim";
import {
  AimRay, ArenaBomb, ArenaConfig, ArenaEvents, ArenaPhase, FxBomb, NewGameOptions, ShooterState, ShotState,
} from "./types";

export interface ArenaEngineOptions {
  config?: Partial<ArenaConfig>; // merged over ARENA_CONFIG
  random?: RandomFn; // defaults to Math.random
}

// dangerChanged fires when the danger level crosses one of these.
export const DANGER_TIERS = [0.25, 0.5, 0.75, 0.9] as const;
const tierOf = (level: number) => DANGER_TIERS.filter((t) => level >= t).length;
const fx = (b: ArenaBomb): FxBomb => ({ id: b.id, x: b.x, z: b.z, colorIndex: b.colorIndex });

export class ArenaEngine {
  private readonly config: ArenaConfig;
  private readonly random: RandomFn;
  private readonly events = new TypedEmitter<ArenaEvents>();
  private readonly grid: SpatialGrid;
  private readonly finder = new GroupFinder();
  private readonly hit: RayHit = { t: 0, index: -1 };
  private readonly scratch: number[] = [];
  private readonly link: number; // "touching" distance between centres

  private bombs: SimBomb[] = []; // all bombs, including fading ones
  private readonly active: SimBomb[] = []; // idle bombs only (refreshActive)
  private readonly shooter: ShooterState = {
    x: 0, z: 0, yaw: -Math.PI / 2, vx: 0, vz: 0, moving: false, muzzleX: 0, muzzleZ: 0, cooldown: 0,
  };
  private readonly input = { x: 0, z: 0 };
  private shot: ShotState | null = null;
  private current = 0;
  private next = 0;
  private phase: ArenaPhase = "title";
  private level = 1;
  private score = 0;
  private combo = 0;
  private time = 0; // seconds of play since newGame
  private creepTime = 0; // play time with the creep running (drives surges)
  private creepBase = 0;
  private creepPaused = false;
  private surge = 0;
  private danger = 0;
  private dangerTier = 0;
  private minGap = Infinity;
  private closest: SimBomb | null = null;
  private nextId = 1;
  private revision = 0;
  private readonly sectors: number[] = [];
  private sectorsRev = -1;
  private aimCache: { rev: number; ray: AimRay } | null = null;

  constructor(options: ArenaEngineOptions = {}) {
    this.config = { ...ARENA_CONFIG, ...options.config };
    this.random = options.random ?? Math.random;
    this.link = this.config.bombRadius * 2 * this.config.connectScale;
    this.grid = new SpatialGrid(WORLD_HALF_EXTENT, this.link);
    this.setup(1); // title backdrop
  }

  on<E extends keyof ArenaEvents>(event: E, cb: (payload: ArenaEvents[E]) => void) {
    return this.events.on(event, cb);
  }

  // ---- Read-only getters -----------------------------------------------------

  getConfig(): Readonly<ArenaConfig> { return this.config; }
  getBombs(): readonly Readonly<ArenaBomb>[] { return this.bombs; }
  getShooter(): Readonly<ShooterState> { return this.shooter; }
  getShot(): Readonly<ShotState> | null { return this.shot; }
  getCurrentBomb(): number { return this.current; }
  getNextBomb(): number { return this.next; }
  getDangerLevel(): number { return this.danger; }
  // Smallest distance from any idle bomb's edge to the border (<= 0 = lost)
  getBorderGap(): number { return this.minGap; }
  getCreepSpeed(): number { return this.creepBase + this.surge * this.config.surgeStep; }
  isCreepPaused(): boolean { return this.creepPaused; }
  getScore(): number { return this.score; }
  getCombo(): number { return this.combo; } // consecutive popping shots
  getLevel(): number { return this.level; }
  getPhase(): ArenaPhase { return this.phase; }
  getRemaining(): number { return this.active.length; }
  getTime(): number { return this.time; }
  getRevision(): number { return this.revision; }

  // Danger 0..1 per angular sector (radar ring / off-screen arrows). Sector i
  // covers angles [i, i+1) * 2PI/sectors from +x towards +z. Allocation-free:
  // the returned array is reused (cached per revision + sector count), so
  // read it this frame and copy it if you need to keep it.
  getDangerByAngle(sectors = 16): readonly number[] {
    const n = Math.max(1, Math.floor(sectors));
    if (this.sectorsRev !== this.revision || this.sectors.length !== n) {
      this.sectorsRev = this.revision;
      dangerSectors(this.active, this.config, n, this.sectors);
    }
    return this.sectors;
  }

  // Straight aim guide from the muzzle + would-pop preview. Cached per
  // revision (one computation per frame at most).
  getAimRay(): AimRay {
    if (this.aimCache?.rev === this.revision) return this.aimCache.ray;
    const s = this.shooter, c = this.config;
    const dx = Math.cos(s.yaw), dz = Math.sin(s.yaw);
    const h = raycastBombs(this.active, s.muzzleX, s.muzzleZ, dx, dz, c.shotRange, c.bombRadius, this.hit);
    const end = { x: s.muzzleX + dx * h.t, z: s.muzzleZ + dz * h.t };
    const ray: AimRay = {
      from: { x: s.muzzleX, z: s.muzzleZ },
      to: end,
      hitBombId: h.index >= 0 ? this.active[h.index].id : null,
      landing: h.index >= 0 ? { ...end } : null,
      wouldPopIds: [],
    };
    if (h.index >= 0) {
      // Read-only flood from a virtual shot at the landing point
      this.grid.build(this.active);
      const group = this.finder.groupFromPoint(this.active, this.grid, end.x, end.z, this.current, this.link);
      if (group.length + 1 >= c.minMatch) ray.wouldPopIds = group.map((i) => this.active[i].id);
    }
    this.aimCache = { rev: this.revision, ray };
    return ray;
  }

  // ---- Commands --------------------------------------------------------------

  newGame(options: NewGameOptions = {}) {
    const previous = this.score;
    this.setup(options.level ?? 1);
    if (options.keepScore) this.score = previous;
    if (this.score !== previous) this.events.emit("scoreChanged", { score: this.score, delta: this.score - previous });
    this.setPhase("playing");
  }

  // Desired move direction in WORLD space; magnitude is clamped to 1. The
  // renderer converts camera-relative stick/keys to world space first.
  setMoveInput(x: number, z: number) {
    const fx0 = Number.isFinite(x) ? x : 0, fz0 = Number.isFinite(z) ? z : 0;
    const len = Math.hypot(fx0, fz0);
    const k = len > 1 ? 1 / len : 1;
    this.input.x = fx0 * k;
    this.input.z = fz0 * k;
  }

  setYaw(rad: number) {
    if (!Number.isFinite(rad)) return;
    this.shooter.yaw = wrapAngle(rad);
    updateMuzzle(this.shooter, this.config);
    this.touch();
  }

  turn(deltaRad: number) {
    this.setYaw(this.shooter.yaw + deltaRad);
  }

  // Face a ground point (ignored if it is the shooter's own position).
  aimAt(x: number, z: number) {
    const dx = x - this.shooter.x, dz = z - this.shooter.z;
    if (dx * dx + dz * dz > 1e-8) this.setYaw(Math.atan2(dz, dx));
  }

  // Tutorial helper: freeze/unfreeze the creep and the surge clock. Moving,
  // aiming, firing, popping and knock-back keep working.
  setCreepPaused(paused: boolean) {
    if (paused === this.creepPaused) return;
    this.creepPaused = paused;
    this.touch();
  }

  // Fire the current bomb along yaw. False if not allowed right now.
  fire(): boolean {
    const s = this.shooter;
    if (this.phase !== "playing" || this.shot || s.cooldown > 0) return false;
    const dirX = Math.cos(s.yaw), dirZ = Math.sin(s.yaw);
    this.shot = { x: s.muzzleX, z: s.muzzleZ, dirX, dirZ, colorIndex: this.current, travelled: 0 };
    s.cooldown = this.config.fireCooldown;
    this.events.emit("shoot", { x: s.muzzleX, z: s.muzzleZ, yaw: s.yaw, colorIndex: this.current });
    this.current = this.next;
    this.next = this.pickColor();
    this.refreshLoadout();
    this.touch();
    return true;
  }

  // Swap the current bomb with the next one.
  swapBomb(): boolean {
    if (this.phase !== "playing") return false;
    [this.current, this.next] = [this.next, this.current];
    this.events.emit("swap", { colorIndex: this.current, nextColorIndex: this.next });
    this.touch();
    return true;
  }

  update(dt: number) {
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, ARENA_MAX_DT);
    animateFx(this.bombs, this.config, step);
    if (this.phase === "playing") {
      this.time += step;
      if (!this.creepPaused) this.creepTime += step;
      const surge = Math.floor(this.creepTime / this.config.surgeInterval);
      if (surge > this.surge) {
        this.surge = surge;
        this.events.emit("creepSurge", { speed: this.getCreepSpeed(), surge });
      }
      stepShooter(this.shooter, this.input, this.config, step);
      const base = this.creepPaused ? 0 : this.getCreepSpeed();
      stepCreep(this.active, this.config, base, step, this.grid, this.scratch);
      if (this.shot) this.updateShot(step);
      if (this.phase === "playing") this.updateDanger();
    }
    this.touch();
  }

  // ---- Internals -------------------------------------------------------------

  private touch() { this.revision++; }

  private setPhase(phase: ArenaPhase) {
    if (phase === this.phase) return;
    const previous = this.phase;
    this.phase = phase;
    this.touch();
    this.events.emit("phaseChanged", { phase, previous });
  }

  private setup(level: number) {
    const p = levelParams(this.config, level);
    this.level = p.level;
    this.bombs = generateField(this.config, p.level, this.random, this.nextId);
    this.nextId += this.bombs.length;
    Object.assign(this.shooter, { x: 0, z: 0, yaw: -Math.PI / 2, vx: 0, vz: 0, moving: false, cooldown: 0 });
    updateMuzzle(this.shooter, this.config);
    this.input.x = this.input.z = 0;
    this.shot = null;
    this.score = this.combo = this.time = this.creepTime = this.surge = 0;
    this.creepBase = p.creepSpeed;
    this.refreshActive();
    this.current = this.pickColor();
    this.next = this.pickColor();
    this.measureGap();
    this.danger = dangerFromGap(this.minGap, this.config);
    this.dangerTier = tierOf(this.danger);
    this.touch();
  }

  private refreshActive() {
    this.active.length = 0;
    for (const b of this.bombs) if (b.state === "idle") this.active.push(b);
  }

  private updateShot(dt: number) {
    const s = this.shot!;
    const c = this.config;
    const seg = Math.min(c.shotSpeed * dt, c.shotRange - s.travelled);
    const h = raycastBombs(this.active, s.x, s.z, s.dirX, s.dirZ, seg, c.bombRadius, this.hit);
    s.x += s.dirX * h.t;
    s.z += s.dirZ * h.t;
    s.travelled += h.t;
    if (h.index >= 0) {
      this.stick(this.active[h.index]);
    } else if (s.travelled >= c.shotRange - 1e-9) {
      this.shot = null;
      this.combo = 0;
      this.events.emit("miss", { x: s.x, z: s.z });
    }
  }

  // The shot touched `target`: seat it as a field bomb, then match. A shot
  // that would NOT pop and whose edge would sit within deflectMargin of the
  // border deflects instead ("miss", deflected: true): only creep loses.
  private stick(target: SimBomb) {
    const s = this.shot!;
    this.shot = null;
    const b = makeBomb(this.nextId++, s.x, s.z, s.colorIndex, true);
    separateOne(b, this.active, this.config.bombRadius, 4);
    this.active.push(b);
    this.grid.build(this.active);
    const group = this.finder.group(this.active, this.grid, this.active.length - 1, this.link, true);
    const pops = group.length >= this.config.minMatch;
    if (!pops && borderGap(b, this.config) <= this.config.deflectMargin) {
      this.active.pop();
      this.combo = 0;
      this.events.emit("miss", { x: b.x, z: b.z, deflected: true });
      return;
    }
    this.bombs.push(b);
    this.events.emit("stick", { id: b.id, x: b.x, z: b.z, colorIndex: b.colorIndex, hitId: target.id });
    if (pops) this.pop(group.map((i) => this.active[i]));
    else this.combo = 0;
  }

  private pop(popped: SimBomb[]) {
    const c = this.config;
    for (const b of popped) {
      b.state = "popping";
      b.age = 0;
    }
    this.refreshActive();
    this.grid.build(this.active);
    const shattered = findOrphans(this.active, popped, c, this.grid, this.finder, this.link, this.scratch);
    for (const b of shattered) startShatter(b, c);
    this.refreshActive();

    this.combo++;
    const base = getBaseScore(popped.length) + shattered.length * DROP_BONUS_PER_TILE;
    const gained = base * Math.min(this.combo, MAX_COMBO_MULTIPLIER);
    this.score += gained;

    const centre = centroid(popped);
    applyKnockback(this.active, c, centre, popped.length, popped.length + shattered.length);

    this.events.emit("pop", { bombs: popped.map(fx), score: gained, combo: this.combo, centre });
    if (shattered.length > 0) this.events.emit("shatter", { bombs: shattered.map(fx) });
    this.events.emit("scoreChanged", { score: this.score, delta: gained });
    this.refreshLoadout();
    if (this.active.length === 0) {
      this.setPhase("won");
      this.events.emit("won", { score: this.score, time: this.time });
    }
  }

  private measureGap() {
    this.closest = closestToBorder(this.active, this.config);
    this.minGap = this.closest ? borderGap(this.closest, this.config) : Infinity;
  }

  // Danger tiers (dangerChanged) and the lose check.
  private updateDanger() {
    this.measureGap();
    this.danger = dangerFromGap(this.minGap, this.config);
    const tier = tierOf(this.danger);
    if (tier !== this.dangerTier) {
      const previousTier = this.dangerTier;
      this.dangerTier = tier;
      this.events.emit("dangerChanged", { level: this.danger, tier, previousTier });
    }
    const b = loseCandidate(this.active, this.config);
    if (b) {
      this.shot = null;
      this.setPhase("gameOver");
      this.events.emit("gameOver", { score: this.score, x: b.x, z: b.z, angle: Math.atan2(b.z, b.x), bombId: b.id });
    }
  }

  // Never hold a colour that has vanished from the field.
  private refreshLoadout() {
    if (this.active.length === 0) return;
    if (!hasColor(this.active, this.current)) this.current = this.pickColor();
    if (!hasColor(this.active, this.next)) this.next = this.pickColor();
  }

  private pickColor() {
    return pickPresentColor(this.active, this.config.colorCount, this.random);
  }
}
