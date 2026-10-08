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
 * FULL API (every getter, command and event with payloads, plus renderer /
 * audio notes): src/game/arena/API.md. Data shapes: types.ts + funTypes.ts.
 *
 * PER-FRAME READS (live objects; treat as read-only, copy to keep):
 *   getBombs() getShooter() getShot() getShots() getCurrentBomb() getNextBomb()
 *   getAimRay() getDangerLevel() getDangerByAngle(n) getBorderGap() getCreepSpeed()
 *   isCreepPaused() getScore() getCombo() getBestCombo() getLevel() getLevelDef()
 *   getPhase() getRemaining() getTime() getRevision() getConfig() getFunConfig()
 *   getPickups() getPowerSlot() getFreeze() getFever() getRollers() getRoll()
 *   getStun() getBoss() getTimeScale() getStarProgress()
 * COMMANDS: newGame({level, keepScore, levelDef, best}), update(dt),
 *   setMoveInput(x, z) (WORLD-space, |v| <= 1), setYaw(rad), turn(delta), aimAt(x, z),
 *   fire(), swapBomb(), setCreepPaused(paused), roll(dirX, dirZ), setFireHeld(held),
 *   previewPower(kind, yaw); dev/tests: debugSpawnPickup, debugSetFever,
 *   debugSetBossHp, debugLaunchRoller, debugArmTicking.
 * TIME SCALE: the renderer calls update(realDt * getTimeScale()) (slow-mo).
 * PHASES: title -> playing -> gameOver | won   (newGame() from any phase)
 * RULES + numbers: ARENA_CONFIG (arenaLayout.ts), ARENA_FUN (arenaFun.ts), LEVELS (arenaLevels.ts).
 */

import { RandomFn, clamp } from "../grid";
import { ArenaCore, Systems } from "./arenaCore";
import { ARENA_FUN, ArenaFunConfig, ArenaFunOverrides, mergeFun } from "./arenaFun";
import { ARENA_CONFIG, ARENA_MAX_DT, generateField } from "./arenaLayout";
import type { SimBomb } from "./arenaPhysics";
import { fieldBands, levelDef } from "./arenaLevels";
import {
  animateFx, borderGap, closestToBorder, dangerFromGap, dangerSectors, isMoving, loseCandidate, stepCreep, stepShooter,
  updateMuzzle, wrapAngle,
} from "./arenaSim";
import { Boss } from "./boss";
import { Fever } from "./fever";
import type { BossState, FeverState, LevelDef, Pickup, PickupKind, PowerKind, Roller, RollState, StarProgress } from "./funTypes";
import { Pickups } from "./pickups";
import { Resolver } from "./resolve";
import { RingMotion } from "./ringMotion";
import { RollSystem } from "./roll";
import { Rollers } from "./rollers";
import { Shots } from "./shots";
import { Ticking, assignSpecials } from "./specialBombs";
import { Stars } from "./stars";
import type { AimRay, ArenaBomb, ArenaConfig, ArenaEvents, ArenaPhase, NewGameOptions, ShooterState, ShotState } from "./types";

export interface ArenaEngineOptions {
  config?: Partial<ArenaConfig>; // merged over ARENA_CONFIG
  fun?: ArenaFunOverrides; // merged (per section) over ARENA_FUN
  random?: RandomFn; // defaults to Math.random
}

// dangerChanged fires when the danger level crosses one of these.
export const DANGER_TIERS = [0.25, 0.5, 0.75, 0.9] as const;
const tierOf = (level: number) => DANGER_TIERS.filter((t) => level >= t).length;
const NO_INPUT = { x: 0, z: 0 };
const START_INTROS = ["armored", "rotation", "roll", "doubleRing"] as const;

export class ArenaEngine {
  private readonly core: ArenaCore;
  private readonly sys: Systems;
  private readonly sectors: number[] = [];
  private sectorsRev = -1;

  constructor(options: ArenaEngineOptions = {}) {
    const core = new ArenaCore({ ...ARENA_CONFIG, ...options.config }, options.fun ? mergeFun(options.fun) : ARENA_FUN, options.random ?? Math.random);
    this.core = core;
    this.sys = core.sys = {
      pickups: new Pickups(core), fever: new Fever(core), ticking: new Ticking(core), rollers: new Rollers(core),
      roll: new RollSystem(core), boss: new Boss(core), stars: new Stars(core), ring: new RingMotion(core),
      shots: new Shots(core), resolve: new Resolver(core),
    };
    this.setup(1, {}); // title backdrop
  }

