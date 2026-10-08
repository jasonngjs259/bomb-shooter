// Arena 360 progress model (fun-pass spec section 3), pure and framework-free:
//   { levels: {[n]: {stars, bestTime, bestScore, bestCombo}}, maxLevel,
//     totalStars, unlocked, equipped: {trim, cannon, plates}, introsSeen }
// stored as JSON under bs.arena.progress (progressStore.ts). `stars` is a
// bitmask: 1 = CLEAR, 2 = FAST, 4 = FLAWLESS; the best of each badge is kept,
// so stars only go up. Reducers return a new object (never mutate).

import type { ArenaEvents } from "../game/arena/types";
import {
  bossMkOfLevel, DEFAULT_EQUIPPED, Equipped, skinItem, unlockedIds,
} from "../game/arena/skins";

export const PROGRESS_KEY = "bs.arena.progress";

export const STAR_CLEAR = 1;
export const STAR_FAST = 2;
export const STAR_FLAWLESS = 4;

export interface LevelRecord {
  stars: number; // bitmask CLEAR | FAST | FLAWLESS
  bestTime: number | null; // s, fastest win
  bestScore: number; // run score at the win (what levelStars.newBest.score compares)
  bestCombo: number;
}

export interface ArenaProgress {
  levels: Record<string, LevelRecord>;
  maxLevel: number; // highest level reached (LEVELS tab shows 1..maxLevel)
  totalStars: number;
  unlocked: string[]; // skin item ids (defaults are implicit)
  equipped: Equipped;
  introsSeen: string[]; // FeatureId + UI tip ids ("feverStart", "bossWeak", "rollKeys")
}

export type LevelStarsEvent = ArenaEvents["levelStars"];

export interface LevelResult {
  progress: ArenaProgress;
  newlyUnlocked: string[]; // skin ids earned by this result (table order)
  newBest: { score: boolean; combo: boolean; time: boolean }; // vs. the stored record
  starsGained: number;
  bossBeaten: number; // Mk beaten for the first time by this win (0 = none)
}

export const emptyProgress = (): ArenaProgress => ({
  levels: {},
  maxLevel: 1,
  totalStars: 0,
  unlocked: [],
  equipped: { ...DEFAULT_EQUIPPED },
  introsSeen: [],
});

export const starBits = (s: { clear: boolean; fast: boolean; flawless: boolean }) =>
  (s.clear ? STAR_CLEAR : 0) | (s.fast ? STAR_FAST : 0) | (s.flawless ? STAR_FLAWLESS : 0);

export const starCount = (bits: number) => (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1);

export const totalStarsOf = (levels: Record<string, LevelRecord>) =>
  Object.values(levels).reduce((n, r) => n + starCount(r.stars), 0);

// Boss Mks with at least one win (a boss win always earns CLEAR).
export const bossesBeaten = (levels: Record<string, LevelRecord>): number[] =>
  Object.keys(levels)
    .map(Number)
    .filter((n) => (levels[n]?.stars ?? 0) & STAR_CLEAR)
    .map(bossMkOfLevel)
    .filter((mk) => mk > 0)
    .sort((a, b) => a - b);

// The engine's `best` option for newGame() so levelStars.newBest is right.
export function levelBest(p: ArenaProgress, level: number): { score?: number; combo?: number; time?: number } {
  const r = p.levels[level];
  if (!r) return {};
  return { score: r.bestScore, combo: r.bestCombo, time: r.bestTime ?? undefined };
}

