import type { ArenaEngine } from "./ArenaEngine";
import type { ArenaFunEvents, BombKind, LevelBest, LevelDef, PowerKind } from "./funTypes";

// Arena 360 shared types. Plain data only, so any renderer (three.js, Skia,
// RN Views) can consume them and the engine stays framework-free.
//
// UNITS: world units on a flat ground plane (think "metres"). Positions are
// (x, z) with the origin at the arena centre. Angles are radians measured
// from +x towards +z: direction(angle) = (cos angle, sin angle).

export interface Vec2XZ {
  x: number;
  z: number;
}

export type ArenaPhase =
  | "title" // before the first game; field is a static backdrop
  | "playing" // creep running, shooter can move and fire
  | "gameOver" // a bomb touched the border line
  | "won"; // every field bomb cleared

// Animation state of a bomb. Popping/shattering bombs are still listed while
// they fade out, but no longer collide, creep, match or count as remaining.
export type ArenaBombState = "idle" | "popping" | "shattering";

// Every tunable rule. Defaults live in ARENA_CONFIG (arenaLayout.ts).
export interface ArenaConfig {
  arenaRadius: number; // border line radius; a bomb edge inside it = game over
  bombRadius: number; // every bomb (field + shot) is a circle of this radius
  colorCount: number; // colours in play, indices 0..colorCount-1 (BOMB_COLORS)

  shooterRadius: number; // body radius; centre is clamped to arenaRadius - this
  moveSpeed: number; // top speed, units / s
  moveAccel: number; // velocity spring omega (1 / s) while speeding up
  moveDecel: number; // velocity spring omega while slowing down / released
  moveReverse: number; // velocity spring omega when the input opposes the velocity
  muzzleOffset: number; // shots spawn this far in front of the body centre

  shotSpeed: number; // units / s, straight line, no gravity
  shotRange: number; // max travel before the shot fizzles (a "miss")
  fireCooldown: number; // seconds between shots (and only one shot in flight)

  connectScale: number; // touching = centre distance <= 2r * connectScale
  minMatch: number; // same-colour group size that pops
  orphanMaxSize: number; // isolated groups this small next to a pop shatter
  relaxIterations: number; // circle-separation passes per update

  ringInner: number; // level 1 field annulus (bomb centres)
  ringOuter: number;
  bombCount: number; // bombs at the first level after earlyLevels (then +bombsPerLevel)
  // Gentler first levels (index 0 = level 1): their bomb count and creep
  // multiplier. Later levels: bombCount + k * bombsPerLevel, creepSpeed + k * creepPerLevel.
  earlyLevels: { bombs: number; creepScale: number }[];
  bombsPerLevel: number; // extra bombs per level above 1
  maxBombs: number; // hard cap on the generated field size
  clumpMin: number; // layout clumps of same-colour bombs
  clumpMax: number;
  blobClumpsMax: number; // touching clumps (different colours) per layout blob

  creepSpeed: number; // base inward speed at the first post-early level, units / s
  creepPerLevel: number; // extra base speed per level above 1
  creepDistanceFactor: number; // speed *= 1 + factor * (dist - arenaRadius)
  surgeInterval: number; // seconds between creep surges
  surgeStep: number; // base speed added by each surge

  knockbackPerBomb: number; // outward kick speed per popped/shattered bomb
  knockbackRadius: number; // reach of the kick around the pop centre (+ size)
  knockbackDamping: number; // kick decay rate, 1 / s

  dangerRange: number; // gap (bomb edge to border) at which danger starts
  deflectMargin: number; // a non-popping shot whose edge would stick within this of the border deflects
  stuckGrace: number; // seconds a freshly stuck shot can't trigger game over
  popDuration: number; // seconds a popping bomb fades
  shatterDuration: number; // seconds a shattering bomb drifts + fades
  shatterSpeed: number; // outward drift speed of shattering bombs
}

// A bomb as the renderer sees it. The engine reuses these objects: treat them
// as read-only and copy anything you need to keep across frames.
export interface ArenaBomb {
  id: number; // stable while the bomb exists (use as a mesh key)
  x: number; // centre on the ground plane
  z: number;
  colorIndex: number;
  state: ArenaBombState;
  alpha: number; // 1 while idle, fades to 0 while popping/shattering
  age: number; // seconds since the bomb entered its current state
  stuck: boolean; // true if it was a shot that stuck (age = time since stick)
  kind: BombKind; // "normal" | "armored" | "ticking" | "roller" (wall roller before it launches)
  armor: 0 | 1; // armored: 1 until the first match strips it (then kind stays "armored", armor 0)
  band: 0 | 1; // double ring: 0 inner band, 1 outer band (single ring: 0)
  timer: number | null; // ticking: s left once armed (tickTimer before arming); null otherwise
  armed: boolean; // ticking: countdown running
  telegraph: number; // roller: s until it detaches (shaking), -1 = not telegraphing
}

