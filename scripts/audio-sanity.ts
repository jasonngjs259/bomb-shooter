// Headless test of the audio logic with a fake player factory and a manual
// clock: player count (created once), pool round-robin, retrigger / burst
// limits, the voice cap with priority stealing, mute + volume, playback rate
// rules, the crossfade maths (equal power, fever crossfade, web seam masking),
// ducking, danger hysteresis, combo notes, suspend / resume, the web unlock
// flow (silent until the first gesture, then play/pause warm-up of every
// player and the music starts) and the engine event maps (real ArenaEngine;
// the full fun-feature map is in scripts/arena-fun-audio.ts).
// Run: npx tsx --tsconfig scripts/smoke/tsconfig.json scripts/audio-sanity.ts

import { AudioManager } from "../src/audio/AudioManager";
import { bindFunEvents } from "../src/audio/funEvents";
import { equalPower } from "../src/audio/LoopChannel";
import { musicLevels, nextDangerState } from "../src/audio/MusicDirector";
import { bindArenaAudio, bindClassicAudio, newArenaAudioState } from "../src/audio/sfxMap";
import { comboNoteId, comboNoteRate, MUSIC, playerCount, semitones, SOUNDS } from "../src/audio/sounds";
import { AudioBackend, PlayerLike } from "../src/audio/types";
import { ArenaEngine } from "../src/game/arena";
import { TypedEmitter } from "../src/game/emitter";
import { GameEngine } from "../src/game/engine";

