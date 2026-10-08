// Player settings (haptics, reduce motion, colour assist) plus the system
// reduce-motion flag, in one tiny observable store. Persisted with
// AsyncStorage (localStorage on web). Read synchronously by the renderer and
// haptics every frame/event; React components use useSettings().

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

export type ReduceMotionMode = "system" | "on" | "off";

export interface Settings {
  haptics: boolean;
  reduceMotion: ReduceMotionMode;
  colourAssist: boolean; // stronger colour-blind glyphs on the bombs
}

const KEY = "bs.settings";
const TUTORIAL_KEY = "bs.tutorialSeen";
const DEFAULTS: Settings = { haptics: true, reduceMotion: "system", colourAssist: false };

interface Snapshot {
  settings: Settings;
  reducedMotion: boolean; // effective value (setting + system)
}

let systemReduceMotion = false;
let current: Snapshot = { settings: DEFAULTS, reducedMotion: false };
const listeners = new Set<() => void>();
let initialised = false;

const effective = (s: Settings) => (s.reduceMotion === "system" ? systemReduceMotion : s.reduceMotion === "on");

const publish = (s: Settings) => {
  current = { settings: s, reducedMotion: effective(s) };
  listeners.forEach((cb) => cb());
};

const parse = (raw: string | null): Partial<Settings> => {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return {};
    const o = v as Record<string, unknown>;
    const out: Partial<Settings> = {};
    if (typeof o.haptics === "boolean") out.haptics = o.haptics;
    if (o.reduceMotion === "system" || o.reduceMotion === "on" || o.reduceMotion === "off") out.reduceMotion = o.reduceMotion;
    if (typeof o.colourAssist === "boolean") out.colourAssist = o.colourAssist;
    return out;
  } catch {
    return {};
  }
};

export const settingsStore = {
  get: (): Settings => current.settings,
  reducedMotion: (): boolean => current.reducedMotion,
  snapshot: (): Snapshot => current,
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  update(patch: Partial<Settings>) {
    const next = { ...current.settings, ...patch };
    publish(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  },
  // Load persisted settings and start following the OS reduce-motion flag
  // (AccessibilityInfo works on web too, via prefers-reduced-motion).
  init() {
    if (initialised) return;
    initialised = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        systemReduceMotion = on;
        publish(current.settings);
      })
      .catch(() => undefined);
    AccessibilityInfo.addEventListener("reduceMotionChanged", (on: boolean) => {
      systemReduceMotion = on;
      publish(current.settings);
    });
    AsyncStorage.getItem(KEY)
      .then((raw) => publish({ ...DEFAULTS, ...current.settings, ...parse(raw) }))
      .catch(() => undefined);
  },
};

export function useSettings() {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.snapshot);
}

// First-run tutorial flag
export async function loadTutorialSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(TUTORIAL_KEY)) === "1";
  } catch {
    return false;
  }
}

export function saveTutorialSeen() {
  AsyncStorage.setItem(TUTORIAL_KEY, "1").catch(() => undefined);
}