  on<E extends keyof ArenaEvents>(event: E, cb: (payload: ArenaEvents[E]) => void) {
    return this.core.events.on(event, cb);
  }

  // ---- Read-only getters -----------------------------------------------------

  getConfig(): Readonly<ArenaConfig> { return this.core.config; }
  getFunConfig(): Readonly<ArenaFunConfig> { return this.core.fun; }
  getBombs(): readonly Readonly<ArenaBomb>[] { return this.core.bombs; }
  getShooter(): Readonly<ShooterState> { return this.core.shooter; }
  getShot(): Readonly<ShotState> | null { return this.sys.shots.list[0] ?? null; } // first shot in flight
  getShots(): readonly Readonly<ShotState>[] { return this.sys.shots.list; }
  getCurrentBomb(): number { return this.core.current; }
  getNextBomb(): number { return this.core.next; }
  getDangerLevel(): number { return this.core.danger; }
  // Smallest distance from any idle bomb's (or the boss core's) edge to the border (<= 0 = lost)
  getBorderGap(): number { return this.core.minGap; }
  getCreepSpeed(): number { return this.core.creepBase + this.core.surge * this.core.config.surgeStep; }
  isCreepPaused(): boolean { return this.core.creepPaused; }
  getScore(): number { return this.core.score; }
  getCombo(): number { return this.core.combo; } // consecutive popping shots
  getBestCombo(): number { return this.core.bestCombo; } // this level
  getLevel(): number { return this.core.level; }
  getLevelDef(): Readonly<LevelDef> { return this.core.def; }
  getPhase(): ArenaPhase { return this.core.phase; }
  getRemaining(): number { return this.core.active.length; }
  getTime(): number { return this.core.time; }
  getRevision(): number { return this.core.revision; }
  getPickups(): readonly Readonly<Pickup>[] { return this.sys.pickups.list; }
  getPowerSlot(): PowerKind | null { return this.sys.pickups.slot; }
  getFreeze(): number { return this.core.freeze; } // s of Freeze left
  getFever(): Readonly<FeverState> { return this.sys.fever.state; }
  getRollers(): readonly Readonly<Roller>[] { return this.sys.rollers.list; }
  getRoll(): Readonly<RollState> { return this.sys.roll.state; }
  getStun(): number { return this.sys.roll.stun; } // s of stun left
  getBoss(): Readonly<BossState> | null { return this.sys.boss.state; }
  getTimeScale(): number { return this.core.timeScale.scale; }
  getStarProgress(): Readonly<StarProgress> { return this.sys.stars.read(); }

  // Danger 0..1 per angular sector (radar ring / off-screen arrows). Sector i
  // covers angles [i, i+1) * 2PI/sectors from +x towards +z. Allocation-free:
  // the returned array is reused (cached per revision + sector count).
  getDangerByAngle(sectors = 16): readonly number[] {
    const n = Math.max(1, Math.floor(sectors));
    if (this.sectorsRev !== this.core.revision || this.sectors.length !== n) {
      this.sectorsRev = this.core.revision;
      dangerSectors(this.core.active, this.core.config, n, this.sectors);
    }
    return this.sectors;
  }

  // Aim guide from the muzzle + would-pop preview (power / fever aware).
  // Cached per revision (one computation per frame at most).
  getAimRay(): AimRay { return this.sys.shots.aimRay(); }

  // Field bomb ids a POWER shot along `yaw` would remove (bot + aim highlight).
  previewPower(kind: PowerKind, yaw: number): number[] {
    const s = this.core.shooter, o = this.core.config.muzzleOffset;
    return this.sys.shots.preview(kind, yaw, s.x + Math.cos(yaw) * o, s.z + Math.sin(yaw) * o);
  }

  // ---- Commands --------------------------------------------------------------

  newGame(options: NewGameOptions = {}) {
    const core = this.core, previous = core.score;
    this.setup(options.level ?? 1, options);
    if (options.keepScore) core.score = previous;
    if (core.score !== previous) core.emit("scoreChanged", { score: core.score, delta: core.score - previous });
    core.setPhase("playing");
    for (const f of START_INTROS) core.intro(f);
    this.sys.boss.announce();
  }

