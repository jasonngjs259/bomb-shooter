// AudioManager: owns every player (created once in init, released in
// dispose), the SFX pools, the voice cap and the music director.
//
//  - Pools: each sound has `voices` players used round-robin (a free one
//    first, else the pool's oldest restarts). One player never overlaps
//    itself, so a pool size is its polyphony.
//  - Voice cap: at most backend.voiceCap SFX voices count as playing (by each
//    sound's duration, no status events). When full, the oldest voice of the
//    lowest priority is stolen if it is not more important than the new
//    sound; otherwise the new sound is dropped.
//  - Limits: same-id retrigger under gapMs is dropped; burst caps (e.g. 3 pops
//    per 50 ms) use a preallocated ring of timestamps.
//  - Volume: master x group x sound x per-play gain. Muted groups make no
//    play() calls at all. Without volume control (iOS browsers) sounds play at
//    full or not at all, and music switches instead of fading.
//  - Web: nothing plays until unlock() (first tap / key); unlock warms every
//    player with a play/pause inside the gesture, then starts the music.
//  - One requestAnimationFrame loop runs only while something fades, a
//    masked loop plays, a duck is active or a delayed sound is pending.
// No allocation per sound: plays reuse the Voice records and schedule slots.

import { LoopChannel } from "./LoopChannel";
import { MusicDirector } from "./MusicDirector";
import { MUSIC, MusicId, SOUNDS, SoundDef, SoundId } from "./sounds";
import { AudioBackend, noop, PlayerLike, seekStart } from "./types";

class Voice {
  start = 0;
  end = 0; // counts against the cap while now < end
  rate = 1;
  constructor(readonly player: PlayerLike, readonly pool: Pool) {}
}

class Pool {
  readonly voices: Voice[] = [];
  rr = 0;
  last = -Infinity;
  readonly burst: Float64Array | null;
  burstIdx = 0;
  constructor(readonly id: SoundId, readonly def: SoundDef) {
    this.burst = def.burst ? new Float64Array(def.burst.count).fill(-Infinity) : null;
  }
}

interface Scheduled {
  at: number;
  id: SoundId | null;
  rate: number;
  gain: number;
}

export interface AudioStats {
  players: number;
  plays: number;
  limited: number; // dropped by gap / burst limits
  capDropped: number; // dropped: cap full of more important voices
  stolen: number;
  warmed: number;
}

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

const SCHEDULE_SLOTS = 24;
const VOLUME_INTERVAL_MS = 50; // music volume writes at <= 20 Hz
const LOOP_OVERLAP_MS = { music: 350, sfx: 120 };

export class AudioManager {
  readonly stats: AudioStats = { players: 0, plays: 0, limited: 0, capDropped: 0, stolen: 0, warmed: 0 };
  readonly music: MusicDirector;
  unlocked = false;
  private initialised = false;
  private suspended = false;
  private musicOn = true;
  private sfxOn = true;
  private gamePaused = false;
  private readonly vol: Volumes = { master: 1, music: 1, sfx: 1 };
  private readonly pools = {} as Record<SoundId, Pool>;
  private readonly allVoices: Voice[] = [];
  private readonly loops = new Map<SoundId, LoopChannel>();
  private readonly loopList: LoopChannel[] = [];
  private readonly players: PlayerLike[] = [];
  private readonly schedule: Scheduled[] = [];
  private frameHandle = -1;
  private lastFrame = 0;
  private lastVolumeWrite = 0;
  private cleanups: (() => void)[] = [];
  private readonly ctl = { allowed: false, volumeControl: true, applyVolume: true };

  constructor(readonly backend: AudioBackend) {
    this.music = new MusicDirector(() => this.backend.now());
    for (let i = 0; i < SCHEDULE_SLOTS; i++) this.schedule.push({ at: 0, id: null, rate: 1, gain: 1 });
  }

