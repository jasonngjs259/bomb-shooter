// Headless check of the fun-pass event -> sound map (src/audio/funEvents.ts)
// against the REAL ArenaEngine: every event is fired through the engine's
// debug hooks / normal play, and the sounds the binding requested are read
// from a spied AudioManager on a fake player backend (no expo-audio).
// Run: npx tsx --tsconfig scripts/smoke/tsconfig.json scripts/arena-fun-audio.ts

import { AudioManager } from "../src/audio/AudioManager";
import { bindFunEvents, swapOrDeny, uiFunSounds } from "../src/audio/funEvents";
import { newArenaAudioState } from "../src/audio/sfxMap";
import type { SoundId } from "../src/audio/sounds";
import { AudioBackend, PlayerLike } from "../src/audio/types";
import { ArenaEngine, ArenaEvents } from "../src/game/arena";

let checks = 0;
let failures = 0;
const ok = (cond: unknown, msg: string) => {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  FAIL ${msg}`);
  }
};

const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

class FakePlayer implements PlayerLike {
  volume = 1;
  muted = false;
  loop = false;
  shouldCorrectPitch = true;
  playing = false;
  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seekTo() {
    return Promise.resolve();
  }
  setPlaybackRate() {}
  release() {}
}

interface Req { id: SoundId; rate: number; gain: number; delay: number; seq: number }
let seq = 0;

function rig() {
  const t = { now: 1000 };
  const backend: AudioBackend = {
    voiceCap: 12, volumeControl: true, maskLoops: false, needsUnlock: false, now: () => t.now,
    requestFrame: () => 1, cancelFrame: () => undefined, createPlayer: () => new FakePlayer(),
  };
  const a = new AudioManager(backend);
  a.init();
  const reqs: Req[] = [];
  const loops: { id: SoundId; gain: number }[] = [];
  const ducks: { depth: number; ms: number }[] = [];
  const play = a.play.bind(a);
  const later = a.playLater.bind(a);
  const setLoop = a.setLoop.bind(a);
  const duck = a.music.duck.bind(a.music);
  a.play = (id, rate = 1, gain = 1) => {
    reqs.push({ id, rate, gain, delay: 0, seq: seq++ });
    return play(id, rate, gain);
  };
  a.playLater = (id, delayMs, rate = 1, gain = 1) => {
    reqs.push({ id, rate, gain, delay: delayMs, seq: seq++ });
    return later(id, delayMs, rate, gain);
  };
  a.setLoop = (id, gain) => {
    loops.push({ id, gain });
    setLoop(id, gain);
  };
  a.music.duck = (depth = 0.5, ms = 400) => {
    ducks.push({ depth, ms });
    duck(depth, ms);
  };
  return { a, t, reqs, loops, ducks };
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function session(level: number, seed = 3) {
  const r = rig();
  const e = new ArenaEngine({ random: mulberry(seed) });
  const st = newArenaAudioState();
  const seen = new Map<keyof ArenaEvents, unknown[]>();
  const names: (keyof ArenaEvents)[] = [
    "pickupSpawned", "pickupLanded", "pickupCollected", "pickupBlocked", "pickupExpired", "powerFired", "megaBlast", "lightningChain",
    "freezeStart", "freezeEnd", "feverChanged", "feverStart", "feverEnd", "slowMo", "armorBroken", "tickingArmed", "tickingWarning",
    "tickingDefused", "tickingExploded", "lurch", "rollerTelegraph", "rollerLaunched", "rollerDestroyed", "rollerExpired", "playerHit",
    "perfectDodge", "rollStart", "rollEnd", "rollReady", "bossSpawned", "bossShieldPop", "bossShieldRegrow", "bossHit", "bossWeakColor",
    "bossPhase", "bossDefeated",
  ];
  const mark = r.reqs.length;
  const firstReq = new Map<string, number>();
  for (const n of names) {
    e.on(n, (p: unknown) => {
      if (!seen.has(n)) seen.set(n, []);
      seen.get(n)!.push(p);
      if (!firstReq.has(n)) firstReq.set(n, seq);
    });
  }
  // after the spies above, so `after(name)` includes the binding's own sounds
  const off = bindFunEvents(e, r.a, st);
  e.newGame({ level });
  const step = (sec: number, each?: (i: number) => void) => {
    const n = Math.round(sec * 30);
    for (let i = 0; i < n && e.getPhase() === "playing"; i++) {
      each?.(i);
      e.update((1 / 30) * e.getTimeScale());
      r.t.now += 1000 / 30;
    }
  };
  // Game time in 0.1 s slices with ~real-time gaps, so the binding's
  // real-time polls (tick cadence, roller loop) run in between.
  const stepReal = async (sec: number) => {
    for (let k = 0; k < Math.round(sec * 10) && e.getPhase() === "playing"; k++) {
      step(0.1);
      await sleep(105);
    }
  };
  // Sounds requested since the event first fired.
  const after = (n: keyof ArenaEvents) => r.reqs.filter((q) => q.seq >= (firstReq.get(n) ?? Infinity));
  return { ...r, e, st, off, seen, step, stepReal, after, mark };
}

const nearestBomb = (e: ArenaEngine) => {
  const me = e.getShooter();
  let best: { x: number; z: number } | null = null;
  let d = Infinity;
  for (const b of e.getBombs()) {
    if (b.state !== "idle") continue;
    const k = Math.hypot(b.x - me.x, b.z - me.z);
    if (k < d) {
      d = k;
      best = b;
    }
  }
  return best;
};

const has = (reqs: Req[], id: SoundId, pred: (q: Req) => boolean = () => true) => reqs.some((q) => q.id === id && pred(q));

async function main() {
console.log("- pickups (debugSpawnPickup)");
{
  const s = session(4);
  const me = s.e.getShooter();
  s.reqs.length = 0;
  s.e.debugSpawnPickup("freeze", me.x + 3, me.z); // away from the player: lands
  ok(has(s.reqs, "pickupSpawn"), "pickupSpawned -> pickup_spawn");
  ok(has(s.reqs, "stick", (q) => q.rate > 1.2 && q.gain < 1), "pickupLanded -> soft landing thud");
  s.reqs.length = 0;
  s.e.debugSpawnPickup("mega", me.x, me.z);
  s.step(0.2);
  ok(s.seen.has("pickupCollected"), "engine: pickupCollected");
  ok(has(s.reqs, "pickupCollect", (q) => Math.abs(q.rate - 0.79) < 1e-6), "pickupCollected (mega) -> collect at rate 0.79 (kind)");
  ok(s.e.getPowerSlot() === "mega", "mega loaded");
  // swap denied while a POWER is loaded
  s.reqs.length = 0;
  ok(swapOrDeny(s.e, s.a) === false, "swapOrDeny returns false with a power loaded");
  ok(has(s.reqs, "back", (q) => q.rate < 1), "denied swap -> ui_back blip");
  // blocked: another shot-type pickup under the player while the slot is full
  s.reqs.length = 0;
  s.e.debugSpawnPickup("rainbow", s.e.getShooter().x, s.e.getShooter().z);
  s.step(0.3);
  ok(s.seen.has("pickupBlocked"), "engine: pickupBlocked");
  ok(has(s.reqs, "back", (q) => Math.abs(q.rate - 0.8) < 1e-6), "pickupBlocked -> ui_back 0.8");
  // fire the mega: powerFired (no rainbow sound), megaBlast -> mega + chain + duck
  s.reqs.length = 0;
  s.ducks.length = 0;
  const near = nearestBomb(s.e);
  if (near) s.e.aimAt(near.x, near.z);
  const fired = s.e.fire();
  s.step(2);
  ok(fired, `fire() with mega loaded (phase ${s.e.getPhase()}, slot ${s.e.getPowerSlot()})`);
  ok(s.seen.has("powerFired") && s.seen.has("megaBlast"), `engine: powerFired + megaBlast (${[...s.seen.keys()].join(",")}; shots ${s.e.getShots().length})`);
  ok(!has(s.reqs, "rainbow"), "powerFired (mega) -> no rainbow sound");
  ok(has(s.reqs, "mega") && has(s.reqs, "chain", (q) => q.delay === 100), "megaBlast -> mega_blast + chain 100 ms");
  ok(s.ducks.length > 0, "megaBlast ducks the music");
  // freeze: collect -> freeze, 5 s later thaw
  s.reqs.length = 0;
  s.e.debugSpawnPickup("freeze", s.e.getShooter().x, s.e.getShooter().z);
  s.step(0.2);
  ok(s.seen.has("freezeStart") && has(s.reqs, "freeze"), "freezeStart -> freeze");
  s.step(6);
  ok(s.seen.has("freezeEnd") && has(s.reqs, "thaw"), "freezeEnd -> thaw");
  // expiry: a pickup far from the player, 10 s
  s.reqs.length = 0;
  const p = s.e.getShooter();
  s.e.debugSpawnPickup("freeze", p.x > 0 ? p.x - 3.5 : p.x + 3.5, p.z);
  s.step(11);
  ok(s.seen.has("pickupExpired") && has(s.reqs, "back", (q) => Math.abs(q.rate - 0.7) < 1e-6), "pickupExpired -> ui_back 0.7");
  s.off();
}

console.log("- rainbow + lightning (powerFired, lightningChain hop spacing)");
{
  const s = session(4, 5);
  const me = s.e.getShooter();
  s.e.debugSpawnPickup("rainbow", me.x, me.z);
  s.step(0.2);
  s.reqs.length = 0;
  s.e.fire();
  ok(has(s.reqs, "rainbow"), "powerFired (rainbow) -> rainbow_activate");
  s.step(2);
  s.e.debugSpawnPickup("lightning", s.e.getShooter().x, s.e.getShooter().z);
  s.step(0.2);
  let fired = false;
  for (let k = 0; k < 24 && !s.seen.has("lightningChain"); k++) {
    s.e.setYaw((k / 24) * Math.PI * 2);
    if (s.e.getPowerSlot() === "lightning") fired = s.e.fire() || fired;
    s.step(1.2);
  }
  ok(s.seen.has("lightningChain"), "engine: lightningChain");
  const ev = s.seen.get("lightningChain")?.[0] as ArenaEvents["lightningChain"] | undefined;
  if (ev) {
    const zaps = s.after("lightningChain").filter((q) => q.id === "zap");
    const n = Math.min(18, ev.path.length);
    ok(zaps.length >= n, `one zap per hop (${zaps.length} for ${ev.path.length} hops)`);
    const ms = Math.round(ev.hop * 1000);
    ok(zaps.slice(0, n).every((q, i) => q.delay === i * ms), `zaps spaced hop = ${ms} ms apart`);
    ok(n < 2 || zaps[1].rate > zaps[0].rate, "zap pitch rises per hop");
  }
  s.off();
}

console.log("- fever (debugSetFever) + slowMo");
{
  const s = session(2);
  s.reqs.length = 0;
  s.e.debugSetFever(60);
  // feverChanged with delta 0 (debug) makes no blip; real fills do (throttled)
  ok(!has(s.reqs, "hover"), "feverChanged delta 0 -> silent");
  s.e.debugSetFever(100);
  s.step(0.2);
  ok(s.seen.has("feverStart") && has(s.reqs, "feverStart"), "feverStart -> fever_start");
  ok(s.st.fever && s.a.music.state.fever, "feverStart -> fever music");
  // pop during fever -> slowMo -> duck
  s.ducks.length = 0;
  for (let k = 0; k < 40 && !s.seen.has("slowMo") && s.e.getFever().active; k++) {
    s.e.setYaw((k / 40) * Math.PI * 2);
    s.e.fire();
    s.step(0.2);
  }
  ok(s.seen.has("slowMo"), "engine: slowMo on the first fever pop");
  const sm = s.seen.get("slowMo")?.[0] as ArenaEvents["slowMo"] | undefined;
  if (sm) ok(s.ducks.some((d) => Math.abs(d.ms - (sm.realDuration + sm.ramp) * 1000) < 1), "slowMo -> music duck for its real duration");
  s.step(8);
  ok(s.seen.has("feverEnd") && has(s.after("feverEnd"), "feverEnd") && !s.a.music.state.fever, "feverEnd -> fever_end, music back");
  // throttled fill blips from real pops after the lockout
  s.reqs.length = 0;
  for (let k = 0; k < 60; k++) {
    s.e.setYaw((k / 60) * Math.PI * 2);
    s.e.fire();
    s.step(0.4);
  }
  const blips = s.reqs.filter((q) => q.id === "hover");
  const fills = (s.seen.get("feverChanged") as ArenaEvents["feverChanged"][]).filter((f) => f.delta > 0).length;
  ok(fills === 0 || blips.length > 0, `feverChanged fills -> blips (${blips.length} for ${fills} fills)`);
  s.off();
}

console.log("- ticking (debugArmTicking) + lurch");
{
  const s = session(4, 11);
  s.reqs.length = 0;
  ok(s.e.debugArmTicking(), "debugArmTicking");
  ok(has(s.reqs, "tickWarn", (q) => q.rate < 1), "tickingArmed -> tick_warning (0.8)");
  await s.stepReal(3.2);
  const early = s.reqs.filter((q) => q.id === "tick" && q.delay === 0).length;
  ok(early >= 2 && early <= 5, `1 tick per game second while > 5 s (own cadence: ${early} in 3.2 s)`);
  s.step(s.e.getLevelDef().tickTimer - 6); // into the last 5 s
  ok(s.seen.has("tickingWarning") && has(s.after("tickingWarning"), "tick"), "tickingWarning -> tick");
  s.step(5);
  ok(has(s.after("tickingWarning"), "tickWarn", (q) => q.rate > 1), "last 2 s -> pitched tick_warning");
  ok(s.seen.has("tickingExploded") && has(s.after("tickingExploded"), "chain"), "tickingExploded -> chain");
  ok(s.seen.has("lurch") && has(s.after("lurch"), "rumble"), "lurch -> rumble");
  // defuse: Mega on an armed ticking bomb
  s.e.debugArmTicking();
  const tb = s.e.getBombs().find((b) => b.armed && b.state === "idle");
  if (tb) {
    s.e.aimAt(tb.x, tb.z);
    s.e.debugSpawnPickup("mega", s.e.getShooter().x, s.e.getShooter().z);
    s.step(0.2);
    s.e.aimAt(tb.x, tb.z);
    s.e.fire();
    s.step(2);
    ok(s.seen.has("tickingDefused") && has(s.after("tickingDefused"), "pickupCollect", (q) => q.rate === 0.8), "tickingDefused -> collect (0.8)");
  }
  s.off();
}

console.log("- armored (power shots strip armor)");
{
  const s = session(2, 7);
  for (let k = 0; k < 30 && !s.seen.has("armorBroken"); k++) {
    const ab = s.e.getBombs().find((b) => b.kind === "armored" && b.armor === 1 && b.state === "idle");
    if (!ab) break;
    s.e.aimAt(ab.x, ab.z);
    if (!s.e.getPowerSlot()) s.e.debugSpawnPickup("rainbow", s.e.getShooter().x, s.e.getShooter().z);
    s.step(0.1);
    s.e.aimAt(ab.x, ab.z);
    s.e.fire();
    s.step(1.5);
  }
  ok(s.seen.has("armorBroken") && has(s.after("armorBroken"), "shatter", (q) => q.rate > 1.1), "armorBroken -> shatter 1.15");
  s.off();
}

console.log("- rollers + roll (debugLaunchRoller, roll)");
{
  const s = session(5, 9);
  s.loops.length = 0;
  s.reqs.length = 0;
  ok(s.e.debugLaunchRoller(undefined, 0.7) >= 0, "debugLaunchRoller");
  ok(has(s.reqs, "surge", (q) => q.rate > 1.2), "rollerTelegraph -> surge_alarm 1.25");
  s.step(1.3);
  ok(s.seen.has("rollerLaunched"), "engine: rollerLaunched");
  ok(s.loops.some((l) => l.id === "rollerLoop" && l.gain > 0), "rollerLaunched -> roller loop on");
  ok(s.st.rollers >= 1, "audio state tracks the live roller");
  // stand still: it hits the player
  s.step(8);
  ok(s.seen.has("playerHit"), "engine: playerHit (standing still)");
  const hit = s.after("playerHit");
  ok(has(hit, "playerHit") && has(hit, "knockback") && has(hit, "stun", (q) => q.delay === 150), "playerHit -> hit + knockback + stun");
  ok(s.seen.has("rollerDestroyed") && has(s.after("rollerDestroyed"), "rollerImpact"), "rollerDestroyed -> roller_impact");
  await s.stepReal(0.4);
  ok(s.loops[s.loops.length - 1]?.gain === 0 && s.st.rollers === 0, "roller loop off once no roller is live (poll)");
  // roll: start, end, ready
  s.step(1.5);
  s.reqs.length = 0;
  ok(s.e.roll(1, 0), "roll()");
  ok(has(s.reqs, "dodge"), "rollStart -> dodge whoosh");
  s.step(0.7);
  ok(s.seen.has("rollEnd") && has(s.after("rollEnd"), "stick", (q) => q.rate < 1), "rollEnd -> landing scuff");
  s.step(1.5);
  ok(s.seen.has("rollReady") && has(s.after("rollReady"), "hover", (q) => q.rate > 1.1), "rollReady -> ui_hover 1.2");
  s.off();
  ok(s.loops[s.loops.length - 1]?.gain === 0 && s.st.rollers === 0, "unbind turns the roller loop off");
}

console.log("- perfect dodge (roll across a roller inside the i-frames)");
{
  const s = session(5, 9);
  for (let tries = 0; tries < 8 && !s.seen.has("perfectDodge"); tries++) {
    s.e.debugLaunchRoller();
    let rolled = false;
    for (let i = 0; i < 240 && !rolled; i++) {
      const me = s.e.getShooter();
      const r = s.e.getRollers()[0];
      if (r && Math.hypot(r.x - me.x, r.z - me.z) < 1.0 + 0.03 * tries) rolled = s.e.roll(-r.dirZ, r.dirX);
      s.step(1 / 30);
    }
    s.step(3);
  }
  ok(s.seen.has("perfectDodge"), "engine: perfectDodge");
  ok(has(s.after("perfectDodge"), "star3", (q) => q.gain < 1), "perfectDodge -> star_3 (soft)");
  s.off();
}

console.log("- boss (L3: spawn, weak colour, regrow, hit, phases, defeat)");
{
  const s = session(3, 13);
  ok(s.seen.has("bossSpawned") && has(s.reqs, "bossAppear"), "bossSpawned -> boss_appear");
  ok(s.a.music.state.boss === 1, "bossSpawned -> boss music");
  s.step(7);
  ok(s.seen.has("bossWeakColor") && has(s.after("bossWeakColor"), "swap", (q) => q.rate > 1.2), "bossWeakColor -> soft blip");
  // Mega at the core: shield pops + a core hit
  const boss = s.e.getBoss()!;
  s.e.debugSpawnPickup("mega", s.e.getShooter().x, s.e.getShooter().z);
  s.step(0.2);
  s.e.aimAt(boss.x, boss.z);
  s.e.fire();
  s.step(2);
  ok(s.seen.has("bossShieldPop") && has(s.after("bossShieldPop"), "shieldBreak"), "bossShieldPop -> shield_break");
  if (s.seen.has("bossHit")) ok(has(s.after("bossHit"), "bossHit") || has(s.after("bossHit"), "deflect"), "bossHit -> boss_hit");
  s.step(9);
  ok(s.seen.has("bossShieldRegrow") && has(s.after("bossShieldRegrow"), "pickupSpawn", (q) => q.rate < 1), "bossShieldRegrow -> grow blip");
  s.ducks.length = 0;
  s.e.debugSetBossHp(Math.floor(s.e.getBoss()!.maxHp * 0.5));
  ok(s.seen.has("bossPhase") && has(s.after("bossPhase"), "bossAppear", (q) => q.rate > 1.1), "bossPhase -> boss_appear 1.2");
  ok(s.a.music.state.boss === 2 && s.ducks.length > 0, "bossPhase -> phase music + duck");
  s.e.debugSetBossHp(0);
  ok(s.seen.has("bossDefeated") && has(s.after("bossDefeated"), "bossDown"), "bossDefeated -> boss_defeated");
  ok(s.a.music.state.boss === 0, "bossDefeated -> boss music off");
  s.off();
}

console.log("- UI sounds (stars, unlock, tip)");
{
  const r = rig();
  uiFunSounds.star(r.a, 1);
  uiFunSounds.star(r.a, 2);
  uiFunSounds.star(r.a, 3);
  uiFunSounds.unlock(r.a);
  uiFunSounds.tip(r.a);
  ok(["star1", "star2", "star3"].every((id) => has(r.reqs, id as SoundId)), "star_1/2/3");
  ok(has(r.reqs, "rainbow") && has(r.reqs, "star3", (q) => q.delay > 0), "unlock chime");
  ok(has(r.reqs, "pickupSpawn"), "tip chime");
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
}

void main();
