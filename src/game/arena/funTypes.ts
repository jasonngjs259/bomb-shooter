// Arena 360 "fun pass" data shapes: level definitions, pickups, powers,
// fever, special bombs, rollers, roll, boss, stars, and their events.
// Plain data only (no classes), shared by the engine, renderer, HUD and audio.
// Rules + numbers: ARENA_FUN (arenaFun.ts) and the LEVELS table (arenaLevels.ts).

import type { FxBomb, Vec2XZ } from "./types";

export type PickupKind = "rainbow" | "mega" | "freeze" | "lightning";
export type PowerKind = Exclude<PickupKind, "freeze">;
export type BombKind = "normal" | "armored" | "ticking" | "roller";
export type FeatureId =
  | "pickups" | "armored" | "fever" | "boss" | "ticking" | "rotation" | "roller" | "roll" | "doubleRing" | PickupKind;

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number; // ground position (interpolated along the arc while flying)
  z: number;
  y: number; // height: arc while flying, ARENA_FUN.pickups.groundY on the floor
  state: "flying" | "ground" | "blinking"; // blinking = last `blinkAt` s of its life
  age: number; // s since spawn (flying) or since landing (ground/blinking)
  ttl: number; // s left on the floor (paused while locked); flight s left while flying
  locked: boolean; // shot-type pickup while the POWER slot is full: can't be collected, timer paused
}

export interface Roller {
  id: number; // the wall bomb's id it detached from (boss rollers get a fresh id)
  x: number;
  z: number;
  dirX: number; // unit heading
  dirZ: number;
  speed: number; // w/s (0 while frozen)
  colorIndex: number;
  age: number; // s since launch
}

export interface RollState {
  state: "locked" | "ready" | "rolling" | "cooldown";
  t: number; // s into the current roll (0 when not rolling)
  cooldown: number; // s until a roll is allowed again (0 = ready)
  iFrames: boolean; // rollers can't hit the player right now
  dirX: number; // unit direction of the current / last roll
  dirZ: number;
}

export interface BossShieldBomb {
  id: number;
  angle: number; // radians around the core centre
  x: number;
  z: number;
  colorIndex: number;
  scale: number; // 0..1 while regrowing out of the core (only collides at 1)
}

export interface BossState {
  mk: number;
  id: number; // core id (gameOver.bombId when the core touches the border)
  x: number; // core centre
  z: number;
  r: number; // core radius
  hp: number;
  maxHp: number;
  phase: 1 | 2 | 3;
  weakColor: number; // colour index that deals double damage
  nextWeakColor: number; // flicker it on the rim when weakIn <= ARENA_FUN.boss.weakTelegraph
  weakIn: number; // s until weakColor becomes nextWeakColor
  shield: BossShieldBomb[];
  shieldRadius: number; // orbit radius of the shield bombs around the core centre
  orbitSpeed: number; // shield angular speed, rad/s, signed (+ = from +x towards +z); 0 while frozen
  invulnerable: boolean; // phase shift (1.2 s)
}

export interface BossDef {
  mk: number;
  coreHp: number;
  shield: number; // shield bomb count N
  orbit: number; // deg/s
  regrow: number; // s per regrown shield bomb (phases 1-2)
  ring: number; // ring bombs
}

export interface LevelDef {
  level: number;
  bombs: number; // field bombs (boss levels: ring bombs)
  creepBase: number; // base creep, w/s, before surges
  armored: number;
  ticking: number;
  tickTimer: number; // s from arming to detonation
  rollers: number;
  rollersLive: number; // max rollers telegraphing + rolling at once
  rotation: [number, number]; // deg/s for band 0 (inner / single ring) and band 1 (outer); + = from +x towards +z
  doubleRing: boolean;
  boss: null | BossDef;
  pickups: PickupKind[]; // unlocked kinds
  fever: boolean;
  roll: boolean;
  par: number; // s, FAST star
  features: FeatureId[]; // everything active this level
  introduces: FeatureId[]; // features first unlocked at this level (subset of features)
}

export interface FeverState {
  meter: number; // 0..100 (while active: the 6 s drain bar, 100 -> 0)
  active: boolean;
  remaining: number; // s of fever left (0 when inactive)
  lockout: number; // s the meter stays locked at 0 after a fever
}

export interface StarProgress {
  time: number;
  par: number;
  flawless: boolean; // still possible: no roller hit, no lurch, danger never >= 0.9
  maxDanger: number;
}

// Previous bests for this level (UI-persisted), used for levelStars.newBest.
export interface LevelBest {
  score?: number;
  combo?: number;
  time?: number;
}

// ---- Events -------------------------------------------------------------------

export interface ArenaFunEvents {
  featureIntro: { feature: FeatureId };
  pickupSpawned: { id: number; kind: PickupKind; from: Vec2XZ; to: Vec2XZ; flight: number };
  pickupLanded: { id: number };
  pickupCollected: { id: number; kind: PickupKind; x: number; z: number; loaded: boolean };
  pickupBlocked: { id: number };
  pickupExpired: { id: number; kind: PickupKind };
  powerFired: { kind: PowerKind; x: number; z: number; yaw: number };
  megaBlast: { x: number; z: number; radius: number; bombs: FxBomb[] };
  lightningChain: { colorIndex: number; path: FxBomb[]; hop: number };
  freezeStart: { duration: number };
  freezeEnd: Record<string, never>;
  feverChanged: { meter: number; delta: number };
  feverStart: { duration: number };
  feverEnd: { pops: number; score: number };
  slowMo: { scale: number; realDuration: number; ramp: number };
  armorBroken: { id: number; x: number; z: number; colorIndex: number };
  tickingArmed: { id: number; timer: number };
  tickingWarning: { id: number; remaining: number };
  tickingDefused: { id: number; x: number; z: number; remaining: number };
  tickingExploded: { id: number; x: number; z: number };
  lurch: { distance: number; angle: number };
  rollerTelegraph: { id: number; x: number; z: number; launchIn: number };
  rollerLaunched: { id: number; x: number; z: number; dirX: number; dirZ: number; speed: number; colorIndex: number };
  rollerDestroyed: { id: number; x: number; z: number; matched: boolean };
  rollerExpired: { id: number; x: number; z: number };
  playerHit: { by: "roller"; x: number; z: number; knockX: number; knockZ: number; stun: number };
  perfectDodge: { rollerId: number };
  rollStart: { dirX: number; dirZ: number; duration: number; distance: number };
  rollEnd: Record<string, never>;
  rollReady: Record<string, never>;
  bossSpawned: { mk: number; hp: number; shield: number };
  bossShieldPop: { id: number; x: number; z: number; colorIndex: number; remaining: number };
  bossShieldRegrow: { id: number };
  bossHit: { damage: number; weak: boolean; hp: number; maxHp: number; x: number; z: number };
  bossWeakColor: { colorIndex: number; next: number; in: number };
  bossPhase: { phase: 1 | 2 | 3; previous: 1 | 2 | 3 };
  bossDefeated: { mk: number; score: number; time: number };
  wallPush: { x: number; z: number; bombs: FxBomb[]; distance: number };
  levelStars: {
    level: number; clear: boolean; fast: boolean; flawless: boolean; count: number; time: number; par: number;
    bestCombo: number; newBest: { score: boolean; combo: boolean; time: boolean };
  };
}
