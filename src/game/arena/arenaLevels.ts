// Arena 360 per-level definitions: the LEVELS table (L1-L9), the L10+
// generator (twist deck + boss every 3rd level) and the field geometry each
// LevelDef implies. One new idea per level. Numbers are the fun-pass spec's,
// tuned with scripts/arena-balance.ts (spec value in [brackets] where changed):
//
//  Lv  field                 new                                   also                                           rotation   par
//  1   60  / 0.0298          pickups: rainbow, freeze              -                                              -           60
//  2   75  / 0.0322          armored x5, FEVER                     pickups                                        -           75
//  3   BOSS Mk I ring 48     boss, mega pickup                     armored x4                                     -           90
//  4   90  / 0.035           ticking x2 (20 s), rotation, lightning armored 6                                     +4 deg/s    95
//  5   102 / 0.038           rollers x3 (1 live), ROLL             armored 6, ticking 2                           -          100
//  6   BOSS Mk II ring 60    boss rollers in phase 2               armored 4 [6], ticking 1 [2] 24 s [20], creep 0.032 [0.038]  -3  110
//  7   114 / 0.041           double ring                           armored 6 [8], ticking 3 (18 s), rollers 3     static     115
//  8   126 / 0.040 [0.044]   counter-rotating double ring          armored 5 [10], ticking 3, rollers 4 (2 live)  +5/-3      120
//  9   BOSS Mk III ring 72   creep 0.034 [0.044]                   armored 4 [8], ticking 1 [2] (18 s)            +4         125
//  10+ k = L-10: bombs min(150, 138+12k); armored min(10, 6+floor(k/3)) [min(16, 10+k)];
//      L%3==1 rotating 5 deg/s, creep min(0.050, 0.047+0.001k) [min(0.060, 0.047+0.003k)];
//      L%3==2 double ring +5/-3, creep min(0.044, 0.038+0.001k) [same as rotating];
//      L%3==0 BOSS Mk L/3: creep 0.032+0.001(n-4) [previous level's], armored = previous x0.6 [x0.7],
//      ticking 1 [previous x0.7], previous level's rotation.
//  Boss Mk n (bossDef): HP 12 + 2 max(0, n-2) = 12/12/14/16 [10+4(n-1) = 10/14/18/22]; shield min(12, 6+2n) [cap 14];
//      orbit min(64, 24+12n) deg/s [cap 80]; regrow Mk I 5 s, Mk II-III 8 s, IV+ 9 s [max(3.5, 8-n)].
// Rotation sign: + = angle increasing from +x towards +z (clockwise seen from above with +z down).

import type { ArenaConfig } from "./types";
import type { BossDef, FeatureId, LevelDef, PickupKind } from "./funTypes";
import type { ArenaFunConfig } from "./arenaFun";

// Table creep / bombs are authored against these ARENA_CONFIG defaults and
// scaled by config.creepSpeed / config.bombCount, so test configs still shrink fields.
const REF_CREEP = 0.035;
const REF_BOMBS = 90;

interface LevelRow {
  bombs: number; // boss levels: ring bombs
  creep: number; // w/s at the reference config
  armored: number;
  ticking: number;
  tickTimer: number;
  rollers: number;
  rollersLive: number;
  rotation: [number, number];
  doubleRing: boolean;
  boss: number; // Mk, 0 = none
  par: number;
}

const row = (r: Partial<LevelRow> & Pick<LevelRow, "bombs" | "creep" | "par">): LevelRow => ({
  armored: 0, ticking: 0, tickTimer: 20, rollers: 0, rollersLive: 1, rotation: [0, 0], doubleRing: false, boss: 0, ...r,
});

export const LEVELS: readonly LevelRow[] = [
  row({ bombs: 60, creep: 0.035 * 0.85, par: 60 }),
  row({ bombs: 75, creep: 0.035 * 0.92, armored: 5, par: 75 }),
  row({ bombs: 48, creep: 0.0322, armored: 4, boss: 1, par: 90 }),
  row({ bombs: 90, creep: 0.035, armored: 6, ticking: 2, rotation: [4, 4], par: 95 }),
  row({ bombs: 102, creep: 0.038, armored: 6, ticking: 2, rollers: 3, par: 100 }),
  row({ bombs: 60, creep: 0.032, armored: 4, ticking: 1, tickTimer: 24, rotation: [-3, -3], boss: 2, par: 110 }),
  row({ bombs: 114, creep: 0.041, armored: 6, ticking: 3, tickTimer: 18, rollers: 3, doubleRing: true, par: 115 }),
  row({ bombs: 126, creep: 0.04, armored: 5, ticking: 3, tickTimer: 18, rollers: 4, rollersLive: 2, rotation: [5, -3], doubleRing: true, par: 120 }),
  row({ bombs: 72, creep: 0.034, armored: 4, ticking: 1, tickTimer: 18, rollersLive: 2, rotation: [4, 4], boss: 3, par: 125 }),
];

function generatedRow(level: number): LevelRow {
  if (level % 3 === 0) {
    const n = level / 3;
    const prev = generatedRow(level - 1);
    return row({
      bombs: Math.min(100, 36 + 12 * n), creep: 0.032 + 0.001 * (n - 4), par: Math.min(150, 90 + 10 * (n - 1)), boss: n,
      armored: Math.round(prev.armored * 0.6), ticking: 1, tickTimer: 16, rollersLive: 2, rotation: [prev.rotation[0], prev.rotation[0]],
    });
  }
  const k = level - 10;
  const rotating = level % 3 === 1;
  const deck = rotating ? { rotation: [5, 5] as [number, number] } : { rotation: [5, -3] as [number, number], doubleRing: true };
  return row({
    bombs: Math.min(150, 138 + 12 * k), creep: rotating ? Math.min(0.05, 0.047 + 0.001 * k) : Math.min(0.044, 0.038 + 0.001 * k),
    par: Math.min(150, 130 + 5 * k), armored: Math.min(10, 6 + Math.floor(k / 3)), ticking: Math.min(5, 4 + Math.floor(k / 2)), tickTimer: 16,
    rollers: Math.min(6, 4 + Math.floor(k / 2)), rollersLive: 2, ...deck,
  });
}

