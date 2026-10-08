// Arena progress store: the pure model (arenaProgress.ts) behind a tiny
// external store (useSyncExternalStore), persisted to AsyncStorage under
// bs.arena.progress. initProgress() loads once at app start; every change
// is written through (failures are swallowed: the game never depends on it).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { ArenaProgress, emptyProgress, parseProgress, PROGRESS_KEY, totalStarsOf } from "./arenaProgress";

let state: ArenaProgress = emptyProgress();
let loaded = false;
let loading: Promise<ArenaProgress> | null = null;
let dirty = false; // changed before the stored copy was read: written once merged
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getProgress = () => state;
export const progressLoaded = () => loaded;

export function setProgress(next: ArenaProgress, persist = true) {
  if (next === state) return;
  state = next;
  emit();
  if (!persist) return;
  if (loaded) write();
  else dirty = true;
}

const write = () => AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(state)).catch(() => undefined);

// Apply a reducer to the current progress and persist the result.
export function updateProgress(fn: (p: ArenaProgress) => ArenaProgress) {
  setProgress(fn(state));
}

export function initProgress(): Promise<ArenaProgress> {
  if (loading) return loading;
  loading = AsyncStorage.getItem(PROGRESS_KEY)
    .then((raw) => {
      // anything changed before the load finished wins over the stored copy
      if (!loaded) state = mergeLoaded(parseProgress(raw), state);
      loaded = true;
      if (dirty) void write();
      dirty = false;
      emit();
      return state;
    })
    .catch(() => {
      loaded = true;
      emit();
      return state;
    });
  return loading;
}

// Stored progress + in-memory changes made before the load completed.
function mergeLoaded(stored: ArenaProgress, mem: ArenaProgress): ArenaProgress {
  if (mem === stored || (Object.keys(mem.levels).length === 0 && mem.introsSeen.length === 0)) return stored;
  const levels = { ...stored.levels };
  for (const [k, r] of Object.entries(mem.levels)) {
    const s = levels[k];
    levels[k] = s
      ? {
          stars: s.stars | r.stars,
          bestTime: s.bestTime === null ? r.bestTime : r.bestTime === null ? s.bestTime : Math.min(s.bestTime, r.bestTime),
          bestScore: Math.max(s.bestScore, r.bestScore),
          bestCombo: Math.max(s.bestCombo, r.bestCombo),
        }
      : r;
  }
  return {
    ...stored,
    levels,
    maxLevel: Math.max(stored.maxLevel, mem.maxLevel),
    totalStars: totalStarsOf(levels),
    unlocked: [...stored.unlocked, ...mem.unlocked.filter((id) => !stored.unlocked.includes(id))],
    introsSeen: [...stored.introsSeen, ...mem.introsSeen.filter((id) => !stored.introsSeen.includes(id))],
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const useProgress = () => useSyncExternalStore(subscribe, getProgress, getProgress);
export const onProgressChange = subscribe;

// Tests only: reset the module state.
export function __resetProgressForTests() {
  state = emptyProgress();
  loaded = false;
  loading = null;
  dirty = false;
}