// Fold a won level (levelStars + the run score at the win) into the progress.
export function applyLevelStars(p: ArenaProgress, ev: LevelStarsEvent, score: number): LevelResult {
  const key = String(ev.level);
  const prev = p.levels[key];
  const bits = starBits(ev);
  const rec: LevelRecord = prev
    ? {
        stars: prev.stars | bits,
        bestTime: prev.bestTime === null ? ev.time : Math.min(prev.bestTime, ev.time),
        bestScore: Math.max(prev.bestScore, score),
        bestCombo: Math.max(prev.bestCombo, ev.bestCombo),
      }
    : { stars: bits, bestTime: ev.time, bestScore: score, bestCombo: ev.bestCombo };
  const newBest = {
    score: !prev || score > prev.bestScore,
    combo: !prev || ev.bestCombo > prev.bestCombo,
    time: !prev || prev.bestTime === null || ev.time < prev.bestTime,
  };
  const levels = { ...p.levels, [key]: rec };
  const totalStars = totalStarsOf(levels);
  const beatenBefore = bossesBeaten(p.levels);
  const beaten = bossesBeaten(levels);
  const earned = unlockedIds(totalStars, beaten);
  const newlyUnlocked = earned.filter((id) => !p.unlocked.includes(id));
  const mk = bossMkOfLevel(ev.level);
  return {
    progress: {
      ...p,
      levels,
      totalStars,
      maxLevel: Math.max(p.maxLevel, ev.level + 1),
      unlocked: [...p.unlocked, ...newlyUnlocked],
    },
    newlyUnlocked,
    newBest,
    starsGained: totalStars - p.totalStars,
    bossBeaten: mk > 0 && !beatenBefore.includes(mk) ? mk : 0,
  };
}

// Reaching a level (e.g. a loss on a new level still counts as reached).
export function reachLevel(p: ArenaProgress, level: number): ArenaProgress {
  return level > p.maxLevel ? { ...p, maxLevel: level } : p;
}

export const isOwned = (p: ArenaProgress, id: string) => {
  const it = skinItem(id);
  return !!it && (!it.req || p.unlocked.includes(id));
};

// Equip an owned item into its slot (no-op for unknown / locked ids).
export function equip(p: ArenaProgress, id: string): ArenaProgress {
  const it = skinItem(id);
  if (!it || !isOwned(p, id) || p.equipped[it.slot] === id) return p;
  return { ...p, equipped: { ...p.equipped, [it.slot]: id } };
}

export function markIntroSeen(p: ArenaProgress, id: string): ArenaProgress {
  return p.introsSeen.includes(id) ? p : { ...p, introsSeen: [...p.introsSeen, id] };
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

// Parse stored JSON defensively: bad fields fall back, totals and unlocks are
// recomputed from the level records (stored unlocks are kept: never relock).
export function parseProgress(raw: string | null): ArenaProgress {
  const base = emptyProgress();
  if (!raw) return base;
  let o: Partial<ArenaProgress>;
  try {
    o = JSON.parse(raw) as Partial<ArenaProgress>;
  } catch {
    return base;
  }
  if (!o || typeof o !== "object") return base;
  const levels: Record<string, LevelRecord> = {};
  for (const [k, r] of Object.entries(o.levels ?? {})) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || !r || typeof r !== "object") continue;
    levels[String(n)] = {
      stars: num(r.stars, 0) & 7,
      bestTime: typeof r.bestTime === "number" && Number.isFinite(r.bestTime) ? r.bestTime : null,
      bestScore: Math.max(0, num(r.bestScore, 0)),
      bestCombo: Math.max(0, num(r.bestCombo, 0)),
    };
  }
  const totalStars = totalStarsOf(levels);
  const stored = Array.isArray(o.unlocked) ? o.unlocked.filter((id): id is string => typeof id === "string" && !!skinItem(id)) : [];
  const earned = unlockedIds(totalStars, bossesBeaten(levels));
  const unlocked = [...stored, ...earned.filter((id) => !stored.includes(id))];
  const p: ArenaProgress = {
    levels,
    maxLevel: Math.max(1, Math.floor(num(o.maxLevel, 1)), ...Object.keys(levels).map((k) => Number(k) + ((levels[k].stars & STAR_CLEAR) ? 1 : 0))),
    totalStars,
    unlocked,
    equipped: { ...DEFAULT_EQUIPPED },
    introsSeen: Array.isArray(o.introsSeen) ? o.introsSeen.filter((x): x is string => typeof x === "string") : [],
  };
  const eq = o.equipped as Partial<Equipped> | undefined;
  for (const slot of ["trim", "cannon", "plates"] as const) {
    const id = eq?.[slot];
    const it = typeof id === "string" ? skinItem(id) : undefined;
    if (it && it.slot === slot && (!it.req || unlocked.includes(it.id))) p.equipped[slot] = it.id;
  }
  return p;
}
