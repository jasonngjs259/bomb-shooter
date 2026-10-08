// Sounds for the Arena FUN PASS events (spec section 7), written against the
// spec's event names before the engine has them. Every subscription goes
// through onFun(), which is typed by FunEvents below but tolerant at runtime:
// TypedEmitter.on accepts any name, so an event the engine does not emit yet
// simply never fires; an engine without on() (or one that throws on unknown
// names) gets a no-op. When the engine's ArenaEvents gain these events,
// reconcile names / payloads HERE only (this file is the one-file change).
//
// Event             Sound (rate / gain)                               Music / other
// featureIntro      pickup_spawn (0.9, 0.7)
// pickupSpawned     pickup_spawn
// pickupCollected   pickup_collect, rate by kind (rainbow 1, freeze 0.89,
//                   mega 0.79, lightning 1.12)
// pickupBlocked     ui_back (0.8, 0.6)
// pickupExpired     ui_back (0.7)
// powerFired        rainbow: rainbow_activate (mega / lightning have their own)
// megaBlast         mega_blast + chain (100 ms, 0.6)                  duck
// lightningChain    lightning_zap per hop, 70 ms apart, +1 semitone per hop (cap +12, 8 hops)
// freezeStart/End   freeze / thaw
// feverStart        fever_start                                       fever crossfade in (0.5 s), duck
// feverEnd          fever_end                                         fever crossfade out (1 s)
// armorBroken       shatter (1.15, 1.2)
// tickingWarning    remaining > 2: bomb_tick x2 per s; <= 2: tick_warning x4 per s, +2.5..+5 semitones
// tickingDefused    pickup_collect (0.8, 0.8)
// tickingExploded   chain
// lurch             rumble                                            duck
// rollerTelegraph   surge_alarm (1.25, 0.85)
// rollerLaunched    roller_loop on (level 0.15-0.5 by nearest roller distance)
// rollerDestroyed   roller_impact; loop off when none left
// rollerExpired     loop off when none left
// playerHit         player_hit + knockback_whoosh + stun (150 ms)    duck
// perfectDodge      star_3 (1.0, 0.7)
// rollStart         dodge_whoosh
// rollReady         ui_hover (1.2)
// bossSpawned       boss_appear                                       boss music, duck
// bossShieldPop     boss_shield_break, +0.5 semitone per shield popped
// bossHit           boss_hit (weak: 1.1, louder)
// bossPhase         boss_appear (1.2, 0.8) + rumble                   boss phase music, duck
// bossDefeated      boss_defeated                                     boss music off, duck
// levelStars        star_1..count at 2.7 s, 3.05 s, 3.4 s (with the end card)

import type { AudioManager } from "./AudioManager";
import type { ArenaAudioState } from "./sfxMap";
import { semitones } from "./sounds";
import { noop } from "./types";

// Master switch for the integrator.
export const FUN_EVENTS_ENABLED = true;

type V2 = { x: number; z: number };
type FxBombLike = { id: number; x: number; z: number; colorIndex: number };
type PickupKind = "rainbow" | "mega" | "freeze" | "lightning";

