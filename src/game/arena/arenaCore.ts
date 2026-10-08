// Shared mutable state of one Arena 360 engine, plus the tiny helpers every
// subsystem needs (events, score, phase, active list, colours, slow-mo).
// ArenaEngine owns one ArenaCore and wires the subsystems into `sys`.

import { TypedEmitter } from "../emitter";
import { RandomFn } from "../grid";
import type { ArenaFunConfig } from "./arenaFun";
import { GroupFinder } from "./arenaMatch";
import { RayHit, SimBomb, SpatialGrid } from "./arenaPhysics";
import { hasColor, pickPresentColor } from "./arenaSim";
import { WORLD_HALF_EXTENT } from "./arenaLayout";
import type { LevelDef } from "./funTypes";
import type { ArenaConfig, ArenaEvents, ArenaPhase, ShooterState } from "./types";
import type { Boss } from "./boss";
import type { Fever } from "./fever";
import type { Pickups } from "./pickups";
import type { Resolver } from "./resolve";
import type { RingMotion } from "./ringMotion";
import type { RollSystem } from "./roll";
import type { Rollers } from "./rollers";
import type { Shots } from "./shots";
import type { Ticking } from "./specialBombs";
import type { WallPush } from "./wallPush";
import type { Stars } from "./stars";

export interface Systems {
  pickups: Pickups;
  fever: Fever;
  ticking: Ticking;
  rollers: Rollers;
  roll: RollSystem;
  boss: Boss;
  stars: Stars;
  ring: RingMotion;
  shots: Shots;
  resolve: Resolver;
  push: WallPush;
}

// Engine-applied time scale (fever slow-mo, perfect dodge, boss hit-stop).
// The renderer feeds update(realDt * getTimeScale()); the engine recovers
// real time from the scale it reported, so hold/ramp are in real seconds.
export class TimeScale {
  scale = 1;
  private from = 1;
  private hold = 0;
  private ramp = 0;
  private t = 0;

  trigger(scale: number, hold: number, ramp: number) {
    this.from = this.scale = scale;
    this.hold = hold;
    this.ramp = ramp;
    this.t = 0;
  }

  reset() {
    this.scale = this.from = 1;
    this.hold = this.ramp = this.t = 0;
  }

  advance(gameDt: number) {
    if (this.scale >= 1) return;
    this.t += gameDt / Math.max(0.01, this.scale);
    const u = this.t <= this.hold ? 0 : this.ramp > 0 ? (this.t - this.hold) / this.ramp : 1;
    this.scale = u >= 1 ? 1 : this.from + (1 - this.from) * u;
  }
}

export class ArenaCore {
  readonly events = new TypedEmitter<ArenaEvents>();
  readonly grid: SpatialGrid;
  readonly finder = new GroupFinder();
  readonly hit: RayHit = { t: 0, index: -1 };
  readonly scratch: number[] = [];
  readonly link: number; // "touching" distance between centres
  readonly timeScale = new TimeScale();

  bombs: SimBomb[] = []; // all bombs, including fading ones
  readonly active: SimBomb[] = []; // idle bombs only (refreshActive)
  readonly shooter: ShooterState = {
    x: 0, z: 0, yaw: -Math.PI / 2, vx: 0, vz: 0, ax: 0, az: 0, moving: false, muzzleX: 0, muzzleZ: 0, cooldown: 0,
  };
  readonly input = { x: 0, z: 0 };
  def!: LevelDef;
  phase: ArenaPhase = "title";
  level = 1;
  score = 0;
  combo = 0;
  bestCombo = 0;
  time = 0; // s of simulation since newGame (every update while playing)
  playTime = 0; // par / FAST clock: only while the creep runs and the clock isn't paused (Freeze counts)
  clockPaused = false; // setClockPaused: UI gates (CLICK TO PLAY, menus) on top of creepPaused
  worldTime = 0; // play time with the world running (not frozen, creep not paused)
  creepTime = 0; // drives surges (= worldTime)
  creepBase = 0;
  creepPaused = false;
  surge = 0;
  freeze = 0; // s of Freeze left
  danger = 0;
  dangerTier = 0;
  minGap = Infinity;
  current = 0;
  next = 0;
  nextId = 1;
  revision = 0;
  private intros = new Set<string>();
  sys!: Systems;

  constructor(readonly config: ArenaConfig, readonly fun: ArenaFunConfig, readonly random: RandomFn) {
    this.link = config.bombRadius * 2 * config.connectScale;
    this.grid = new SpatialGrid(WORLD_HALF_EXTENT, this.link);
  }

  emit<K extends keyof ArenaEvents>(event: K, payload: ArenaEvents[K]) {
    this.events.emit(event, payload);
  }

  touch() {
    this.revision++;
  }

  get playing() {
    return this.phase === "playing";
  }

  // Creep, surges, rotation, ticking timers, wall-roller clocks and the boss stop.
  get worldPaused() {
    return this.freeze > 0 || this.creepPaused;
  }

  has(feature: string) {
    return (this.def.features as string[]).includes(feature);
  }

  // featureIntro once per level (the UI filters by introsSeen).
  intro(feature: LevelDef["features"][number]) {
    if (this.intros.has(feature) || !this.has(feature)) return;
    this.intros.add(feature);
    this.emit("featureIntro", { feature });
  }

  resetLevelFlags() {
    this.intros.clear();
  }

  addScore(delta: number) {
    if (delta === 0) return;
    this.score += delta;
    this.emit("scoreChanged", { score: this.score, delta });
  }

  bumpCombo() {
    this.combo++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
  }

  setPhase(phase: ArenaPhase) {
    if (phase === this.phase) return;
    const previous = this.phase;
    this.phase = phase;
    this.touch();
    this.emit("phaseChanged", { phase, previous });
  }

  refreshActive() {
    this.active.length = 0;
    for (const b of this.bombs) if (b.state === "idle") this.active.push(b);
  }

  // Remove a bomb from the field without any FX (roller detaching).
  detach(b: SimBomb) {
    const i = this.bombs.indexOf(b);
    if (i >= 0) this.bombs.splice(i, 1);
    b.state = "popping";
    b.alpha = 0;
    this.refreshActive();
  }

  pickColor() {
    return pickPresentColor(this.active, this.config.colorCount, this.random);
  }

  // Current / next pick with the danger colour assist: while a bomb edge is
  // within assist.gap of the border, `chance` of the time take the colour of
  // one of the `closest` bombs nearest the border.
  pickShotColor() {
    const a = this.fun.assist, near = this.nearest;
    let n = 0;
    near.length = 0;
    for (const b of this.active) {
      const g = Math.hypot(b.x, b.z) - this.config.bombRadius - this.config.arenaRadius;
      if (g > a.gap) continue;
      if (n < a.closest) {
        near[n++] = b;
      } else {
        let worst = 0;
        for (let i = 1; i < n; i++) if (Math.hypot(near[i].x, near[i].z) > Math.hypot(near[worst].x, near[worst].z)) worst = i;
        if (Math.hypot(b.x, b.z) < Math.hypot(near[worst].x, near[worst].z)) near[worst] = b;
      }
    }
    if (n > 0 && this.random() < a.chance) return near[Math.floor(this.random() * n)].colorIndex;
    return this.pickColor();
  }
  private readonly nearest: SimBomb[] = [];

  // Never hold a colour that has vanished from the field.
  refreshLoadout() {
    if (this.active.length === 0) return;
    if (!hasColor(this.active, this.current)) this.current = this.pickShotColor();
    if (!hasColor(this.active, this.next)) this.next = this.pickShotColor();
  }
}
