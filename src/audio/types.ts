// Platform seam for the audio system. The AudioManager only talks to these
// interfaces, so the logic runs headlessly with a fake player factory
// (scripts/audio-sanity.ts) and the expo-audio specifics live in
// backend.ts / backend.web.ts.

// The slice of expo-audio's AudioPlayer the manager uses. Never assign
// playbackRate (throws on native, expo PR #50659): set shouldCorrectPitch,
// then call setPlaybackRate.
export interface PlayerLike {
  volume: number;
  muted: boolean;
  loop: boolean;
  shouldCorrectPitch: boolean;
  play(): void;
  pause(): void;
  seekTo(seconds: number): unknown;
  setPlaybackRate(rate: number): void;
  release(): void;
}

export interface AudioBackend {
  // Creates one player for a file id (see assets.ts). Called only at init.
  createPlayer(file: string): PlayerLike;
  voiceCap: number; // simultaneous SFX voices (12 native, 16 web)
  volumeControl: boolean; // false on iOS browsers: volume writes are ignored
  maskLoops: boolean; // web: MP3 loops are not gapless, crossfade two players
  needsUnlock: boolean; // web: no sound until the first tap / key press
  now(): number; // ms
  requestFrame(cb: () => void): number;
  cancelFrame(handle: number): void;
  configure?(): void; // audio session (iOS ambient: the silent switch mutes)
  setActive?(active: boolean): void; // setIsAudioActiveAsync
  warmUp?(p: PlayerLike): void; // in the unlock gesture: play + pause once
  listenFirstGesture?(cb: () => void): () => void;
  listenAppState?(cb: (foreground: boolean) => void): () => void;
}

export const noop = () => undefined;

// seekTo returns a promise on native; swallow rejections without allocating
// a handler per call.
export function seekStart(p: PlayerLike) {
  const r = p.seekTo(0) as Promise<void> | undefined;
  if (r && typeof r.catch === "function") r.catch(noop);
}