  // Desired move direction in WORLD space; magnitude is clamped to 1. The
  // renderer converts camera-relative stick/keys to world space first.
  setMoveInput(x: number, z: number) {
    const fx0 = Number.isFinite(x) ? x : 0, fz0 = Number.isFinite(z) ? z : 0;
    const len = Math.hypot(fx0, fz0);
    const k = len > 1 ? 1 / len : 1;
    this.core.input.x = fx0 * k;
    this.core.input.z = fz0 * k;
  }

  setYaw(rad: number) {
    if (!Number.isFinite(rad)) return;
    this.core.shooter.yaw = wrapAngle(rad);
    updateMuzzle(this.core.shooter, this.core.config);
    this.core.touch();
  }

  // Relative turn (halved while stunned).
  turn(deltaRad: number) {
    const k = this.sys.roll.stun > 0 ? this.core.fun.roller.stunTurnScale : 1;
    this.setYaw(this.core.shooter.yaw + deltaRad * k);
  }

  // Face a ground point (ignored if it is the shooter's own position).
  aimAt(x: number, z: number) {
    const dx = x - this.core.shooter.x, dz = z - this.core.shooter.z;
    if (dx * dx + dz * dz > 1e-8) this.setYaw(Math.atan2(dz, dx));
  }

  // Tutorial helper: freeze/unfreeze the creep, surges, rotation, ticking and
  // wall-roller clocks. Moving, aiming, firing, popping, knock-back and rollers
  // already rolling keep working.
  setCreepPaused(paused: boolean) {
    if (paused === this.core.creepPaused) return;
    this.core.creepPaused = paused;
    this.core.touch();
  }

  // Fire the loaded power, else the current bomb, along yaw. False if not
  // allowed right now (a press during a roll / late stun is buffered).
  fire(): boolean { return this.sys.shots.fire(); }

  // Swap the current bomb with the next one (locked while a power is loaded).
  swapBomb(): boolean {
    const core = this.core;
    if (!core.playing || this.sys.pickups.slot) return false;
    [core.current, core.next] = [core.next, core.current];
    core.emit("swap", { colorIndex: core.current, nextColorIndex: core.next });
    core.touch();
    return true;
  }

  // Dodge roll (L5+): world direction, |v| <= 0.3 = move input, else backward.
  // True if it started or was buffered.
  roll(dirX: number, dirZ: number): boolean {
    const ok = this.sys.roll.request(dirX, dirZ);
    if (ok) this.core.touch();
    return ok;
  }

  // Hold-to-fire: auto-repeats only while fever is active.
  setFireHeld(held: boolean) { this.sys.shots.fireHeld = held; }

  // ---- Dev / tests only (not for production UI) --------------------------------

  debugSpawnPickup(kind: PickupKind, x: number, z: number): number { return this.sys.pickups.debugSpawn(kind, x, z); }
  debugSetFever(v: number) { this.sys.fever.set(v); }
  debugSetBossHp(hp: number) { this.sys.boss.debugSetHp(hp); }
  debugArmTicking(id?: number): boolean { return this.sys.ticking.debugArm(id); }

  // Telegraph + launch a roller now (ignores clocks, cap and pause): bomb `id`,
  // else the wall roller closest to the facing direction (if within 45 deg),
  // else the inner-face bomb in front. Returns the roller id or -1.
  // speedScale 0.7 = the L5 tutorial roller.
  debugLaunchRoller(id?: number, speedScale = 1): number {
    const core = this.core, yaw = core.shooter.yaw;
    const off = (b: SimBomb) => Math.abs(wrapAngle(Math.atan2(b.z, b.x) - yaw));
    const best = (xs: SimBomb[], score: (b: SimBomb) => number) => xs.reduce<SimBomb | undefined>((m, b) => (!m || score(b) < score(m) ? b : m), undefined);
    const wall = best(core.active.filter((x) => x.kind === "roller" && x.telegraph < 0), off);
    const b = id !== undefined
      ? core.active.find((x) => x.id === id)
      : wall && off(wall) <= Math.PI / 4 ? wall : best(core.active, (x) => off(x) + borderGap(x, core.config) * 0.05);
    if (!b || !this.sys.rollers.telegraph(b, speedScale)) return -1;
    core.touch();
    return b.id;
  }

