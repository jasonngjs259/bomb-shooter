// Engine events -> sounds and music cues, for the EXISTING Classic and Arena
// events. The new fun-feature events (pickups, fever, boss, ...) are mapped in
// funEvents.ts. Each bind function returns an unsubscribe for useEffect.
//
// Event          Sound (rate / gain)                         Music
// shoot          shoot (rate 0.96-1.04)
// stick / snap   stick (only when no pop follows)
// pop            pop variant (0.97-1.03) + combo note:          danger
//                combo_1..6, then blip pitched up the
//                pentatonic; fever pops: combo_6 +-1 semitone;
//                6+ bombs layer chain
// shatter        shatter
// drop (Classic) chain (80 ms later, 1.1, gain 0.5), 3+ tiles
// wallPush       knockback whoosh (0.96-1.04, 0.8) + deflect (0.8, 0.7)
// miss           deflected (boss shield): deflect (0.95-1.05); range: dodge whoosh (0.85, quiet);
//                pushed: nothing (wallPush covers it)
// wallBounce     deflect (1.25, quiet)
// creepSurge /   surge alarm + rumble                         duck
// ceilingDrop    rumble                                       duck
// dangerChanged  2 warning beeps on entering tier 3           intensity layer
// swap           swap
// gameOver       music out 600 ms -> game_over jingle -> "game over" voice
// won            music out 600 ms -> level_clear jingle -> "you win" voice
// level start    "go" voice                                   game loop from 0
// banner READY   "ready" voice; GO! / LEVEL n: "go" voice

import type { TypedEmitter } from "../game/emitter";
import type { ArenaEngineView } from "../game/arena/types";
import type { GameEngineView } from "../game/types";
import type { FxBusEvents } from "../fx/bus";
import type { AudioManager } from "./AudioManager";
import { comboNoteId, comboNoteRate, semitones } from "./sounds";

// Shared between the Arena bindings and funEvents.ts.
export interface ArenaAudioState {
  fever: boolean;
  feverAlt: boolean;
  rollers: number;
  shieldsPopped: number;
}

export const newArenaAudioState = (): ArenaAudioState => ({ fever: false, feverAlt: false, rollers: 0, shieldsPopped: 0 });

export const jitter = (amount: number) => 1 + (Math.random() * 2 - 1) * amount;

const SEMI_UP = semitones(1);
const SEMI_DOWN = semitones(-1);

export function playPop(a: AudioManager, count: number, combo: number, st: ArenaAudioState | null) {
  a.play("pop", jitter(0.03));
  if (count >= 6) a.play("chain", 1, 0.8);
  if (st?.fever) {
    st.feverAlt = !st.feverAlt;
    a.play("combo6", st.feverAlt ? SEMI_UP : SEMI_DOWN);
    return;
  }
  a.play(comboNoteId(combo), comboNoteRate(combo));
}

// Music fades out (600 ms) into the jingle, then the voice line.
export function endSting(a: AudioManager, won: boolean) {
  a.music.setScene("end");
  if (won) {
    a.playLater("levelClear", 450);
    a.playLater("vWin", 1300);
  } else {
    a.playLater("gameOver", 450);
    a.playLater("vGameOver", 2200);
  }
}

// A stick / snap sound only when no pop follows in the same update (the
// engine emits pop synchronously right after).
function stickGate(a: AudioManager) {
  let pending = false;
  const flush = () => {
    if (pending) a.play("stick", jitter(0.03));
    pending = false;
  };
  return {
    stick() {
      pending = true;
      void Promise.resolve().then(flush);
    },
    popped() {
      pending = false;
    },
  };
}

export function bindClassicAudio(engine: GameEngineView, a: AudioManager): () => void {
  const gate = stickGate(a);
  const danger = () => a.music.setDanger(engine.getDangerLevel());
  const offs = [
    engine.on("shoot", () => a.play("shoot", jitter(0.04))),
    engine.on("wallBounce", () => a.play("deflect", 1.25, 0.35)),
    engine.on("snap", () => {
      gate.stick();
      danger();
    }),
    engine.on("pop", ({ tiles, combo }) => {
      gate.popped();
      playPop(a, tiles.length, combo, null);
      danger();
    }),
    engine.on("drop", ({ tiles }) => {
      if (tiles.length >= 3) a.playLater("chain", 80, 1.1, 0.5);
    }),
    engine.on("ceilingDrop", () => {
      a.play("rumble");
      a.music.duck();
      danger();
    }),
    engine.on("swap", () => a.play("swap")),
    engine.on("gameOver", () => endSting(a, false)),
    engine.on("won", () => endSting(a, true)),
    engine.on("phaseChanged", ({ phase, previous }) => {
      if (phase === "ready" && (previous === "title" || previous === "gameOver" || previous === "won")) {
        a.music.setScene("game", true);
        a.music.setDanger(engine.getDangerLevel());
        a.play("vGo");
      }
    }),
  ];
  return () => offs.forEach((off) => off());
}

export function bindArenaAudio(
  engine: ArenaEngineView,
  a: AudioManager,
  st: ArenaAudioState,
  bus?: TypedEmitter<FxBusEvents>
): () => void {
  const gate = stickGate(a);
  const offs = [
    engine.on("shoot", () => a.play("shoot", jitter(0.04))),
    engine.on("stick", () => gate.stick()),
    engine.on("pop", ({ bombs, combo }) => {
      gate.popped();
      playPop(a, bombs.length, combo, st);
      a.music.setDanger(engine.getDangerLevel());
    }),
    engine.on("shatter", () => a.play("shatter", jitter(0.04))),
    engine.on("wallPush", () => {
      a.play("knockback", jitter(0.04), 0.8);
      a.play("deflect", 0.8, 0.7);
    }),
    engine.on("miss", ({ deflected, pushed }) => {
      if (pushed) return; // wallPush plays it
      if (deflected) a.play("deflect", jitter(0.05));
      else a.play("dodge", 0.85, 0.6);
    }),
    engine.on("creepSurge", () => {
      a.play("surge");
      a.playLater("rumble", 150, 1, 0.8);
      a.music.duck();
    }),
    engine.on("dangerChanged", ({ level, tier, previousTier }) => {
      a.music.setDanger(level);
      if (tier >= 3 && previousTier < 3) {
        a.play("tickWarn");
        a.playLater("tickWarn", 180, 1.12);
      }
    }),
    engine.on("swap", () => a.play("swap")),
    engine.on("gameOver", () => {
      st.fever = false;
      a.setLoop("rollerLoop", 0);
      endSting(a, false);
    }),
    engine.on("won", () => {
      st.fever = false;
      a.setLoop("rollerLoop", 0);
      endSting(a, true);
    }),
    engine.on("phaseChanged", ({ phase, previous }) => {
      if (phase === "playing" && previous !== "playing") {
        st.fever = false;
        st.rollers = 0;
        st.shieldsPopped = 0;
        a.setLoop("rollerLoop", 0);
        a.music.setScene("game", true);
        a.music.setDanger(0);
      }
    }),
  ];
  if (bus) {
    offs.push(
      bus.on("banner", ({ text }) => {
        if (text === "READY") a.play("vReady");
        else if (text === "GO!" || text.startsWith("LEVEL ")) a.play("vGo");
      })
    );
  }
  return () => offs.forEach((off) => off());
}
