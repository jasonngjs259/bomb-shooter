// Sound table: every logical sound, its file(s), mix volume, priority, pool
// size and retrigger limits. Plain data (no requires) so the AudioManager can
// be tested headlessly. Priorities follow the game spec (section 5): 1 is the
// most important; a full voice cap steals the oldest voice with the lowest
// priority, never a more important one.
//
// Pool sizes keep the total player count at 56 on native (Android crashes
// near 100 media sessions) and 60 on web (two players per masked loop).

export type MusicId = "menu" | "game" | "fever";

export interface MusicDef {
  file: string;
  durMs: number; // loop length (web seam masking)
  vol: number; // mix level before the music volume
}

export const MUSIC: Record<MusicId, MusicDef> = {
  menu: { file: "music_menu_loop", durMs: 12800, vol: 0.7 },
  game: { file: "music_game_loop", durMs: 98000, vol: 0.62 },
  fever: { file: "music_fever_loop", durMs: 25260, vol: 0.7 },
};

export interface SoundDef {
  // Files; pool player i plays files[i % files.length] (pop variants).
  files: readonly string[];
  vol: number; // 0..1 before the SFX and master volumes
  pri: number; // 1 = highest
  voices: number; // pooled players created once
  durMs: number; // how long a voice counts against the cap
  gapMs?: number; // same-id retrigger closer than this is dropped (default 40)
  burst?: { count: number; windowMs: number }; // at most count plays per window
  loop?: boolean; // looping sound (roller), driven through startLoop / setLoopGain
}

const s = (
  files: string | readonly string[],
  vol: number,
  pri: number,
  voices: number,
  durMs: number,
  extra: Partial<SoundDef> = {}
): SoundDef => ({ files: typeof files === "string" ? [files] : files, vol, pri, voices, durMs, ...extra });