// Payloads per spec section 7 (only the fields the audio reads are required).
export interface FunEvents {
  featureIntro: { feature: string };
  pickupSpawned: { id: number; kind: PickupKind; from?: V2; to?: V2; flight?: number };
  pickupCollected: { id: number; kind: PickupKind; x?: number; z?: number; loaded?: boolean };
  pickupBlocked: { id: number };
  pickupExpired: { id: number; kind?: PickupKind };
  powerFired: { kind: Exclude<PickupKind, "freeze">; x?: number; z?: number; yaw?: number };
  megaBlast: { x: number; z: number; radius: number; bombs?: FxBombLike[] };
  lightningChain: { colorIndex: number; path: FxBombLike[] };
  freezeStart: { duration: number };
  freezeEnd: Record<string, never>;
  feverStart: { duration: number };
  feverEnd: { pops?: number; score?: number };
  armorBroken: { id: number; x?: number; z?: number; colorIndex?: number };
  tickingWarning: { id: number; remaining: number };
  tickingDefused: { id: number; x?: number; z?: number; remaining?: number };
  tickingExploded: { id: number; x?: number; z?: number };
  lurch: { distance: number; angle: number };
  rollerTelegraph: { id: number; x?: number; z?: number; launchIn?: number };
  rollerLaunched: { id: number; x: number; z: number; dirX?: number; dirZ?: number; speed?: number; colorIndex?: number };
  rollerDestroyed: { id: number; x?: number; z?: number; matched?: boolean };
  rollerExpired: { id: number; x?: number; z?: number };
  playerHit: { by?: string; x?: number; z?: number; knockX?: number; knockZ?: number; stun?: number };
  perfectDodge: { rollerId?: number };
  rollStart: { dirX?: number; dirZ?: number; duration?: number; distance?: number };
  rollReady: Record<string, never>;
  bossSpawned: { mk: number; hp?: number; shield?: number };
  bossShieldPop: { id: number; remaining?: number };
  bossHit: { damage?: number; weak?: boolean; hp?: number; maxHp?: number };
  bossPhase: { phase: number; previous?: number };
  bossDefeated: { mk?: number; score?: number; time?: number };
  levelStars: { level?: number; count: number };
}

type Tolerant = { on: (event: string, cb: (payload: never) => void) => unknown };

// Typed for FunEvents, tolerant of engines that do not have the event (yet).
export function onFun<K extends keyof FunEvents>(engine: object, name: K, cb: (p: FunEvents[K]) => void): () => void {
  const e = engine as Partial<Tolerant>;
  if (!FUN_EVENTS_ENABLED || typeof e.on !== "function") return noop;
  try {
    const off = (engine as Tolerant).on(name, cb as (payload: never) => void);
    return typeof off === "function" ? (off as () => void) : noop;
  } catch {
    return noop;
  }
}

const COLLECT_RATE: Record<PickupKind, number> = { rainbow: 1, freeze: 0.89, mega: 0.79, lightning: 1.12 };

// Optional live getters (spec): used for the roller hum level when present.
type RollerView = {
  getRollers?: () => readonly V2[];
  getShooter?: () => V2;
};

export function rollerGain(distance: number): number {
  const t = (Math.min(14, Math.max(2, distance)) - 2) / 12;
  return 0.5 - t * 0.35; // 0.5 near .. 0.15 far
}