  // Create every player once. Safe to call again (no-op).
  init() {
    if (this.initialised) return;
    this.initialised = true;
    const b = this.backend;
    b.configure?.();
    const make = (file: string) => {
      const p = b.createPlayer(file);
      this.players.push(p);
      return p;
    };
    const loopPlayers = (file: string) => (b.maskLoops ? [make(file), make(file)] : [make(file)]);
    const channels = {} as Record<MusicId, LoopChannel>;
    for (const id of Object.keys(MUSIC) as MusicId[]) {
      const m = MUSIC[id];
      channels[id] = new LoopChannel(loopPlayers(m.file), m.durMs, m.vol, LOOP_OVERLAP_MS.music);
    }
    this.music.attach(channels);
    for (const id of Object.keys(SOUNDS) as SoundId[]) {
      const def: SoundDef = SOUNDS[id];
      if (def.loop) {
        const ch = new LoopChannel(loopPlayers(def.files[0]), def.durMs, def.vol, LOOP_OVERLAP_MS.sfx);
        this.loops.set(id, ch);
        this.loopList.push(ch);
        continue;
      }
      const pool = new Pool(id, def);
      for (let i = 0; i < def.voices; i++) {
        const v = new Voice(make(def.files[i % def.files.length]), pool);
        pool.voices.push(v);
        this.allVoices.push(v);
      }
      this.pools[id] = pool;
    }
    this.stats.players = this.players.length;
    this.ctl.volumeControl = b.volumeControl;
    if (!b.needsUnlock) this.unlocked = true;
    else if (b.listenFirstGesture) this.cleanups.push(b.listenFirstGesture(() => this.unlock()));
    if (b.listenAppState) this.cleanups.push(b.listenAppState((fg) => (fg ? this.resume() : this.suspend())));
    this.kick();
  }

  // Web: call inside the first user gesture. Warms each player (play + pause)
  // so later play() calls are allowed, then starts whatever music is due.
  unlock() {
    if (this.unlocked || !this.initialised) return;
    this.unlocked = true;
    if (this.backend.warmUp) {
      for (const p of this.players) {
        this.backend.warmUp(p);
        this.stats.warmed++;
      }
    }
    this.frame(true);
    this.kick();
  }

  // ---- settings ---------------------------------------------------------------

  setMusicEnabled(on: boolean) {
    if (on === this.musicOn) return;
    this.musicOn = on;
    if (!on) this.music.stopNow(this.backend.now());
    this.kick();
  }

  setSfxEnabled(on: boolean) {
    if (on === this.sfxOn) return;
    this.sfxOn = on;
    if (!on) this.stopSfx();
    this.kick();
  }

  setVolumes(v: Partial<Volumes>) {
    if (v.master !== undefined) this.vol.master = clamp01(v.master);
    if (v.music !== undefined) this.vol.music = clamp01(v.music);
    if (v.sfx !== undefined) this.vol.sfx = clamp01(v.sfx);
    this.lastVolumeWrite = -Infinity;
    this.kick();
  }

  getVolumes(): Readonly<Volumes> {
    return this.vol;
  }

  // Game pause: SFX and loops stop, the music ducks to 30%.
  setGamePaused(paused: boolean) {
    if (paused === this.gamePaused) return;
    this.gamePaused = paused;
    if (paused) this.stopSfx();
    this.music.setPaused(paused);
    this.kick();
  }

  // ---- SFX --------------------------------------------------------------------

  // Plays a pooled sound. Returns false when it was not played (locked,
  // muted, limited, or the cap is full of more important voices).
  play(id: SoundId, rate = 1, gain = 1): boolean {
    if (!this.initialised || !this.unlocked || this.suspended || !this.sfxOn || this.gamePaused) return false;
    const pool = this.pools[id];
    if (!pool) return false;
    const def = pool.def;
    const vol = clamp01(this.vol.master * this.vol.sfx * def.vol * gain);
    if (vol <= (this.backend.volumeControl ? 0.001 : 0.05)) return false;
    const now = this.backend.now();
    if (now - pool.last < (def.gapMs ?? 40)) {
      this.stats.limited++;
      return false;
    }
    if (pool.burst && def.burst && now - pool.burst[pool.burstIdx] < def.burst.windowMs) {
      this.stats.limited++;
      return false;
    }
    // a voice from this pool: free first, else its oldest (restart in place)
    let voice: Voice | null = null;
    const n = pool.voices.length;
    for (let k = 0; k < n; k++) {
      const v = pool.voices[(pool.rr + k) % n];
      if (v.end <= now) {
        voice = v;
        pool.rr = (pool.rr + k + 1) % n;
        break;
      }
    }
    if (!voice) {
      voice = pool.voices[pool.rr];
      pool.rr = (pool.rr + 1) % n;
      for (const v of pool.voices) if (v.start < voice.start) voice = v;
    } else if (this.activeVoices(now) >= this.backend.voiceCap) {
      const victim = this.victim(now);
      if (!victim || victim.pool.def.pri < def.pri) {
        this.stats.capDropped++;
        return false;
      }
      victim.player.pause();
      victim.end = 0;
      this.stats.stolen++;
    }
    pool.last = now;
    if (pool.burst) {
      pool.burst[pool.burstIdx] = now;
      pool.burstIdx = (pool.burstIdx + 1) % pool.burst.length;
    }
    const p = voice.player;
    if (voice.rate !== rate) {
      p.shouldCorrectPitch = false; // before setPlaybackRate; never assign playbackRate
      p.setPlaybackRate(rate);
      voice.rate = rate;
    }
    if (this.backend.volumeControl) p.volume = vol;
    seekStart(p);
    p.play();
    voice.start = now;
    voice.end = now + def.durMs / Math.max(0.25, rate);
    this.stats.plays++;
    return true;
  }

