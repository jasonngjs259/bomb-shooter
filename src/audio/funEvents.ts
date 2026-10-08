// Sounds for the Arena FUN PASS events, typed against the engine's real
// ArenaEvents (src/game/arena/API.md). The classic arena events live in
// sfxMap.ts. Stars, unlocks and feature-tip chimes are played by the UI
// (end card / tips), not from engine events, so they line up with what the
// player sees.
//
// Event             Sound (rate / gain)                               Music / other
// pickupSpawned     pickup_spawn
// pickupLanded      stick (1.3, 0.5): soft landing thud
// pickupCollected   pickup_collect, rate by kind (rainbow 1, freeze 0.89,
//                   mega 0.79, lightning 1.12)
// pickupBlocked     ui_back (0.8, 0.6)
// pickupExpired     ui_back (0.7)
// powerFired        rainbow: rainbow_activate (mega / lightning sound on contact)
// megaBlast         mega_blast + chain (100 ms, 0.6)                  duck
// lightningChain    lightning_zap per path entry, spaced `hop` s apart,
//                   +1 semitone per hop (cap +12)
// freezeStart/End   freeze / thaw
// feverChanged      rising hover blip on fills (+, not in fever), >= 350 ms apart
// feverStart        fever_start                                       fever music in, duck
// feverEnd          fever_end                                         fever music out
// slowMo            -                                                 duck to `scale`-ish for realDuration + ramp
// armorBroken       shatter (1.15, 1.2)
// tickingArmed      tick_warning (0.8); then 1 tick per game second while
//                   the nearest armed timer is > 5 s (polled from getBombs)
// tickingWarning    remaining > 2: tick x2 per s; <= 2: tick_warning x4 per s, +2.5..+5 semitones
// tickingDefused    pickup_collect (0.8, 0.8)
// tickingExploded   chain
// lurch             rumble                                            duck
// rollerTelegraph   surge_alarm (1.25, 0.85)
// rollerLaunched    roller_loop on (0.15-0.5 by nearest roller distance)
// rollerDestroyed   roller_impact; loop off when getRollers() is empty
// rollerExpired     loop off when getRollers() is empty
// playerHit         player_hit + knockback_whoosh + stun (150 ms)    duck
// perfectDodge      star_3 (1.0, 0.7)
// rollStart         dodge_whoosh
// rollEnd           stick (0.8, 0.35): landing scuff
// rollReady         ui_hover (1.2)
// bossSpawned       boss_appear                                       boss music, duck
// bossShieldPop     boss_shield_break, +0.5 semitone per shield popped
// bossShieldRegrow  pickup_spawn (0.7, 0.45)
// bossWeakColor     swap (1.25, 0.5)
// bossHit           boss_hit (weak: 1.1, louder)
// bossPhase         boss_appear (1.2, 0.8) + rumble                   boss phase music, duck
// bossDefeated      boss_defeated                                     boss music off, duck
// swapBomb() false  ui_back (0.7, 0.6) "denied" blip (swapOrDeny)

import type { ArenaEngine } from "../game/arena/ArenaEngine";
import type { ArenaEngineView, PickupKind } from "../game/arena";
import type { AudioManager } from "./AudioManager";
import type { ArenaAudioState } from "./sfxMap";
import { semitones } from "./sounds";

const COLLECT_RATE: Record<PickupKind, number> = { rainbow: 1, freeze: 0.89, mega: 0.79, lightning: 1.12 };
const FEVER_BLIP_GAP_MS = 350;
const TICK_POLL_MS = 100;
const MAX_HOPS = 18;

export function rollerGain(distance: number): number {
  const t = (Math.min(14, Math.max(2, distance)) - 2) / 12;
  return 0.5 - t * 0.35; // 0.5 near .. 0.15 far
}

// Swap, or the soft "denied" blip when the engine refuses (POWER loaded).
export function swapOrDeny(engine: Pick<ArenaEngine, "swapBomb" | "getPhase">, a: AudioManager): boolean {
  if (engine.swapBomb()) return true;
  if (engine.getPhase() === "playing") a.play("back", 0.7, 0.6);
  return false;
}