  update(dt: number) {
    const core = this.core, sys = this.sys, c = core.config;
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, ARENA_MAX_DT);
    core.timeScale.advance(step);
    animateFx(core.bombs, c, step);
    if (core.playing) {
      core.time += step;
      const world = core.worldPaused ? 0 : step;
      core.worldTime += world;
      core.creepTime += world;
      const surge = Math.floor(core.creepTime / c.surgeInterval);
      if (surge > core.surge) {
        core.surge = surge;
        core.emit("creepSurge", { speed: this.getCreepSpeed(), surge });
      }
      if (core.freeze > 0) {
        core.freeze = Math.max(0, core.freeze - step);
        if (core.freeze === 0) core.emit("freezeEnd", {});
      }
      sys.fever.update(step);
      const s = core.shooter;
      if (sys.roll.step(step)) {
        s.cooldown = Math.max(0, s.cooldown - step);
        s.moving = isMoving(s);
        updateMuzzle(s, c);
      } else stepShooter(s, sys.roll.stun > 0 ? NO_INPUT : core.input, c, step);
      sys.ring.rotate(step);
      sys.ring.stepLurch(step);
      const base = core.worldPaused ? 0 : this.getCreepSpeed() * sys.boss.ringCreepScale();
      stepCreep(core.active, c, base, step, core.grid, core.scratch);
      sys.boss.update(step);
      sys.ticking.update(world);
      sys.rollers.update(step);
      sys.pickups.update(step);
      sys.shots.update(step);
      if (core.playing && sys.roll.takeFireBuffer()) this.fire();
      if (core.playing && sys.shots.fireHeld && sys.fever.active) this.fire();
      if (core.playing && core.active.length === 0 && !sys.boss.state) sys.stars.win();
      if (core.playing) this.updateDanger();
    }
    core.touch();
  }

  // ---- Internals -------------------------------------------------------------

  // Back-compat for tooling that pokes the base creep (scripts/arena-smoke.ts).
  private get creepBase() { return this.core.creepBase; }
  private set creepBase(v: number) { this.core.creepBase = v; }

  private setup(level: number, options: NewGameOptions) {
    const core = this.core, sys = this.sys, c = core.config;
    const def = options.levelDef ?? levelDef(c, level);
    core.def = def;
    core.level = def.level;
    const bossAngle = def.boss ? core.random() * Math.PI * 2 : null;
    const bands = fieldBands(c, core.fun, def, core.random, bossAngle);
    core.bombs = generateField(c, bands, core.random, core.nextId);
    core.nextId += core.bombs.length;
    assignSpecials(core.bombs, def, bands, core.fun, core.random);
    Object.assign(core.shooter, { x: 0, z: 0, yaw: -Math.PI / 2, vx: 0, vz: 0, ax: 0, az: 0, moving: false, cooldown: 0 });
    updateMuzzle(core.shooter, c);
    core.input.x = core.input.z = 0;
    core.score = core.combo = core.bestCombo = core.time = core.worldTime = core.creepTime = core.surge = core.freeze = 0;
    core.creepBase = def.creepBase;
    core.resetLevelFlags();
    core.timeScale.reset();
    core.refreshActive();
    core.current = core.pickColor();
    core.next = core.pickColor();
    sys.shots.clear();
    sys.ring.reset();
    sys.fever.reset();
    sys.pickups.reset();
    sys.ticking.reset();
    sys.rollers.reset();
    sys.roll.reset();
    sys.boss.reset(bossAngle);
    sys.stars.reset(options.best);
    this.measureGap();
    core.danger = dangerFromGap(core.minGap, c);
    core.dangerTier = tierOf(core.danger);
    core.touch();
  }

  private measureGap() {
    const core = this.core, closest = closestToBorder(core.active, core.config);
    core.minGap = Math.min(closest ? borderGap(closest, core.config) : Infinity, this.sys.boss.coreGap());
  }

  // Danger tiers (dangerChanged), FLAWLESS tracking and the lose check.
  private updateDanger() {
    const core = this.core;
    this.measureGap();
    core.danger = dangerFromGap(core.minGap, core.config);
    this.sys.stars.noteDanger(core.danger);
    const tier = tierOf(core.danger);
    if (tier !== core.dangerTier) {
      const previousTier = core.dangerTier;
      core.dangerTier = tier;
      core.emit("dangerChanged", { level: core.danger, tier, previousTier });
    }
    const b = loseCandidate(core.active, core.config);
    const boss = this.sys.boss.state;
    const lost = b ?? (boss && this.sys.boss.coreGap() <= 0 ? boss : null);
    if (lost) {
      this.sys.shots.clear();
      core.setPhase("gameOver");
      core.emit("gameOver", { score: core.score, x: lost.x, z: lost.z, angle: Math.atan2(lost.z, lost.x), bombId: lost.id });
    }
  }
}