  // Plays id after delayMs (stars, staggered ticks, lightning hops).
  playLater(id: SoundId, delayMs: number, rate = 1, gain = 1): boolean {
    if (delayMs <= 0) return this.play(id, rate, gain);
    if (!this.unlocked || !this.sfxOn) return false;
    for (const s of this.schedule) {
      if (s.id !== null) continue;
      s.id = id;
      s.at = this.backend.now() + delayMs;
      s.rate = rate;
      s.gain = gain;
      this.kick();
      return true;
    }
    return false;
  }

  // Looping SFX (roller hum): gain 0 stops it, > 0 starts / sets its level.
  setLoop(id: SoundId, gain: number) {
    const ch = this.loops.get(id);
    if (!ch) return;
    const g = clamp01(gain);
    if (g > 0) {
      ch.gain = g;
      ch.fadeTo(1, 150);
    } else ch.fadeTo(0, 200);
    this.kick();
  }

  stopSfx() {
    for (const v of this.allVoices) {
      if (v.end > 0) v.player.pause();
      v.end = 0;
    }
    for (const s of this.schedule) s.id = null;
    const now = this.backend.now();
    for (const ch of this.loopList) {
      ch.fadeTo(0, 0);
      ch.stopNow(now);
    }
  }

  activeVoices(now = this.backend.now()): number {
    let n = 0;
    for (const v of this.allVoices) if (v.end > now) n++;
    for (const ch of this.loopList) if (ch.running) n++;
    return n;
  }

  // ---- lifecycle --------------------------------------------------------------

  suspend() {
    if (this.suspended) return;
    this.suspended = true;
    this.stopSfx();
    this.music.stopNow(this.backend.now());
    this.backend.setActive?.(false);
  }

  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    this.backend.setActive?.(true);
    this.kick();
  }

  dispose() {
    if (!this.initialised) return;
    if (this.frameHandle >= 0) this.backend.cancelFrame(this.frameHandle);
    this.frameHandle = -1;
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
    for (const p of this.players) {
      try {
        p.pause();
        p.release();
      } catch {
        noop();
      }
    }
    this.players.length = 0;
    this.allVoices.length = 0;
    this.music.attach(null);
    this.loops.clear();
    this.loopList.length = 0;
    this.initialised = false;
    this.unlocked = false;
    this.stats.players = 0;
  }

  // Needs frame updates?
  busy(): boolean {
    if (!this.initialised) return false;
    if (this.music.busy()) return true;
    for (const s of this.schedule) if (s.id !== null) return true;
    for (const ch of this.loopList) if (ch.busy()) return true;
    return false;
  }

  // Ensure the frame loop runs (no-op if already scheduled).
  kick() {
    if (!this.initialised || this.frameHandle >= 0) return;
    this.frameHandle = this.backend.requestFrame(this.onFrame);
  }

  // One update step; exposed for tests (force = write volumes now).
  frame(force = false) {
    if (!this.initialised) return;
    const now = this.backend.now();
    const dt = Math.min(250, Math.max(0, now - (this.lastFrame || now)));
    this.lastFrame = now;
    const ctl = this.ctl;
    ctl.applyVolume = force || now - this.lastVolumeWrite >= VOLUME_INTERVAL_MS;
    if (ctl.applyVolume) this.lastVolumeWrite = now;
    const live = this.unlocked && !this.suspended;
    // no volume control (iOS web): a paused game pauses the music instead of ducking it
    ctl.allowed = live && this.musicOn && (this.backend.volumeControl || !this.gamePaused);
    this.music.update(now, dt, this.vol.master * this.vol.music, ctl);
    ctl.allowed = live && this.sfxOn && !this.gamePaused;
    const sfxOut = this.vol.master * this.vol.sfx;
    for (const ch of this.loopList) ch.update(now, dt, sfxOut, ctl);
    for (const s of this.schedule) {
      if (s.id === null || s.at > now) continue;
      const id = s.id;
      s.id = null;
      this.play(id, s.rate, s.gain);
    }
  }

  private readonly onFrame = () => {
    this.frameHandle = -1;
    this.frame();
    if (this.busy()) this.kick();
    else this.lastFrame = 0;
  };

  private victim(now: number): Voice | null {
    let best: Voice | null = null;
    for (const v of this.allVoices) {
      if (v.end <= now) continue;
      if (
        !best ||
        v.pool.def.pri > best.pool.def.pri ||
        (v.pool.def.pri === best.pool.def.pri && v.start < best.start)
      )
        best = v;
    }
    return best;
  }
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