// UI-side sounds (end card, HANGAR, tips).
export const uiFunSounds = {
  star: (a: AudioManager, n: 1 | 2 | 3) => a.play(n === 1 ? "star1" : n === 2 ? "star2" : "star3"),
  unlock: (a: AudioManager) => {
    a.play("rainbow", 1.12, 0.9);
    a.playLater("star3", 180, 1.5, 0.6);
  },
  tip: (a: AudioManager) => a.play("pickupSpawn", 0.9, 0.7),
};

export function bindFunEvents(engine: ArenaEngineView, a: AudioManager, st: ArenaAudioState): () => void {
  let rollerTimer: ReturnType<typeof setInterval> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  const armed = new Set<number>();
  let lastTickSecond = -1;
  let lastFeverBlip = -Infinity;

  const nearestRoller = () => {
    const rollers = engine.getRollers();
    const me = engine.getShooter();
    let best = Infinity;
    for (const r of rollers) best = Math.min(best, Math.hypot(r.x - me.x, r.z - me.z));
    return best;
  };
  const updateRoller = () => {
    st.rollers = engine.getRollers().length;
    if (st.rollers > 0) {
      a.setLoop("rollerLoop", rollerGain(nearestRoller()));
      return;
    }
    a.setLoop("rollerLoop", 0);
    if (rollerTimer) clearInterval(rollerTimer);
    rollerTimer = null;
  };
  // Launch: the loop starts at once (even if the engine lists the roller
  // after emitting); the 250 ms poll follows distance and stops it at 0.
  const rollerLaunched = () => {
    st.rollers = Math.max(1, engine.getRollers().length);
    const d = nearestRoller();
    a.setLoop("rollerLoop", Number.isFinite(d) ? rollerGain(d) : 0.35);
    if (!rollerTimer) rollerTimer = setInterval(updateRoller, 250);
  };
  const rollersChanged = () => {
    if (rollerTimer) return; // the poll notices the change
    updateRoller();
  };

  // 1 tick per game second while the soonest armed timer is above 5 s (the
  // engine's tickingWarning takes over from 5). Game time, so Freeze and
  // pause stop it.
  const pollTicks = () => {
    let soonest = Infinity;
    if (armed.size > 0) {
      for (const b of engine.getBombs()) {
        if (!armed.has(b.id)) continue;
        if (b.state !== "idle" || !b.armed || b.timer === null) armed.delete(b.id);
        else soonest = Math.min(soonest, b.timer);
      }
    }
    if (armed.size === 0 || engine.getPhase() !== "playing") {
      stopTicks();
      return;
    }
    const sec = Math.ceil(soonest);
    if (soonest > 5 && sec !== lastTickSecond) a.play("tick", 1, 0.8);
    lastTickSecond = sec;
  };
  const stopTicks = () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    lastTickSecond = -1;
  };
  const untrack = (id: number) => {
    armed.delete(id);
    if (armed.size === 0) stopTicks();
  };

  const offs = [
    engine.on("pickupSpawned", () => a.play("pickupSpawn")),
    engine.on("pickupLanded", () => a.play("stick", 1.3, 0.5)),
    engine.on("pickupCollected", ({ kind }) => a.play("pickupCollect", COLLECT_RATE[kind])),
    engine.on("pickupBlocked", () => a.play("back", 0.8, 0.6)),
    engine.on("pickupExpired", () => a.play("back", 0.7)),
    engine.on("powerFired", ({ kind }) => {
      if (kind === "rainbow") a.play("rainbow");
    }),
    engine.on("megaBlast", () => {
      a.play("mega");
      a.playLater("chain", 100, 1, 0.6);
      a.music.duck();
    }),
    engine.on("lightningChain", ({ path, hop }) => {
      const n = Math.min(MAX_HOPS, path.length);
      const gap = Math.max(0, hop) * 1000;
      for (let i = 0; i < n; i++) {
        const rate = semitones(Math.min(12, i));
        if (i === 0) a.play("zap", rate);
        else a.playLater("zap", i * gap, rate);
      }
    }),
    engine.on("freezeStart", () => a.play("freeze")),
    engine.on("freezeEnd", () => a.play("thaw")),
    engine.on("feverChanged", ({ meter, delta }) => {
      if (delta <= 0 || st.fever || engine.getFever().active) return;
      const now = a.backend.now();
      if (now - lastFeverBlip < FEVER_BLIP_GAP_MS) return;
      lastFeverBlip = now;
      a.play("hover", 0.9 + Math.min(1, meter / 100) * 0.6, 0.6);
    }),
    engine.on("feverStart", () => {
      st.fever = true;
      a.play("feverStart");
      a.music.setFever(true);
      a.music.duck();
    }),
    engine.on("feverEnd", () => {
      st.fever = false;
      a.play("feverEnd");
      a.music.setFever(false);
    }),
    engine.on("slowMo", ({ scale, realDuration, ramp }) => {
      a.music.duck(Math.max(0.35, Math.min(0.8, 0.4 + scale)), (realDuration + ramp) * 1000);
    }),
    engine.on("armorBroken", () => a.play("shatter", 1.15, 1.2)),
    engine.on("tickingArmed", ({ id }) => {
      a.play("tickWarn", 0.8);
      armed.add(id);
      if (!tickTimer) tickTimer = setInterval(pollTicks, TICK_POLL_MS);
    }),
    engine.on("tickingWarning", ({ remaining }) => {
      if (remaining > 2) {
        a.play("tick");
        a.playLater("tick", 500);
        return;
      }
      const rate = semitones(Math.min(5, Math.max(0, (3 - remaining) * 2.5)));
      for (let i = 0; i < 4; i++) a.playLater("tickWarn", i * 250, rate);
    }),
    engine.on("tickingDefused", ({ id }) => {
      untrack(id);
      a.play("pickupCollect", 0.8, 0.8);
    }),
    engine.on("tickingExploded", ({ id }) => {
      untrack(id);
      a.play("chain");
    }),
    engine.on("lurch", () => {
      a.play("rumble");
      a.music.duck();
    }),
    engine.on("rollerTelegraph", () => a.play("surge", 1.25, 0.85)),
    engine.on("rollerLaunched", rollerLaunched),
    engine.on("rollerDestroyed", () => {
      a.play("rollerImpact", 1);
      rollersChanged();
    }),
    engine.on("rollerExpired", rollersChanged),
    engine.on("playerHit", () => {
      a.play("playerHit");
      a.play("knockback");
      a.playLater("stun", 150);
      a.music.duck();
    }),
    engine.on("perfectDodge", () => a.play("star3", 1, 0.7)),
    engine.on("rollStart", () => a.play("dodge")),
    engine.on("rollEnd", () => a.play("stick", 0.8, 0.35)),
    engine.on("rollReady", () => a.play("hover", 1.2)),
    engine.on("bossSpawned", () => {
      st.shieldsPopped = 0;
      a.play("bossAppear");
      a.music.setBoss(1);
      a.music.duck();
    }),
    engine.on("bossShieldPop", () => {
      a.play("shieldBreak", semitones(0.5 * st.shieldsPopped));
      st.shieldsPopped = Math.min(24, st.shieldsPopped + 1);
    }),
    engine.on("bossShieldRegrow", () => a.play("pickupSpawn", 0.7, 0.45)),
    engine.on("bossWeakColor", () => a.play("swap", 1.25, 0.5)),
    engine.on("bossHit", ({ weak, damage }) => {
      if (damage <= 0) a.play("deflect", 0.8, 0.6);
      else a.play("bossHit", weak ? 1.1 : 1, weak ? 1.07 : 1);
    }),
    engine.on("bossPhase", ({ phase }) => {
      a.play("bossAppear", 1.2, 0.8);
      a.playLater("rumble", 120, 1, 0.7);
      a.music.setBoss(phase);
      a.music.duck();
    }),
    engine.on("bossDefeated", () => {
      a.play("bossDown");
      a.music.setBoss(0);
      a.music.duck(0.4, 900);
    }),
    engine.on("phaseChanged", ({ phase }) => {
      if (phase === "playing") return;
      armed.clear();
      stopTicks();
      updateRoller();
    }),
  ];
  return () => {
    offs.forEach((off) => off());
    if (rollerTimer) clearInterval(rollerTimer);
    rollerTimer = null;
    stopTicks();
    armed.clear();
    st.rollers = 0;
    a.setLoop("rollerLoop", 0);
  };
}
