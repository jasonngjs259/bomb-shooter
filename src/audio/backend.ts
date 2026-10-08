// Native (iOS / Android) expo-audio backend.
//  - Audio mode: iOS ambient (playsInSilentMode false: the silent switch mutes
//    the game) mixing with the player's own music, no background audio.
//  - Players: created once, keepAudioSessionActive so a finished SFX does not
//    deactivate the session under the music; status updates at 1 Hz (unused).
//  - Background: setIsAudioActiveAsync(false); foreground: true.
// Web uses backend.web.ts.

import { createAudioPlayer, preload, setAudioModeAsync, setIsAudioActiveAsync } from "expo-audio";
import { AppState } from "react-native";
import { AUDIO_FILES, AudioFileId } from "./assets";
import { AudioBackend, noop, PlayerLike } from "./types";

const now = () => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());

export function createBackend(): AudioBackend {
  return {
    voiceCap: 12,
    volumeControl: true,
    maskLoops: false,
    needsUnlock: false,
    now,
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (h) => cancelAnimationFrame(h),
    configure() {
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers", shouldPlayInBackground: false }).catch(noop);
    },
    createPlayer(file) {
      const src = AUDIO_FILES[file as AudioFileId];
      try {
        preload(src).catch(noop);
      } catch {
        // preload is an optimisation only
      }
      return createAudioPlayer(src, { keepAudioSessionActive: true, updateInterval: 1000 }) as unknown as PlayerLike;
    },
    setActive(active) {
      setIsAudioActiveAsync(active).catch(noop);
    },
    listenAppState(cb) {
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "background") cb(false);
        else if (s === "active") cb(true);
      });
      return () => sub.remove();
    },
  };
}
