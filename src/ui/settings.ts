// Player settings + presentation flags shared by UI and renderer.
// Tiny external store (useSyncExternalStore) persisted to AsyncStorage.
// reduceMotion = system setting unless the player overrides it in Pause.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

export type FxQuality = "high" | "low";

export interface Settings {
  haptics: boolean;
  colourAssist: boolean; // stronger bomb glyphs
  reduceMotionOverride: boolean | null; // null = follow the system
  systemReduceMotion: boolean;
  quality: FxQuality; // auto-detected, see GameWorld
}

const KEY = "bs.settings";
let state: Settings = {
  haptics: true,
  colourAssist: false,
  reduceMotionOverride: null,
  systemReduceMotion: false,
  quality: "high",
};
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export const getSettings = () => state;

export const reduceMotion = (s: Settings = state) => s.reduceMotionOverride ?? s.systemReduceMotion;

export function updateSettings(patch: Partial<Settings>, persist = true) {
  state = { ...state, ...patch };
  emit();
  if (persist) {
    const { haptics, colourAssist, reduceMotionOverride } = state;
    AsyncStorage.setItem(KEY, JSON.stringify({ haptics, colourAssist, reduceMotionOverride })).catch(() => undefined);
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const useSettings = () => useSyncExternalStore(subscribe, getSettings, getSettings);

let initialised = false;

// Load persisted settings and track the OS reduce-motion flag (web uses
// prefers-reduced-motion through react-native-web).
export function initSettings() {
  if (initialised) return;
  initialised = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Settings>;
      updateSettings(
        {
          haptics: saved.haptics ?? state.haptics,
          colourAssist: saved.colourAssist ?? state.colourAssist,
          reduceMotionOverride: saved.reduceMotionOverride ?? null,
        },
        false
      );
    })
    .catch(() => undefined);
  AccessibilityInfo.isReduceMotionEnabled()
    .then((on) => updateSettings({ systemReduceMotion: on }, false))
    .catch(() => undefined);
  AccessibilityInfo.addEventListener("reduceMotionChanged", (on) =>
    updateSettings({ systemReduceMotion: on }, false)
  );
}