let failures = 0;
let checks = 0;
const ok = (cond: unknown, msg: string) => {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  FAIL ${msg}`);
  }
};
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;
const section = (name: string) => console.log(`- ${name}`);

class FakePlayer implements PlayerLike {
  volume = 1;
  muted = false;
  loop = false;
  shouldCorrectPitch = true;
  plays = 0;
  pauses = 0;
  seeks = 0;
  rate = 1;
  playing = false;
  released = false;
  volumeWrites = 0;
  constructor(readonly file: string, private readonly log: string[]) {
    let v = 1;
    Object.defineProperty(this, "volume", {
      get: () => v,
      set: (x: number) => {
        v = x;
        this.volumeWrites++;
      },
    });
  }
  // expo-audio native throws when playbackRate is assigned (PR #50659)
  set playbackRate(_v: number) {
    throw new Error("playbackRate assigned");
  }
  play() {
    this.plays++;
    this.playing = true;
    this.log.push(`play:${this.file}`);
  }
  pause() {
    this.pauses++;
    this.playing = false;
  }
  seekTo() {
    this.seeks++;
    return Promise.resolve();
  }
  setPlaybackRate(r: number) {
    if (this.shouldCorrectPitch) throw new Error("setPlaybackRate before shouldCorrectPitch = false");
    this.rate = r;
  }
  release() {
    this.released = true;
  }
}

interface Harness {
  a: AudioManager;
  players: FakePlayer[];
  log: string[];
  t: { now: number };
  step: (ms: number) => void;
  gesture: () => void;
  active: boolean[];
  appState: (fg: boolean) => void;
}

function harness(kind: "native" | "web" | "iosweb"): Harness {
  const players: FakePlayer[] = [];
  const log: string[] = [];
  const t = { now: 1000 };
  let gestureCb: (() => void) | null = null;
  let appCb: ((fg: boolean) => void) | null = null;
  const active: boolean[] = [];
  const web = kind !== "native";
  const backend: AudioBackend = {
    voiceCap: web ? 16 : 12,
    volumeControl: kind !== "iosweb",
    maskLoops: web,
    needsUnlock: web,
    now: () => t.now,
    requestFrame: () => 1,
    cancelFrame: () => undefined,
    createPlayer(file) {
      const p = new FakePlayer(file, log);
      players.push(p);
      return p;
    },
    setActive: (v) => active.push(v),
    warmUp: web
      ? (p) => {
          p.muted = true;
          p.play();
          p.pause();
          p.muted = false;
        }
      : undefined,
    listenFirstGesture: web
      ? (cb) => {
          gestureCb = cb;
          return () => (gestureCb = null);
        }
      : undefined,
    listenAppState: (cb) => {
      appCb = cb;
      return () => (appCb = null);
    },
  };
  const a = new AudioManager(backend);
  a.init();
  const step = (ms: number) => {
    const end = t.now + ms;
    while (t.now < end) {
      t.now = Math.min(end, t.now + 16);
      a.frame();
    }
  };
  return { a, players, log, t, step, gesture: () => gestureCb?.(), active, appState: (fg) => appCb?.(fg) };
}

const byFile = (h: Harness, file: string) => h.players.filter((p) => p.file === file);
const totalPlays = (h: Harness) => h.players.reduce((n, p) => n + p.plays, 0);

// ---------------------------------------------------------------------------
section("players are created once, counts per platform");
{
  const n = harness("native");
  ok(n.players.length === playerCount(false), `native players ${n.players.length} == ${playerCount(false)}`);
  ok(n.players.length < 60, `native players ${n.players.length} < 60 (Android media-session limit)`);
  n.a.init();
  ok(n.players.length === playerCount(false), "init twice creates nothing");
  const w = harness("web");
  ok(w.players.length === playerCount(true), `web players ${w.players.length} == ${playerCount(true)}`);
  console.log(`  players: native ${n.players.length}, web ${w.players.length}; voice cap native 12, web 16`);
  n.a.dispose();
  ok(n.players.every((p) => p.released), "dispose releases every player");
}

section("pool round-robin, retrigger gap and burst limit");
{
  const h = harness("native");
  const shoot = byFile(h, "sfx_bomb_shoot");
  ok(shoot.length === SOUNDS.shoot.voices, "shoot pool size");
  h.a.play("shoot");
  h.t.now += 45;
  h.a.play("shoot");
  h.t.now += 45;
  h.a.play("shoot");
  ok(shoot.every((p) => p.plays === 1), "3 overlapping shots use 3 different players");
  h.t.now += 45; // all 3 still sounding (240 ms): the oldest restarts
  h.a.play("shoot");
  ok(shoot[0].plays === 2 && shoot[0].seeks === 2, "4th shot restarts the oldest player from 0");
  const before = h.a.stats.limited;
  h.t.now += 10;
  ok(!h.a.play("shoot"), "same-id retrigger within 40 ms dropped");
  ok(h.a.stats.limited === before + 1, "counted as limited");
  // pops: 3 per 50 ms
  h.t.now += 1000;
  ok(h.a.play("pop"), "pop 1");
  h.t.now += 16;
  ok(h.a.play("pop"), "pop 2");
  h.t.now += 16;
  ok(h.a.play("pop"), "pop 3");
  h.t.now += 16;
  ok(!h.a.play("pop"), "4th pop inside 50 ms dropped (burst)");
  h.t.now += 20;
  ok(h.a.play("pop"), "pop allowed again once the window passed");
  const pops = h.players.filter((p) => p.file.startsWith("sfx_pop_"));
  ok(new Set(pops.filter((p) => p.plays > 0).map((p) => p.file)).size === 3, "pop variants rotate across the 3 files");
}

section("voice cap 12 with priority stealing");
{
  const h = harness("native");
  // 12 long-ish low/mid priority voices (distinct sounds, no limits hit)
  const fill = ["swap", "hover", "stick", "dodge", "zap", "pickupSpawn", "shatter", "deflect", "tick", "tickWarn", "shoot", "shieldBreak"] as const;
  for (const id of fill) {
    ok(h.a.play(id), `fill ${id}`);
    h.t.now += 1;
  }
  ok(h.a.activeVoices() <= 12, "never more than 12 active");
  const hover = byFile(h, "sfx_ui_hover")[0];
  // tick (60 ms) and hover (40 ms) may have ended; force all 12 alive by checking count
  const active = h.a.activeVoices();
  ok(active >= 10, `most fill voices still active (${active})`);
  // refill to exactly 12 if some ended
  h.t.now += 0;
  const stolenBefore = h.a.stats.stolen;
  for (const id of ["chain", "rumble", "mega"] as const) h.a.play(id);
  ok(h.a.activeVoices() === 12, `cap holds at 12 (${h.a.activeVoices()})`);
  ok(h.a.stats.stolen > stolenBefore, "a P1/P2 sound steals when full");
  const swap = byFile(h, "sfx_swap")[0];
  ok(swap.pauses >= 1 || hover.pauses >= 1, "the stolen voice is a lowest-priority (P5) one and was paused");
  // now fill with P1 sounds and try a P5: dropped
  for (const id of ["surge", "playerHit", "pickupCollect", "freeze", "feverStart", "bossAppear", "bossDown", "vReady", "vGo", "levelClear", "gameOver", "star1"] as const) {
    h.a.play(id);
  }
  const capBefore = h.a.stats.capDropped;
  h.t.now += 100;
  ok(!h.a.play("swap"), "P5 sound dropped when the cap is full of P1 voices");
  ok(h.a.stats.capDropped === capBefore + 1, "counted as capDropped");
  ok(h.a.activeVoices() <= 12, "still capped");
}

section("playback rate, mute and volume");
{
  const h = harness("native");
  ok(h.a.play("comboBlip", 1.5), "pitched play");
  const blip = byFile(h, "sfx_combo_blip")[0];
  ok(blip.rate === 1.5 && blip.shouldCorrectPitch === false, "setPlaybackRate after shouldCorrectPitch = false");
  h.a.setVolumes({ master: 0.5 });
  h.t.now += 100;
  h.a.play("shoot");
  const shot = byFile(h, "sfx_bomb_shoot").find((p) => p.plays > 0)!;
  ok(near(shot.volume, 0.45 * 0.5), `volume = master x sound (${shot.volume})`);
  h.a.setSfxEnabled(false);
  const plays = totalPlays(h);
  h.t.now += 100;
  ok(!h.a.play("shoot") && !h.a.playLater("pop", 10), "SFX off: nothing plays");
  ok(totalPlays(h) === plays, "SFX off: no play() calls at all");
  h.a.setSfxEnabled(true);
  h.a.music.setScene("menu");
  h.step(100);
  const menu = byFile(h, MUSIC.menu.file)[0];
  ok(menu.playing, "menu music plays");
  h.a.setMusicEnabled(false);
  ok(!menu.playing, "music off pauses the music");
  const p2 = menu.plays;
  h.step(500);
  ok(menu.plays === p2, "music off: no play() calls");
  h.a.setMusicEnabled(true);
  h.step(50);
  ok(menu.playing, "music back on resumes");

  const ios = harness("iosweb");
  ios.gesture();
  ios.t.now += 50;
  ios.a.play("shoot");
  const iosShot = byFile(ios, "sfx_bomb_shoot").find((p) => p.plays > 1)!;
  ok(iosShot && iosShot.volumeWrites === 0, "iOS web: no volume writes (ignored by Safari)");
}

section("crossfade maths");
{
  for (const w of [0, 0.25, 0.5, 0.75, 1]) {
    const [o, i] = equalPower(w);
    ok(near(o * o + i * i, 1), `equal power at w=${w}`);
  }
  ok(near(equalPower(0)[0], 1) && near(equalPower(1)[1], 1) && near(equalPower(0.5)[0], Math.SQRT1_2), "end points and midpoint");

  const h = harness("native");
  h.a.music.setScene("game", true);
  h.step(2000);
  const game = byFile(h, MUSIC.game.file)[0];
  const fever = byFile(h, MUSIC.fever.file)[0];
  const gameCh = h.a.music.getChannel("game")!;
  const feverCh = h.a.music.getChannel("fever")!;
  ok(game.playing && near(gameCh.level, 0.6), `calm game level 0.6 (${gameCh.level})`);
  ok(game.loop === true, "native loop flag on a single player");
  h.a.music.setFever(true);
  h.step(250);
  ok(feverCh.level > 0.4 && feverCh.level < 0.6, `fever half-way after 250 ms (${feverCh.level.toFixed(2)})`);
  ok(fever.playing && game.playing, "both tracks audible mid-crossfade");
  h.step(300);
  ok(near(feverCh.level, 1) && near(gameCh.level, 0), "fever crossfade done in 0.5 s");
  ok(!game.playing, "silent game track is paused (keeps its position)");
  ok(near(fever.volume, MUSIC.fever.vol), `fever at its mix level (${fever.volume.toFixed(3)})`);
  h.a.music.setFever(false);
  h.step(500);
  ok(feverCh.level > 0.4 && feverCh.level < 0.6, "fever out half-way at 0.5 s");
  h.step(550);
  ok(near(feverCh.level, 0) && near(gameCh.level, 0.6) && !fever.playing, "back to the game loop in 1 s");
  // danger intensity layer
  h.a.music.setDanger(0.8);
  h.step(1300);
  ok(near(gameCh.level, 1), "CRIT: game loop at full");
  // duck under a stinger (-6 dB)
  h.step(100);
  const full = game.volume;
  h.a.music.duck();
  h.step(80);
  ok(near(game.volume, full * 0.5, 0.02), `duck to -6 dB (${game.volume.toFixed(3)} vs ${full.toFixed(3)})`);
  h.step(800);
  ok(near(game.volume, full, 0.01), "duck released");
  // pause: music to 30%, sfx stop
  h.a.setGamePaused(true);
  h.step(300);
  ok(near(game.volume, full * 0.3, 0.01), "pause ducks music to 30%");
  ok(!h.a.play("shoot"), "no SFX while paused");
  h.a.setGamePaused(false);
  h.step(300);
  // end: 600 ms fade out
  h.a.music.setScene("end");
  h.step(320);
  ok(gameCh.level > 0.3 && gameCh.level < 0.7, `end fade half-way (${gameCh.level.toFixed(2)})`);
  h.step(320);
  ok(near(gameCh.level, 0) && !game.playing, `music out after 600 ms (${gameCh.level} ${game.playing})`);
  // volume writes throttled to <= 20 Hz
  h.a.music.setScene("game", true);
  h.step(100);
  const writes = game.volumeWrites;
  h.step(1000);
  ok(game.volumeWrites - writes <= 21, `<= 20 volume writes per second (${game.volumeWrites - writes})`);

  ok(musicLevels({ scene: "game", fever: false, boss: 3, danger: "calm" }).fever === 0.75, "boss phase 3 uses the fever track");
  ok(musicLevels({ scene: "game", fever: false, boss: 1, danger: "calm" }).game === 0.95, "boss phase 1-2 game loop high");
  ok(musicLevels({ scene: "menu", fever: true, boss: 0, danger: "crit" }).menu === 1, "menu scene: menu loop only");
}

section("danger hysteresis and combo notes");
{
  ok(nextDangerState("calm", 0.34) === "calm" && nextDangerState("calm", 0.35) === "tense", "calm -> tense at 0.35");
  ok(nextDangerState("tense", 0.3) === "tense" && nextDangerState("tense", 0.24) === "calm", "tense -> calm below 0.25");
  ok(nextDangerState("tense", 0.75) === "crit" && nextDangerState("crit", 0.7) === "crit", "crit at 0.75, held to 0.65");
  ok(nextDangerState("crit", 0.6) === "tense", "crit -> tense below 0.65");
  for (let c = 1; c <= 6; c++) ok(comboNoteId(c) === `combo${c}` && comboNoteRate(c) === 1, `combo ${c} pre-rendered`);
  ok(comboNoteId(7) === "comboBlip" && near(comboNoteRate(7), semitones(14)), "combo 7: blip +14 st");
  ok(near(comboNoteRate(50), 4), "combo pitch capped at +24 st (rate 4)");
}

section("web: seam-masked loops");
{
  const h = harness("web");
  h.gesture();
  h.a.music.setScene("menu");
  h.step(50);
  const [m0, m1] = byFile(h, MUSIC.menu.file);
  ok(m0.loop === false && m1.loop === false, "masked loops do not use <audio loop>");
  ok(m0.playing && !m1.playing, "first pass on player A");
  h.step(MUSIC.menu.durMs - 350 - 50 + 20);
  ok(m1.playing && m0.playing, "player B starts before A's end (overlap)");
  h.step(170);
  ok(m0.volume < 0.9 * MUSIC.menu.vol && m1.volume > 0.1 * MUSIC.menu.vol, "equal-power crossfade in progress");
  h.step(250);
  ok(!m0.playing && m1.playing, "A paused after the overlap; B carries the loop");
  h.step(MUSIC.menu.durMs);
  ok(m0.playing && m0.seeks >= 2, "A takes over again from 0 on the next pass");
}

section("web unlock flow");
{
  const h = harness("web");
  h.a.music.setScene("menu");
  h.step(200);
  ok(!h.a.unlocked, "locked before any gesture");
  ok(!h.a.play("click"), "SFX ignored before the gesture");
  ok(totalPlays(h) === 0, "no play() call before the gesture (autoplay policy)");
  h.gesture();
  ok(h.a.unlocked, "unlocked by the first gesture");
  ok(h.a.stats.warmed === h.players.length, `every player warmed once (${h.a.stats.warmed}/${h.players.length})`);
  ok(h.players.every((p) => p.plays >= 1 && p.pauses >= 1 && !p.muted), "warm-up = muted play + pause, unmuted after");
  const menu = byFile(h, MUSIC.menu.file)[0];
  ok(menu.playing && menu.plays === 2, "menu music starts inside the gesture");
  ok(h.a.play("click"), "SFX play after unlock");
  h.gesture();
  ok(h.a.stats.warmed === h.players.length, "second gesture does not warm again");
  // tab hidden / visible
  h.appState(false);
  ok(!menu.playing && h.active[h.active.length - 1] === false, "hidden: music paused, audio inactive");
  ok(!h.a.play("swap"), "no SFX while suspended");
  h.appState(true);
  h.step(50);
  ok(menu.playing && h.active[h.active.length - 1] === true, "visible: music resumes");
}

section("engine event maps");
{
  const h = harness("native");
  const e = new ArenaEngine({ random: mulberry(7) });
  const st = newArenaAudioState();
  const bus = new TypedEmitter<{ banner: { text: string; color: string; duration: number } }>();
  const offA = bindArenaAudio(e, h.a, st, bus as never);
  const offF = bindFunEvents(e, h.a, st);
  e.newGame({ level: 1 });
  ok(h.a.music.state.scene === "game", "arena level start -> game music");
  bus.emit("banner", { text: "READY", color: "", duration: 1 });
  ok(byFile(h, "voice_ready")[0].plays === 1, "READY banner -> voice");
  let shots = 0;
  for (let i = 0; i < 400 && e.getPhase() === "playing"; i++) {
    if (i % 25 === 0) {
      e.setYaw((i / 25) * 0.7);
      e.fire();
      shots++;
    }
    e.update(1 / 30);
    h.t.now += 34;
  }
  const shootPlays = byFile(h, "sfx_bomb_shoot").reduce((n, p) => n + p.plays, 0);
  ok(shootPlays > 0, `arena shoot events play the shot (${shootPlays} for ${shots} fires)`);
  // fun events through the real engine (full map: scripts/arena-fun-audio.ts)
  const e2 = new ArenaEngine({ random: mulberry(9) });
  const st2 = newArenaAudioState();
  const offFun = bindFunEvents(e2, h.a, st2);
  e2.newGame({ level: 2 });
  e2.debugSetFever(100);
  e2.update(1 / 30);
  ok(st2.fever && h.a.music.state.fever, "feverStart -> fever music");
  h.t.now += 100;
  e2.debugSpawnPickup("mega", e2.getShooter().x, e2.getShooter().z);
  e2.update(1 / 30);
  ok(near(byFile(h, "sfx_pickup_collect")[0].rate, 0.79), "pickupCollected rate per kind");
  for (let i = 0; i < 300 && h.a.music.state.fever; i++) e2.update(1 / 30);
  ok(!h.a.music.state.fever, "feverEnd -> fever music off");
  offFun();
  offA();
  offF();

  const g = new GameEngine();
  const offC = bindClassicAudio(g, h.a);
  g.newGame();
  ok(h.a.music.state.scene === "game", "classic level start -> game music");
  h.t.now += 1000;
  const before = byFile(h, "sfx_bomb_shoot").reduce((n, p) => n + p.plays, 0);
  g.fire();
  ok(byFile(h, "sfx_bomb_shoot").reduce((n, p) => n + p.plays, 0) === before + 1, "classic shoot -> shot sound");
  offC();
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (failures > 0) {
  console.error(`audio-sanity: ${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`audio-sanity: all ${checks} checks passed`);
