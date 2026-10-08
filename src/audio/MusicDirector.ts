// Music: which loop plays and how loud, from the game state. Three tracks:
// MENU on the title, GAME in play (its level rises with danger: the
// intensity layer), FEVER during fever (a different track at another tempo,
// so it is a 0.5 s / 1 s volume crossfade, never synced). Boss phases 1-2 push
// GAME to full; boss phase 3 switches to the FEVER track at a lower level.
// On top: a pause duck (30%), a short -6 dB duck under stingers and a 600 ms
// fade out into the win / lose jingle (scene "end").

import { ChannelCtl, LoopChannel, stepToward } from "./LoopChannel";
import { MusicId } from "./sounds";

export type MusicScene = "none" | "menu" | "game" | "end";
export type DangerState = "calm" | "tense" | "crit";

export interface MusicState {
  scene: MusicScene;
  fever: boolean;
  boss: number; // 0 = no boss, else the boss phase 1..3
  danger: DangerState;
}

// Danger tiers with 0.1 hysteresis (spec: TENSE >= 0.35, CRIT >= 0.75).
export function nextDangerState(prev: DangerState, d: number): DangerState {
  if (prev === "crit") return d < 0.65 ? (d < 0.25 ? "calm" : "tense") : "crit";
  if (prev === "tense") return d >= 0.75 ? "crit" : d < 0.25 ? "calm" : "tense";
  return d >= 0.75 ? "crit" : d >= 0.35 ? "tense" : "calm";
}

const DANGER_LEVEL: Record<DangerState, number> = { calm: 0.6, tense: 0.82, crit: 1 };

// Target level per track for a state (0..1, before the music volume).
export function musicLevels(st: MusicState): Record<MusicId, number> {
  if (st.scene === "menu") return { menu: 1, game: 0, fever: 0 };
  if (st.scene !== "game") return { menu: 0, game: 0, fever: 0 };
  if (st.fever) return { menu: 0, game: 0, fever: 1 };
  if (st.boss >= 3) return { menu: 0, game: 0, fever: 0.75 };
  if (st.boss > 0) return { menu: 0, game: 0.95, fever: 0 };
  return { menu: 0, game: DANGER_LEVEL[st.danger], fever: 0 };
}

const IDS: readonly MusicId[] = ["menu", "game", "fever"];
const PAUSE_LEVEL = 0.3;
const DUCK_ATTACK_MS = 60;
const DUCK_RELEASE_MS = 300;

export class MusicDirector {
  readonly state: MusicState = { scene: "none", fever: false, boss: 0, danger: "calm" };
  private paused = false;
  private pauseLevel = 1;
  private duckLevel = 1;
  private duckDepth = 1;
  private duckUntil = 0;
  private dangerValue = 0;

  private channels: Record<MusicId, LoopChannel> | null = null;

  constructor(private readonly now: () => number) {}

  // Players exist only after AudioManager.init(); state set before that is kept.
  attach(channels: Record<MusicId, LoopChannel> | null) {
    this.channels = channels;
    if (channels) this.retarget(0, 0);
  }

  getChannel(id: MusicId): LoopChannel | null {
    return this.channels ? this.channels[id] : null;
  }

  setScene(scene: MusicScene, restart = false) {
    const prev = this.state.scene;
    if (scene === prev && !restart) return;
    this.state.scene = scene;
    if (scene !== "game") {
      this.state.fever = false;
      this.state.boss = 0;
    }
    if (restart && scene === "game") this.channels?.game.restart();
    if (scene === "menu" && prev !== "menu") this.channels?.menu.restart();
    const ms = scene === "end" ? 600 : 800;
    this.retarget(ms, ms);
  }

  setFever(on: boolean) {
    if (on === this.state.fever) return;
    this.state.fever = on;
    if (on) this.channels?.fever.restart();
    // fever in 0.5 s, out 1 s (the other tracks mirror it)
    this.retarget(on ? 500 : 1000, on ? 500 : 1000);
  }

  setBoss(phase: number) {
    if (phase === this.state.boss) return;
    this.state.boss = phase;
    this.retarget(1000, 1000);
  }

  setDanger(d: number) {
    this.dangerValue = d;
    const next = nextDangerState(this.state.danger, d);
    if (next === this.state.danger) return;
    const up = DANGER_LEVEL[next] > DANGER_LEVEL[this.state.danger];
    this.state.danger = next;
    this.retarget(up ? 1200 : 2500, up ? 1200 : 2500);
  }

  getDanger() {
    return this.dangerValue;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  // -6 dB (depth 0.5) for holdMs under a stinger.
  duck(depth = 0.5, holdMs = 400) {
    this.duckDepth = Math.min(this.duckDepth, depth);
    this.duckUntil = Math.max(this.duckUntil, this.now() + holdMs);
  }

  busy() {
    if (this.pauseLevel !== (this.paused ? PAUSE_LEVEL : 1)) return true;
    if (this.duckUntil > 0 || this.duckLevel !== 1) return true;
    if (!this.channels) return false;
    for (const id of IDS) if (this.channels[id].busy()) return true;
    return false;
  }

  update(now: number, dt: number, out: number, ctl: ChannelCtl) {
    this.pauseLevel = stepToward(this.pauseLevel, this.paused ? PAUSE_LEVEL : 1, dt / 250);
    let duckTarget = 1;
    if (this.duckUntil > 0) {
      if (now < this.duckUntil) duckTarget = this.duckDepth;
      else {
        this.duckUntil = 0;
        this.duckDepth = 1;
      }
    }
    const rate = duckTarget < this.duckLevel ? 1 / DUCK_ATTACK_MS : 1 / DUCK_RELEASE_MS;
    this.duckLevel = stepToward(this.duckLevel, duckTarget, rate * dt);
    if (!this.channels) return;
    const o = out * this.pauseLevel * this.duckLevel;
    for (const id of IDS) this.channels[id].update(now, dt, o, ctl);
  }

  stopNow(now: number) {
    if (!this.channels) return;
    for (const id of IDS) this.channels[id].stopNow(now);
  }

  private retarget(upMs: number, downMs: number) {
    if (!this.channels) return;
    const lv = musicLevels(this.state);
    for (const id of IDS) {
      const ch = this.channels[id];
      const t = lv[id];
      if (t !== ch.target) ch.fadeTo(t, t > ch.level ? upMs : downMs);
    }
  }
}