export const SOUNDS = {
  // shooting + impacts
  shoot: s("sfx_bomb_shoot", 0.45, 3, 3, 240, { burst: { count: 3, windowMs: 120 } }),
  stick: s("sfx_bomb_stick", 0.4, 4, 1, 520),
  pop: s(["sfx_pop_1", "sfx_pop_2", "sfx_pop_3"], 0.7, 2, 3, 600, { gapMs: 15, burst: { count: 3, windowMs: 50 } }),
  chain: s("sfx_chain_explosion", 0.8, 2, 1, 1600, { gapMs: 120 }),
  shatter: s("sfx_shatter", 0.5, 3, 1, 430),
  deflect: s("sfx_deflect", 0.55, 3, 1, 380),
  knockback: s("sfx_knockback_whoosh", 0.6, 2, 1, 420),
  // threats
  surge: s("sfx_surge_alarm", 0.7, 1, 1, 950, { gapMs: 600 }),
  tick: s("sfx_bomb_tick", 0.35, 3, 1, 60, { gapMs: 60 }),
  tickWarn: s("sfx_bomb_tick_warning", 0.4, 3, 1, 180, { gapMs: 60 }),
  rumble: s("sfx_wall_rumble", 0.85, 1, 1, 1300, { gapMs: 300 }),
  rollerLoop: s("sfx_roller_loop", 1, 3, 1, 1500, { loop: true }), // level 0.15-0.5 by distance
  rollerImpact: s("sfx_roller_impact", 0.6, 2, 1, 490),
  // player
  playerHit: s("sfx_player_hit", 0.8, 1, 1, 600),
  stun: s("sfx_player_stun", 0.55, 2, 1, 600),
  dodge: s("sfx_dodge_whoosh", 0.5, 3, 1, 270),
  // pickups + powers
  pickupSpawn: s("sfx_pickup_spawn", 0.5, 3, 1, 600),
  pickupCollect: s("sfx_pickup_collect", 0.75, 1, 1, 190),
  rainbow: s("sfx_rainbow_activate", 0.6, 2, 1, 900),
  mega: s("sfx_mega_blast", 0.9, 1, 1, 1000),
  freeze: s("sfx_freeze", 0.7, 1, 1, 840),
  thaw: s("sfx_thaw", 0.5, 2, 1, 680),
  zap: s("sfx_lightning_zap", 0.35, 3, 1, 590, { gapMs: 30 }),
  // fever
  feverStart: s("sfx_fever_start", 0.85, 1, 1, 1800),
  feverEnd: s("sfx_fever_end", 0.6, 2, 1, 800),
  // boss
  bossAppear: s("sfx_boss_appear", 0.9, 1, 1, 2000),
  bossHit: s("sfx_boss_hit", 0.75, 2, 1, 630),
  shieldBreak: s("sfx_boss_shield_break", 0.55, 3, 1, 780),
  bossDown: s("sfx_boss_defeated", 1.0, 1, 1, 2000),
  // voice
  vReady: s("voice_ready", 0.8, 1, 1, 660, { gapMs: 500 }),
  vGo: s("voice_go", 0.8, 1, 1, 630, { gapMs: 500 }),
  vWin: s("voice_you_win", 0.8, 1, 1, 980),
  vGameOver: s("voice_game_over", 0.8, 1, 1, 1350),
  // results
  levelClear: s("sfx_level_clear", 0.8, 1, 1, 800),
  gameOver: s("sfx_game_over", 0.8, 1, 1, 1720),
  star1: s("sfx_star_1", 0.7, 1, 1, 700),
  star2: s("sfx_star_2", 0.7, 1, 1, 700),
  star3: s("sfx_star_3", 0.7, 1, 1, 700),
  // UI
  click: s("sfx_ui_click", 0.3, 1, 1, 100, { gapMs: 30 }),
  hover: s("sfx_ui_hover", 0.15, 5, 1, 40, { gapMs: 60 }),
  back: s("sfx_ui_back", 0.3, 1, 1, 60, { gapMs: 30 }),
  swap: s("sfx_swap", 0.3, 5, 1, 500, { gapMs: 60 }),
  // combo notes (pre-pitched major pentatonic) + the blip for combos past 6
  combo1: s("sfx_combo_1", 0.45, 2, 1, 200),
  combo2: s("sfx_combo_2", 0.45, 2, 1, 200),
  combo3: s("sfx_combo_3", 0.45, 2, 1, 200),
  combo4: s("sfx_combo_4", 0.45, 2, 1, 200),
  combo5: s("sfx_combo_5", 0.45, 2, 1, 200),
  combo6: s("sfx_combo_6", 0.45, 2, 1, 200),
  comboBlip: s("sfx_combo_blip", 0.45, 2, 1, 200),
} satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;

export const COMBO_NOTES: readonly SoundId[] = ["combo1", "combo2", "combo3", "combo4", "combo5", "combo6"];

// Semitones above combo_1 for combos past 6, continuing the major pentatonic
// (combo_1..6 = 0, 2, 4, 7, 9, 12); sfx_combo_blip is pitched like combo_1.
const PENTA_PAST_6 = [14, 16, 19, 21, 24] as const;

export const semitones = (n: number) => Math.pow(2, n / 12);

// Which note a combo plays: a pre-rendered file (rate 1) for 1..6, then the
// blip pitched up (capped at +24 semitones = rate 4, inside every platform's
// playback-rate range). Two functions so a pop allocates nothing.
export function comboNoteId(combo: number): SoundId {
  const c = Math.max(1, Math.floor(combo));
  return c <= 6 ? COMBO_NOTES[c - 1] : "comboBlip";
}

export function comboNoteRate(combo: number): number {
  const c = Math.max(1, Math.floor(combo));
  return c <= 6 ? 1 : semitones(PENTA_PAST_6[Math.min(c - 7, PENTA_PAST_6.length - 1)]);
}

// Total players the manager creates (music players double on web where loops
// are seam-masked with a second player).
export function playerCount(maskLoops: boolean): number {
  const mul = maskLoops ? 2 : 1;
  let n = Object.keys(MUSIC).length * mul;
  for (const def of Object.values(SOUNDS) as SoundDef[]) n += def.loop ? def.voices * mul : def.voices;
  return n;
}
