// Web expo-audio backend (HTMLAudioElement per player).
//  - Autoplay: nothing plays before the first tap / click / key press
//    (needsUnlock). The manager's unlock() runs inside that gesture and warms
//    every player (muted play + pause), which also unlocks iOS Safari.
//  - expo-audio's web play() does not catch the play() promise (SDK 57), so a
//    blocked or interrupted play (play then pause) would surface as an
//    unhandled rejection. Each player's media element gets its play wrapped
//    once with a catch (instance property, no prototype patching).
//  - MP3 <audio loop> is not gapless: loops are masked with two crossfading
//    players (maskLoops).
//  - iOS browsers ignore script volume: no volume writes there (the manager
//    plays at full or not at all and switches music instead of fading).
//  - Tab hidden = suspend, visible = resume.

import { createAudioPlayer, setIsAudioActiveAsync } from "expo-audio";
import { AUDIO_FILES, AudioFileId } from "./assets";
import { AudioBackend, noop, PlayerLike } from "./types";

const isIOSWeb = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

type MediaHost = { media?: HTMLAudioElement };

function guardMedia(p: PlayerLike) {
  const media = (p as unknown as MediaHost).media;
  if (!media || typeof media.play !== "function") return;
  const play = media.play.bind(media);
  media.play = () => {
    const r = play();
    if (r && typeof r.catch === "function") r.catch(noop);
    return r;
  };
  media.preload = "auto";
}

// Events that count as user activation for autoplay (a touch pointerdown
// does not; its pointerup / touchend does).
const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

export function createBackend(): AudioBackend {
  const hasWindow = typeof window !== "undefined";
  return {
    voiceCap: 16,
    volumeControl: !isIOSWeb(),
    maskLoops: true,
    needsUnlock: true,
    now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    requestFrame: (cb) => (hasWindow ? window.requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number)),
    cancelFrame: (h) => (hasWindow ? window.cancelAnimationFrame(h) : clearTimeout(h)),
    createPlayer(file) {
      const p = createAudioPlayer(AUDIO_FILES[file as AudioFileId], { updateInterval: 1000 }) as unknown as PlayerLike;
      guardMedia(p);
      return p;
    },
    setActive(active) {
      setIsAudioActiveAsync(active).catch(noop);
    },
    warmUp(p) {
      p.muted = true;
      p.play();
      p.pause();
      p.muted = false;
    },
    listenFirstGesture(cb) {
      if (!hasWindow) return noop;
      const remove = () => GESTURES.forEach((t) => window.removeEventListener(t, onGesture, true));
      const onGesture = (e: Event) => {
        if (e.type === "pointerdown" && (e as PointerEvent).pointerType !== "mouse") return;
        const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
        if (ua && !ua.isActive) return;
        remove();
        cb();
      };
      GESTURES.forEach((t) => window.addEventListener(t, onGesture, true));
      return remove;
    },
    listenAppState(cb) {
      if (typeof document === "undefined") return noop;
      const onVis = () => cb(!document.hidden);
      document.addEventListener("visibilitychange", onVis);
      return () => document.removeEventListener("visibilitychange", onVis);
    },
  };
}