export function bindFunEvents(engine: object, a: AudioManager, st: ArenaAudioState): () => void {
  let rollerTimer: ReturnType<typeof setInterval> | null = null;
  const view = engine as RollerView;
  const updateRoller = () => {
    if (st.rollers <= 0) return;
    let gain = 0.35;
    const rollers = view.getRollers?.();
    const me = view.getShooter?.();
    if (rollers && me && rollers.length > 0) {
      let best = Infinity;
      for (const r of rollers) best = Math.min(best, Math.hypot(r.x - me.x, r.z - me.z));
      gain = rollerGain(best);
    }
    a.setLoop("rollerLoop", gain);
  };
  const rollersChanged = (delta: number) => {
    st.rollers = Math.max(0, st.rollers + delta);
    if (st.rollers > 0) {
      updateRoller();
      if (!rollerTimer) rollerTimer = setInterval(updateRoller, 250);
    } else {
      a.setLoop("rollerLoop", 0);
      if (rollerTimer) clearInterval(rollerTimer);
      rollerTimer = null;
    }
  };

  const offs = [
    onFun(engine, "featureIntro", () => a.play("pickupSpawn", 0.9, 0.7)),
    onFun(engine, "pickupSpawned", () => a.play("pickupSpawn")),
    onFun(engine, "pickupCollected", ({ kind }) => a.play("pickupCollect", COLLECT_RATE[kind] ?? 1)),
    onFun(engine, "pickupBlocked", () => a.play("back", 0.8, 0.6)),
    onFun(engine, "pickupExpired", () => a.play("back", 0.7)),
    onFun(engine, "powerFired", ({ kind }) => {
      if (kind === "rainbow") a.play("rainbow");
    }),
    onFun(engine, "megaBlast", () => {
      a.play("mega");
      a.playLater("chain", 100, 1, 0.6);
      a.music.duck();
    }),
    onFun(engine, "lightningChain", ({ path }) => {
      const hops = Math.min(8, path?.length ?? 1);
      for (let i = 0; i < hops; i++) a.playLater("zap", i * 70, semitones(Math.min(12, i)));
    }),
    onFun(engine, "freezeStart", () => a.play("freeze")),
    onFun(engine, "freezeEnd", () => a.play("thaw")),
    onFun(engine, "feverStart", () => {
      st.fever = true;
      a.play("feverStart");
      a.music.setFever(true);
      a.music.duck();
    }),
    onFun(engine, "feverEnd", () => {
      st.fever = false;
      a.play("feverEnd");
      a.music.setFever(false);
    }),
    onFun(engine, "armorBroken", () => a.play("shatter", 1.15, 1.2)),
    onFun(engine, "tickingWarning", ({ remaining }) => {
      if (remaining > 2) {
        a.play("tick");
        a.playLater("tick", 500);
        return;
      }
      const rate = semitones(Math.min(5, Math.max(0, (3 - remaining) * 2.5)));
      for (let i = 0; i < 4; i++) a.playLater("tickWarn", i * 250, rate);
    }),
    onFun(engine, "tickingDefused", () => a.play("pickupCollect", 0.8, 0.8)),
    onFun(engine, "tickingExploded", () => a.play("chain")),
    onFun(engine, "lurch", () => {
      a.play("rumble");
      a.music.duck();
    }),
    onFun(engine, "rollerTelegraph", () => a.play("surge", 1.25, 0.85)),
    onFun(engine, "rollerLaunched", () => rollersChanged(1)),
    onFun(engine, "rollerDestroyed", () => {
      a.play("rollerImpact", 1);
      rollersChanged(-1);
    }),
    onFun(engine, "rollerExpired", () => rollersChanged(-1)),
    onFun(engine, "playerHit", () => {
      a.play("playerHit");
      a.play("knockback");
      a.playLater("stun", 150);
      a.music.duck();
    }),
    onFun(engine, "perfectDodge", () => a.play("star3", 1, 0.7)),
    onFun(engine, "rollStart", () => a.play("dodge")),
    onFun(engine, "rollReady", () => a.play("hover", 1.2)),
    onFun(engine, "bossSpawned", () => {
      st.shieldsPopped = 0;
      a.play("bossAppear");
      a.music.setBoss(1);
      a.music.duck();
    }),
    onFun(engine, "bossShieldPop", () => {
      a.play("shieldBreak", semitones(0.5 * st.shieldsPopped));
      st.shieldsPopped = Math.min(24, st.shieldsPopped + 1);
    }),
    onFun(engine, "bossHit", ({ weak }) => a.play("bossHit", weak ? 1.1 : 1, weak ? 1.07 : 1)),
    onFun(engine, "bossPhase", ({ phase }) => {
      a.play("bossAppear", 1.2, 0.8);
      a.playLater("rumble", 120, 1, 0.7);
      a.music.setBoss(Math.max(1, Math.min(3, phase)));
      a.music.duck();
    }),
    onFun(engine, "bossDefeated", () => {
      a.play("bossDown");
      a.music.setBoss(0);
      a.music.duck(0.4, 900);
    }),
    onFun(engine, "levelStars", ({ count }) => {
      const n = Math.max(0, Math.min(3, count));
      if (n >= 1) a.playLater("star1", 2700);
      if (n >= 2) a.playLater("star2", 3050);
      if (n >= 3) a.playLater("star3", 3400);
    }),
  ];
  return () => {
    offs.forEach((off) => off());
    if (rollerTimer) clearInterval(rollerTimer);
    rollerTimer = null;
    st.rollers = 0;
    a.setLoop("rollerLoop", 0);
  };
}
