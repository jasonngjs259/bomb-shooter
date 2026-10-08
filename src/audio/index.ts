// The app's audio singleton and its React-free glue:
//   initAudio()            once at app start (players are created here, once)
//   audio.play(id)         one-shot SFX (see sounds.ts for ids)
//   audio.music.*          scene / fever / boss / danger / duck (MusicDirector)
//   bindClassicAudio / bindArenaAudio / bindFunEvents: engine event maps
//   uiSound(kind)          button clicks / hovers
// Music, SFX and master volume follow the settings store (bs.settings:
// music, sfx, volume); nothing sounds until the saved settings are loaded.
// Dev (web): window.__audio exposes the manager for QA (stats, play counts).

import { Platform } from "react-native";
import { getSettings, onSettingsChange, settingsLoaded } from "../ui/settings";
import { AudioManager } from "./AudioManager";
import { createBackend } from "./backend";

export const audio = new AudioManager(createBackend());

let started = false;
let detach: (() => void) | null = null;

function applySettings() {
  if (!settingsLoaded()) return;
  const s = getSettings();
  audio.setVolumes({ master: s.volume });
  audio.setMusicEnabled(s.music);
  audio.setSfxEnabled(s.sfx);
}

export function initAudio() {
  if (started) return;
  started = true;
  // silent until the persisted toggles are known
  audio.setMusicEnabled(false);
  audio.setSfxEnabled(false);
  try {
    audio.init();
  } catch (e) {
    if (__DEV__) console.warn("audio init failed", e);
    return;
  }
  applySettings();
  detach = onSettingsChange(applySettings);
  if (__DEV__ && Platform.OS === "web" && typeof window !== "undefined") {
    (window as unknown as { __audio?: AudioManager }).__audio = audio;
  }
}

export function disposeAudio() {
  detach?.();
  detach = null;
  audio.dispose();
  started = false;
}

export type UiSound = "click" | "back" | "hover";

export function uiSound(kind: UiSound = "click") {
  audio.play(kind);
}

export { bindArenaAudio, bindClassicAudio, newArenaAudioState } from "./sfxMap";
export { bindFunEvents } from "./funEvents";
