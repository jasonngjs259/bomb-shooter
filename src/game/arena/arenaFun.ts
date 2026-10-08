// ARENA_FUN: every tunable number of the Arena 360 fun pass (pickups, powers,
// fever, special bombs, rollers, roll, twists, boss, stars). Per-level counts
// live in the LEVELS table (arenaLevels.ts). Units: w (world units), s, deg.
// Override per engine with `new ArenaEngine({ fun: { fever: { duration: 8 } } })`.

import type { PickupKind } from "./funTypes";

export const ARENA_FUN = {
  pickups: {
    // drop chance by pop size n = popped + shattered + armor breaks: [min n, chance], highest match wins
    dropTable: [[5, 0.3], [6, 0.4], [7, 0.6], [9, 1]] as [number, number][],
    comboBonus: 0.15, // + chance when combo >= comboBonusAt
    comboBonusAt: 3,
    pityTime: 25, // s of play without a drop -> next pop with n >= pityMinN drops for sure
    pityMinN: 4,
    teachMinN: 4, // level 1: the first pop with n >= this always drops a Rainbow
    maxGround: 2, // a drop needs ground < maxGround and nothing in flight
    dropCooldown: 6,
    feverChanceScale: 0.5,
    weights: { rainbow: 35, freeze: 25, mega: 20, lightning: 20 } as Record<PickupKind, number>,
    freezeDangerAt: 0.6, // freeze weight x freezeDangerScale while danger >= this
    freezeDangerScale: 2,
    flight: 0.7, // s
    apexY: 2.5,
    groundY: 0.6,
    landRadius: 3.8, // landing distance from the arena centre, +- landJitterR
    landJitterR: 0.6,
    landJitterDeg: 12,
    minPickupDist: 1.2,
    minPlayerDist: 1.0,
    landRetries: 8,
    fallbackRadius: 2.5,
    grabRadius: 0.7, // player centre within this collects
    magnetRadius: 1.6, // within this an unlocked pickup slides to the player
    magnetSpeed: 4,
    ttl: 10, // s on the floor
    blinkAt: 3,
    blockedThrottle: 1, // s between pickupBlocked events
    score: 25,
  },
  powers: {
    megaRadius: 2.2,
    megaKnockScale: 1.5,
    megaScorePerBomb: 10,
    megaCoreDamage: 3,
    lightningLink: 3.0,
    lightningMax: 18,
    lightningHop: 0.04, // s per hop (FX timing only)
    lightningCoreReach: 3.0,
    lightningCoreDamage: 2,
    rainbowCoreDamage: 2,
    freezeDuration: 5,
    freezeStack: 5,
    freezeCap: 8,
  },
  fever: {
    max: 100,
    fillBase: 5, // fill = base + perPopped*(popped-3) + perShatter*shattered + perCombo*min(combo-1, comboCap)
    perPopped: 2,
    perShatter: 2,
    perCombo: 3,
    comboCap: 4,
    decayDelay: 5,
    decayRate: 3, // per s
    missPenalty: 8,
    rollerHitPenalty: 30,
    lockout: 4,
    duration: 6,
    fireCooldown: 0.18,
    maxShots: 4,
    shotSpeed: 24,
    scoreMult: 2,
    slowMoScale: 0.3,
    slowMoHold: 0.35, // real s
    slowMoRamp: 0.2, // real s back to 1
    shieldPopFill: 4,
    rollerShotFill: 5,
    perfectDodgeFill: 8,
    introAt: 40, // featureIntro "fever" when the meter first reaches this
    changeStep: 5, // feverChanged on decay every this many points
  },
  armored: { score: 25 },
  ticking: {
    armGap: 5.0, // border gap at which a ticking bomb may arm
    firstArm: 8, // s after GO
    armEvery: 15,
    maxArmed: 2,
    warnAt: 5, // tickingWarning each whole second <= this
    score: 100,
    lurchMax: 0.8,
    lurchKeep: 0.6, // lurch = min(lurchMax, max(0, minGap - lurchKeep))
    lurchTime: 0.4,
    innerFace: 1.2, // ticking/roller centres within annulus inner + this
    minSepDeg: 60, // between ticking/roller bombs
  },
  roller: {
    launchGap: 3.0,
    clockMin: 12,
    clockMax: 22,
    clockSep: 8,
    telegraph: 1.0,
    speed: 2.6,
    homingDeg: 35, // deg/s while farther than lockDist
    lockDist: 2.5,
    expireR: 6.6, // leaves the arena on the far side
    maxAge: 8,
    contact: 0.85,
    knock: 1.2,
    knockOmega: 14,
    stun: 0.6,
    stunTurnScale: 0.5,
    immunity: 1.0,
    score: 50,
    dodgeDist: 0.9,
    dodgeScore: 50,
    dodgeSlowScale: 0.5,
    dodgeSlowHold: 0.15,
    dodgeSlowRamp: 0.1,
  },
  roll: {
    distance: 3.0,
    duration: 0.5,
    iStart: 0.04,
    iEnd: 0.42,
    cooldown: 1.6,
    buffer: 0.2,
    minInput: 0.3,
    exitSpeed: 3,
  },
  rotation: { easeIn: 2 },
  doubleRing: { innerMin: 10.0, innerMax: 11.6, innerShare: 0.25, gaps: 4, gapDeg: 22, outerStart: 14.0 },
  boss: {
    coreR: 1.35,
    coreDist: 11.5,
    gapDeg: 35, // ring gap half-angle around the core
    creep: 0.018,
    p3CreepScale: 3,
    p3RingCreepScale: 1.25,
    shieldR: 2.3,
    growTime: 0.5,
    weakCycle: 6,
    weakTelegraph: 1,
    damage: 1,
    weakDamage: 2,
    p2At: 0.6,
    p3At: 0.25,
    p2OrbitScale: 1.35,
    shiftInvuln: 1.2,
    shiftKick: 1.5, // outward kick speed (decays at knockbackDamping) ~ 0.5 w
    spitEvery: 12,
    spitCount: 3,
    rollerEvery: 9,
    shieldScore: 30,
    hitScore: 50,
    weakScore: 100,
    killScorePerMk: 1500,
    chainPerSector: 0.03,
    sectorDeg: 22.5,
    chainScore: 10,
    hitStopScale: 0.05,
    hitStop: 0.2,
  },
  stars: { flawlessDanger: 0.9, clearBonusPerSec: 20 },
};

export type ArenaFunConfig = typeof ARENA_FUN;
export type ArenaFunOverrides = { [K in keyof ArenaFunConfig]?: Partial<ArenaFunConfig[K]> };

export function mergeFun(over: ArenaFunOverrides = {}): ArenaFunConfig {
  const out = { ...ARENA_FUN };
  for (const key of Object.keys(over) as (keyof ArenaFunConfig)[]) {
    Object.assign(out, { [key]: { ...ARENA_FUN[key], ...over[key] } });
  }
  return out;
}