export function bossDef(mk: number): BossDef {
  return {
    mk,
    coreHp: 12 + 2 * Math.max(0, mk - 2),
    shield: Math.min(12, 6 + 2 * mk),
    orbit: Math.min(64, 24 + 12 * mk),
    regrow: mk === 1 ? 5 : mk <= 3 ? 8 : 9,
    ring: Math.min(100, 36 + 12 * mk),
  };
}

// Pickup kinds unlocked by level.
const pickupKinds = (level: number): PickupKind[] =>
  level >= 4 ? ["rainbow", "freeze", "mega", "lightning"] : level >= 3 ? ["rainbow", "freeze", "mega"] : ["rainbow", "freeze"];

function features(d: Omit<LevelDef, "features" | "introduces">): FeatureId[] {
  const f: FeatureId[] = ["pickups", ...d.pickups];
  if (d.armored > 0) f.push("armored");
  if (d.fever) f.push("fever");
  if (d.boss) f.push("boss");
  if (d.ticking > 0) f.push("ticking");
  if (d.rotation[0] !== 0 || d.rotation[1] !== 0) f.push("rotation");
  if (d.rollers > 0 || (d.boss && d.boss.mk >= 2)) f.push("roller");
  if (d.roll) f.push("roll");
  if (d.doubleRing) f.push("doubleRing");
  return f;
}

function baseDef(c: ArenaConfig, level: number): Omit<LevelDef, "features" | "introduces"> {
  const lv = Math.max(1, Math.floor(level));
  const r = lv <= LEVELS.length ? LEVELS[lv - 1] : generatedRow(lv);
  const early = c.earlyLevels[lv - 1];
  const boss = r.boss > 0 ? bossDef(r.boss) : null;
  const scaled = Math.round((r.bombs * c.bombCount) / REF_BOMBS);
  const bombs = Math.max(1, Math.min(c.maxBombs, early && !boss ? early.bombs : scaled));
  const creepBase = early && !boss ? c.creepSpeed * early.creepScale : (r.creep * c.creepSpeed) / REF_CREEP;
  if (boss) boss.ring = bombs;
  return {
    level: lv, bombs, creepBase, armored: r.armored, ticking: r.ticking, tickTimer: r.tickTimer,
    rollers: r.rollers, rollersLive: r.rollersLive, rotation: [r.rotation[0], r.rotation[1]], doubleRing: r.doubleRing,
    boss, pickups: pickupKinds(lv), fever: lv >= 2, roll: lv >= 5, par: r.par,
  };
}

// The LevelDef for `level` (1-based) under `config`.
export function levelDef(c: ArenaConfig, level: number): LevelDef {
  const d = baseDef(c, level);
  const f = features(d);
  const before = d.level > 1 ? features(baseDef(c, d.level - 1)) : [];
  return { ...d, features: f, introduces: f.filter((x) => !before.includes(x)) };
}

// ---- Field geometry ---------------------------------------------------------------

// One annulus of bomb centres; `gaps` are angular holes (centre angle, half-width, rad).
export interface BandSpec {
  band: 0 | 1;
  count: number;
  inner: number;
  outer: number;
  gaps: { angle: number; half: number }[];
}

// Bands for a level. Rng is only used for gap offsets / the boss angle, and
// only when the level has them (so plain levels generate exactly as before).
export function fieldBands(c: ArenaConfig, fun: ArenaFunConfig, d: LevelDef, rand: () => number, bossAngle: number | null): BandSpec[] {
  const baseArea = c.ringOuter ** 2 - c.ringInner ** 2; // r^2-area holding bombCount bombs
  const outerFor = (inner: number, count: number, angleShare: number) =>
    Math.sqrt(inner ** 2 + (baseArea * count) / c.bombCount / angleShare);
  if (d.boss && bossAngle !== null) {
    const half = (fun.boss.gapDeg * Math.PI) / 180;
    const share = 1 - (2 * half) / (Math.PI * 2);
    return [{ band: 0, count: d.bombs, inner: c.ringInner, outer: outerFor(c.ringInner, d.bombs, share), gaps: [{ angle: bossAngle, half }] }];
  }
  if (d.doubleRing) {
    const dr = fun.doubleRing;
    const innerCount = Math.round(d.bombs * dr.innerShare);
    const offset = rand() * Math.PI * 2;
    const half = (dr.gapDeg * Math.PI) / 360;
    const gaps = Array.from({ length: dr.gaps }, (_, i) => ({ angle: offset + (i / dr.gaps) * Math.PI * 2, half }));
    return [
      { band: 0, count: innerCount, inner: dr.innerMin, outer: dr.innerMax, gaps },
      { band: 1, count: d.bombs - innerCount, inner: dr.outerStart, outer: outerFor(dr.outerStart, d.bombs - innerCount, 1), gaps: [] },
    ];
  }
  return [{ band: 0, count: d.bombs, inner: c.ringInner, outer: outerFor(c.ringInner, d.bombs, 1), gaps: [] }];
}