export interface ShooterState {
  x: number;
  z: number;
  yaw: number; // facing, radians, (-PI, PI]
  vx: number; // velocity, units / s
  vz: number;
  ax: number; // acceleration (velocity spring state), units / s^2
  az: number;
  moving: boolean; // speed above a small threshold (for run/idle animation)
  muzzleX: number; // where the next shot spawns
  muzzleZ: number;
  cooldown: number; // seconds until fire() is allowed again (0 = ready)
}

export interface ShotState {
  id: number; // stable while in flight
  x: number;
  z: number;
  dirX: number; // unit direction
  dirZ: number;
  colorIndex: number;
  travelled: number; // units since the muzzle (fizzles at shotRange)
  speed: number; // units / s (fever shots are faster)
  power: PowerKind | null; // a loaded POWER shot (colorIndex is then the displaced current colour)
  wild: boolean; // fever: takes the colour of whatever it hits
}

export interface AimRay {
  from: Vec2XZ; // muzzle
  to: Vec2XZ; // landing point, or end of range
  hitBombId: number | null; // first bomb the ray touches
  landing: Vec2XZ | null; // where the shot centre would stick
  // Ids of field bombs that would pop if the current bomb stuck at `landing`
  // (same-colour group incl. the shot >= minMatch). Empty if none.
  wouldPopIds: number[];
  // What the ray reaches first: a field bomb, a rolling roller, a boss shield
  // bomb or the boss core (null = nothing within range), and its id.
  target: "bomb" | "roller" | "shield" | "core" | null;
  targetId: number | null;
}

export interface FxBomb {
  id: number;
  x: number;
  z: number;
  colorIndex: number;
}

// ---- Events -----------------------------------------------------------------

export interface ArenaEvents extends ArenaFunEvents {
  shoot: { x: number; z: number; yaw: number; colorIndex: number };
  stick: { id: number; x: number; z: number; colorIndex: number; hitId: number };
  pop: { bombs: FxBomb[]; score: number; combo: number; centre: Vec2XZ };
  shatter: { bombs: FxBomb[] };
  // shot fizzled at max range, or deflected: it would have stuck on/inside
  // the border line without popping (no game over for that; combo resets)
  miss: { x: number; z: number; deflected?: boolean };
  creepSurge: { speed: number; surge: number }; // base speed after the surge
  dangerChanged: { level: number; tier: number; previousTier: number };
  swap: { colorIndex: number; nextColorIndex: number };
  gameOver: { score: number; x: number; z: number; angle: number; bombId: number };
  won: { score: number; time: number };
  scoreChanged: { score: number; delta: number };
  phaseChanged: { phase: ArenaPhase; previous: ArenaPhase };
}

export type ArenaEventName = keyof ArenaEvents;

export interface NewGameOptions {
  level?: number; // 1-based, default 1
  keepScore?: boolean; // carry the score over (level progression)
  levelDef?: LevelDef; // override the LEVELS table (tests / LEVELS-tab experiments)
  best?: LevelBest; // persisted bests for this level -> levelStars.newBest
}

// The subset of the engine a renderer may read (no commands).
export type ArenaEngineView = Pick<
  ArenaEngine,
  | "on"
  | "getConfig"
  | "getBombs"
  | "getShooter"
  | "getShot"
  | "getCurrentBomb"
  | "getNextBomb"
  | "getAimRay"
  | "getDangerLevel"
  | "getDangerByAngle"
  | "getBorderGap"
  | "isCreepPaused"
  | "getCreepSpeed"
  | "getScore"
  | "getCombo"
  | "getLevel"
  | "getPhase"
  | "getRemaining"
  | "getTime"
  | "getRevision"
  | "getLevelDef"
  | "getPickups"
  | "getPowerSlot"
  | "getFreeze"
  | "getFever"
  | "getShots"
  | "getRollers"
  | "getRoll"
  | "getStun"
  | "getBoss"
  | "getTimeScale"
  | "getStarProgress"
  | "getBestCombo"
>;
