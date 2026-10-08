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
  mouseSensitivity: number; // Arena mouse-look, rad per px (0.001..0.006)
  aimAssist: boolean; // Arena touch: soft nudge onto a bomb after a turn drag
  music: boolean; // music on/off
  sfx: boolean; // sound effects on/off
  volume: number; // master volume 0..1
}

export const SENSITIVITY_MIN = 0.001;
export const SENSITIVITY_MAX = 0.006;

const KEY = "bs.settings";
let state: Settings = {
  haptics: true,
  colourAssist: false,
  reduceMotionOverride: null,
  systemReduceMotion: false,
  quality: "high",
  mouseSensitivity: 0.0022,
  aimAssist: true,
  music: true,
  sfx: true,
  volume: 0.8,
};
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export const getSettings = () => state;

export const reduceMotion = (s: Settings = state) => s.reduceMotionOverride ?? s.systemReduceMotion;

export function updateSettings(patch: Partial<Settings>, persist = true) {
  state = { ...state, ...patch };
  emit();
  if (persist) {
    const { haptics, colourAssist, reduceMotionOverride, mouseSensitivity, aimAssist, music, sfx, volume } = state;
    AsyncStorage.setItem(
      KEY,
      JSON.stringify({ haptics, colourAssist, reduceMotionOverride, mouseSensitivity, aimAssist, music, sfx, volume })
    ).catch(
      () => undefined
    );
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const useSettings = () => useSyncExternalStore(subscribe, getSettings, getSettings);

// Non-React listener (audio follows the music / sfx / volume settings).
export const onSettingsChange = subscribe;

let initialised = false;
let loaded = false;
// True once the persisted settings were read (or found missing).
export const settingsLoaded = () => loaded;

// Load persisted settings and track the OS reduce-motion flag (web uses
// prefers-reduced-motion through react-native-web).
export function initSettings() {
  if (initialised) return;
  initialised = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      loaded = true;
      if (!raw) {
        emit();
        return;
      }
      const saved = JSON.parse(raw) as Partial<Settings>;
      updateSettings(
        {
          haptics: saved.haptics ?? state.haptics,
          colourAssist: saved.colourAssist ?? state.colourAssist,
          reduceMotionOverride: saved.reduceMotionOverride ?? null,
          mouseSensitivity: Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, saved.mouseSensitivity ?? state.mouseSensitivity)),
          aimAssist: saved.aimAssist ?? state.aimAssist,
          music: saved.music ?? state.music,
          sfx: saved.sfx ?? state.sfx,
          volume: Math.min(1, Math.max(0, saved.volume ?? state.volume)),
        },
        false
      );
    })
    .catch(() => {
      loaded = true;
      emit();
    });
  AccessibilityInfo.isReduceMotionEnabled()
    .then((on) => updateSettings({ systemReduceMotion: on }, false))
    .catch(() => undefined);
  AccessibilityInfo.addEventListener("reduceMotionChanged", (on) =>
    updateSettings({ systemReduceMotion: on }, false)
  );
}
