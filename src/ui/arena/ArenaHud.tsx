// Arena 360 HUD (arena spec section 7 + fun-pass spec section 6).
// Phone landscape / portrait fallback: a top bar of pills (SCORE + combo +
// danger, LV + PAR countdown, remaining, pause) next to the GL radar; the
// boss row (name, HP bar with 60% / 25% ticks, weak-colour chip, shield
// pips) under it; FEVER bar bottom-centre with the FREEZE pill on its left
// (pass-through, never touch targets). POWER / ROLL live on the thumb
// cluster (TouchControls).
// Desktop: corner cards (score card top-left with best combo, LV + PAR,
// FEVER, POWER tile, FREEZE; radar + NEXT / DANGER / ROLL chip top-right;
// key legend bottom-left) and the boss bar top-centre, so the aim corridor
// stays clear. Values are polled at 10 Hz, rounded, and only re-render on change.

import { memo, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { keyLegend } from "../../arena/keyMap";
import { isPlayClockPaused } from "../../arena/playClock";
import { DESKTOP_CARD_W, DESKTOP_FEVER_W, FEVER_LABEL_W, MOUSE_CHIP_W, PHONE_FEVER_W } from "./arenaHudMetrics";
import type { ArenaEngine, PowerKind } from "../../game/arena";
import { romanMk } from "../../game/arena/skins";
import { IconButton } from "../Button";
import { padScore, formatScore } from "../Hud";
import { useSettings } from "../settings";
import { BOMB_HEX, fonts, palette } from "../theme";
import {
  BOMB_GLYPH, FlameGlyph, fmtClock, FREEZE_COLOR, Keycap, LockGlyph, POWER_COLOR, POWER_LABEL, PowerIcon, SegmentRing, SnowGlyph,
  StarGlyph, TumbleGlyph,
} from "./funGlyphs";

export interface HudState {
  score: number; combo: number; level: number; remaining: number; total: number;
  danger: number; current: number; next: number;
  bestCombo: number;
  feverOn: boolean; fever: number; feverActive: boolean;
  power: PowerKind | null;
  freeze: number; // s left, 0.1 steps
  rollOn: boolean; rollFill: number; rolling: boolean; // fill 1 = ready
  par: number; parLeft: number; fastLost: boolean; flawless: boolean;
  bossMk: number; bossHp: number; bossMaxHp: number; bossPhase: number; bossWeak: number; bossNext: number;
  bossFlicker: boolean; bossShield: number; bossShieldMax: number; bossInvuln: boolean;
}

const ROLL_SEGMENTS = 24;


export function readHud(engine: ArenaEngine, total: number): HudState {
  const def = engine.getLevelDef();
  const fever = engine.getFever();
  const roll = engine.getRoll();
  const sp = engine.getStarProgress();
  const t = sp.time; // the engine's par clock (real play only): no UI correction
  const boss = engine.getBoss();
  const cd = engine.getFunConfig().roll.cooldown;
  const rollFill = roll.state === "locked" ? 0 : roll.state === "ready" ? 1 : Math.round((1 - Math.min(1, roll.cooldown / cd)) * ROLL_SEGMENTS) / ROLL_SEGMENTS;
  const flicker = !!boss && boss.weakIn <= engine.getFunConfig().boss.weakTelegraph && Math.floor(Date.now() / 160) % 2 === 1;
  return {
    score: engine.getScore(), combo: engine.getCombo(), level: engine.getLevel(),
    remaining: engine.getRemaining(), total: Math.max(total, engine.getRemaining()),
    danger: Math.round(engine.getDangerLevel() * 20) / 20, current: engine.getCurrentBomb(), next: engine.getNextBomb(),
    bestCombo: engine.getBestCombo(),
    feverOn: def.fever, fever: Math.round(fever.meter / 2) * 2, feverActive: fever.active,
    power: engine.getPowerSlot(),
    freeze: Math.ceil(engine.getFreeze() * 10) / 10,
    rollOn: def.roll, rollFill, rolling: roll.state === "rolling",
    par: sp.par, parLeft: Math.max(0, Math.ceil(sp.par - t)), fastLost: !isPlayClockPaused(engine) && t > sp.par, flawless: sp.flawless,
    bossMk: boss?.mk ?? 0, bossHp: boss?.hp ?? 0, bossMaxHp: boss?.maxHp ?? 0, bossPhase: boss?.phase ?? 0,
    bossWeak: boss?.weakColor ?? 0, bossNext: boss?.nextWeakColor ?? 0, bossFlicker: flicker,
    bossShield: boss ? boss.shield.length : 0, bossShieldMax: def.boss?.shield ?? 0, bossInvuln: boss?.invulnerable ?? false,
  };
}

export function useArenaHud(engine: ArenaEngine): HudState {
  const [s, setS] = useState(() => readHud(engine, 0));
  const ref = useRef(s);
  useEffect(() => {
    // new game / next level: re-read at once (same render as the HUD
    // re-appearing), so the old combo / level never flashes
    const offNew = engine.on("phaseChanged", ({ phase, previous }) => {
      if (phase === "playing" && previous !== "playing") {
        ref.current = readHud(engine, 0);
        setS(ref.current);
      }
    });
    const id = setInterval(() => {
      const n = readHud(engine, ref.current.total);
      const p = ref.current;
      if ((Object.keys(n) as (keyof HudState)[]).some((k) => n[k] !== p[k])) {
        ref.current = n;
        setS(n);
      }
    }, 100);
    return () => {
      clearInterval(id);
      offNew();
    };
  }, [engine]);
  return s;
}

const dangerColor = (d: number) => (d >= 0.7 ? palette.danger : d >= 0.4 ? "#FF8A3D" : palette.gold);

function DangerBar({ d, width = 140 }: { d: number; width?: number }) {
  return (
    <View style={[styles.dangerTrack, { width }]} accessibilityLabel={`Danger ${Math.round(d * 100)} percent`}>
      <View style={[styles.dangerFill, { width: width * d, backgroundColor: dangerColor(d) }]} />
    </View>
  );
}

function Remaining({ n, total }: { n: number; total: number }) {
  const k = total > 0 ? 1 - n / total : 0;
  return (
    <View style={styles.row}>
      <View style={[styles.ring, { borderColor: k > 0.5 ? palette.gold : palette.panelBorder }]}>
        <View style={[styles.ringFill, { opacity: 0.25 + 0.75 * k }]} />
      </View>
      <Text style={styles.value}>{n}</Text>
      <Text style={styles.label}> LEFT</Text>
    </View>
  );
}

// "PAR 0:48" counting down with the FAST star; at 0 muted with a struck star.
function Par({ left, lost }: { left: number; lost: boolean }) {
  return (
    <View style={styles.row} accessibilityLabel={lost ? "Par time missed" : `Par ${fmtClock(left)}`}>
      <Text style={[styles.parText, lost && { color: palette.textMuted }]}>PAR {fmtClock(left)} </Text>
      <View>
        <StarGlyph size={14} on={!lost} />
        {lost && <View style={styles.strike} />}
      </View>
    </View>
  );
}

export const FeverBar = memo(function FeverBar({ value, active, width }: { value: number; active: boolean; width: number }) {
  const k = Math.max(0, Math.min(1, value / 100));
  const hot = active || k >= 0.9;
  return (
    <View style={styles.row} accessibilityLabel={active ? "Fever active" : `Fever ${Math.round(k * 100)} percent`}>
      <FlameGlyph size={16} />
      <View style={[styles.feverTrack, { width }, hot && styles.feverHot]}>
        <View style={[styles.feverFillA, { width: width * k }]}>
          <View style={[styles.feverFillB, { width: width * k * 0.5 }]} />
        </View>
      </View>
      {active && <Text style={styles.feverLabel} numberOfLines={1}>FEVER!</Text>}
    </View>
  );
});

export function FreezePill({ left }: { left: number }) {
  return (
    <View style={styles.freezePill} accessibilityLabel={`Freeze ${left.toFixed(1)} seconds`}>
      <SnowGlyph size={14} />
      <Text style={styles.freezeText}>{left.toFixed(1)}</Text>
    </View>
  );
}

// Boss bar: name, HP (ticks at 60% / 25%), weak-colour chip (flickers the
// next colour 1 s ahead), shield pips under it.
export const BossBar = memo(function BossBar({ hud, width, barH }: { hud: HudState; width: number; barH: number }) {
  const k = hud.bossMaxHp > 0 ? Math.max(0, hud.bossHp / hud.bossMaxHp) : 0;
  const weak = hud.bossFlicker ? hud.bossNext : hud.bossWeak;
  const col = BOMB_HEX[weak]?.base ?? palette.textMuted;
  const fill = hud.bossPhase >= 3 ? palette.danger : "#FF5A7A";
  return (
    <View style={styles.bossWrap} accessibilityLabel={`Core Warden ${romanMk(hud.bossMk)}, ${hud.bossHp} of ${hud.bossMaxHp} HP`}>
      <View style={styles.row}>
        <Text style={styles.bossName} numberOfLines={1}>CORE WARDEN {romanMk(hud.bossMk)}</Text>
        <View style={[styles.bossTrack, { width, height: barH }, hud.bossInvuln && styles.bossInvuln]}>
          <View style={{ width: width * k, height: barH, backgroundColor: fill }} />
          <View style={[styles.tick, { left: width * 0.6 - 1, height: barH }]} />
          <View style={[styles.tick, { left: width * 0.25 - 1, height: barH }]} />
        </View>
        <View style={[styles.weakChip, { backgroundColor: col }]}>
          <Text style={styles.weakGlyph}>{BOMB_GLYPH[weak] ?? ""}</Text>
        </View>
        <Text style={styles.weakLabel}>WEAK</Text>
      </View>
      {hud.bossShieldMax > 0 && hud.bossPhase < 3 && (
        <View style={styles.pips}>
          {Array.from({ length: hud.bossShieldMax }, (_, i) => (
            <View key={i} style={[styles.pip, i < hud.bossShield && styles.pipOn]} />
          ))}
        </View>
      )}
    </View>
  );
});

function PowerTile({ power }: { power: PowerKind | null }) {
  return (
    <View style={styles.rowBetween}>
      <Text style={styles.label}>POWER</Text>
      <View style={[styles.powerTile, power && { borderColor: POWER_COLOR[power] }]} accessibilityLabel={power ? `Power ${POWER_LABEL[power]}` : "Power empty"}>
        {power ? <PowerIcon kind={power} size={30} /> : <Text style={styles.empty}>EMPTY</Text>}
      </View>
    </View>
  );
}

function RollChip({ fill, rolling, keyLabel }: { fill: number; rolling: boolean; keyLabel: string }) {
  const ready = fill >= 1;
  return (
    <View style={[styles.rowBetween, { marginTop: 6 }]}>
      <Text style={styles.label}>ROLL</Text>
      <View style={styles.row}>
        <Keycap label={keyLabel} />
        <View style={styles.rollMini}>
          <SegmentRing size={30} fill={fill} color={ready ? palette.cyan : palette.textSecondary} segments={ROLL_SEGMENTS} thickness={2.5} />
          <View style={{ opacity: ready && !rolling ? 1 : 0.4 }}>
            <TumbleGlyph size={14} />
          </View>
        </View>
      </View>
    </View>
  );
}

interface Props {
  hud: HudState;
  best: number;
  desktop: boolean;
  radarSize: number;
  left: number;
  top: number;
  width: number;
  screenW: number;
  insetTop: number;
  insetBottom: number;
  mouse?: boolean; // short desktop window (mouse, phone-style HUD): compact NEXT / ROLL / keys chip
  onPause: () => void;
}



// Where the boss row sits (ArenaScreen keeps threat arrows / tips clear of it).
export const bossRowTop = (desktop: boolean, insetTop: number) => (desktop ? 16 : insetTop + 12 + 52 + 4);
export const BOSS_ROW_H = 34;

export const ArenaHud = memo(function ArenaHud({
  hud, best, desktop, radarSize, left, top, width, screenW, insetTop, insetBottom, mouse = false, onPause,
}: Props) {
  const settings = useSettings();
  // "x3" repeats next to the score for 900 ms after a combo
  const [comboShown, setComboShown] = useState(0);
  useEffect(() => {
    // combo back to 0 (miss, new game / next level): clear it immediately
    if (hud.combo < 2) {
      setComboShown(0);
      return;
    }
    setComboShown(hud.combo);
    const id = setTimeout(() => setComboShown(0), 900);
    return () => clearTimeout(id);
  }, [hud.combo]);

  const legend = keyLegend({ rollUnlocked: hud.rollOn, rollKey: settings.rollKey });
  const boss = hud.bossMk > 0 && (
    <View style={[styles.bossRow, { top: bossRowTop(desktop, insetTop), width: screenW }]}>
      <View style={styles.bossPanel}>
        <BossBar hud={hud} width={desktop ? 420 : Math.min(280, screenW - 360)} barH={desktop ? 14 : 12} />
      </View>
    </View>
  );

  if (desktop) {
    return (
      <>
        <View style={[styles.corner, { left: 16, top: 16 }]}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>SCORE</Text>
            {comboShown > 1 && <Text style={styles.comboSmall}>x{Math.min(comboShown, 5)}</Text>}
          </View>
          <Text style={[styles.score, { fontSize: 26 }]} numberOfLines={1}>{padScore(hud.score)}</Text>
          <View style={styles.statsRow}>
            <Text style={styles.stat}>BEST <Text style={styles.statGold}>{formatScore(Math.max(best, hud.score))}</Text></Text>
            <Text style={styles.stat}>COMBO <Text style={styles.statValue}>x{hud.bestCombo}</Text></Text>
          </View>
          <View style={styles.statsRow}>
            <Text style={styles.stat}>LV <Text style={styles.statValue}>{hud.level}</Text></Text>
            <Par left={hud.parLeft} lost={hud.fastLost} />
          </View>
          <View style={styles.statsRow}>
            <Remaining n={hud.remaining} total={hud.total} />
            <IconButton label="Pause" onPress={onPause}>
              <View style={styles.pauseGlyph}>
                <View style={styles.pauseBar} />
                <View style={styles.pauseBar} />
              </View>
            </IconButton>
          </View>
          {hud.feverOn && <FeverBar value={hud.fever} active={hud.feverActive} width={DESKTOP_FEVER_W} />}
          <PowerTile power={hud.power} />
          {hud.freeze > 0 && (
            <View style={styles.rowBetween}>
              <Text style={[styles.label, { color: FREEZE_COLOR }]}>FREEZE</Text>
              <FreezePill left={hud.freeze} />
            </View>
          )}
        </View>
        <View style={[styles.chip, { left: width - 16 - radarSize, top: 16 + radarSize + 8, width: radarSize }]}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>NEXT</Text>
            <View style={[styles.nextDotSmall, { backgroundColor: BOMB_HEX[hud.next]?.base ?? palette.textMuted }]}>
              {hud.power && <LockGlyph size={12} color={palette.ink} />}
            </View>
          </View>
          <Text style={[styles.label, { marginTop: 4 }]}>DANGER</Text>
          <DangerBar d={hud.danger} width={radarSize - 20} />
          {hud.rollOn && legend.roll && <RollChip fill={hud.rollFill} rolling={hud.rolling} keyLabel={legend.roll} />}
        </View>
        {boss}
        <View style={[styles.legendStrip, { left: 16, bottom: 12 }]}>
          <Text style={styles.legendText}>
            MOUSE TURN · WASD MOVE · {legend.fire} FIRE{legend.roll ? ` · ${legend.roll} ROLL` : ""} · {legend.swap} SWAP · R FACE THREAT · ESC PAUSE
          </Text>
        </View>
      </>
    );
  }
  const feverW = PHONE_FEVER_W;
  return (
    <>
      <View style={[styles.bar, { left, top, width }]}>
        <View style={styles.pill}>
          <View>
            <View style={styles.row}>
              <Text style={styles.label}>SCORE </Text>
              <Text style={[styles.score, { fontSize: 22 }]} numberOfLines={1}>{padScore(hud.score)}</Text>
              {comboShown > 1 && <Text style={styles.comboSmall}> x{Math.min(comboShown, 5)}</Text>}
            </View>
            <DangerBar d={hud.danger} width={140} />
          </View>
        </View>
        <View style={[styles.pill, styles.lv]}>
          <Text style={styles.lvText}>LV {hud.level}</Text>
          <Par left={hud.parLeft} lost={hud.fastLost} />
        </View>
        <View style={styles.pill}>
          <Remaining n={hud.remaining} total={hud.total} />
        </View>
        <View style={styles.spacer} />
        <IconButton label="Pause" onPress={onPause}>
          <View style={styles.pauseGlyph}>
            <View style={styles.pauseBar} />
            <View style={styles.pauseBar} />
          </View>
        </IconButton>
      </View>
      {boss}
      {(hud.feverOn || hud.freeze > 0) && (
        <View style={[styles.bottomRow, { bottom: insetBottom + 14, left: (screenW - feverW) / 2 - 96, width: feverW + 96 + 80 }]}>
          <View style={styles.freezeSlot}>{hud.freeze > 0 && <FreezePill left={hud.freeze} />}</View>
          {hud.feverOn && <FeverBar value={hud.fever} active={hud.feverActive} width={feverW} />}
        </View>
      )}
      {mouse && (
        <View style={[styles.chip, styles.mouseChip, { right: 12, bottom: insetBottom + 12, width: MOUSE_CHIP_W }]}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>NEXT</Text>
            <View style={styles.row}>
              {hud.power && (
                <View style={styles.powerMini} accessibilityLabel={`Power ${POWER_LABEL[hud.power]}`}>
                  <PowerIcon kind={hud.power} size={18} />
                </View>
              )}
              <View style={[styles.nextDotSmall, { backgroundColor: BOMB_HEX[hud.next]?.base ?? palette.textMuted }]}>
                {hud.power && <LockGlyph size={12} color={palette.ink} />}
              </View>
            </View>
          </View>
          {hud.rollOn && legend.roll && <RollChip fill={hud.rollFill} rolling={hud.rolling} keyLabel={legend.roll} />}
          <Text style={styles.legendMini}>
            {legend.fire} FIRE{legend.roll ? ` · ${legend.roll} ROLL` : ""}{"\n"}{legend.swap} SWAP · R THREAT{"\n"}WASD MOVE · ESC PAUSE
          </Text>
        </View>
      )}
    </>
  );
});

const styles = StyleSheet.create({
  bar: { position: "absolute", minHeight: 52, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  pill: {
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    justifyContent: "center",
  },
  lv: { borderColor: palette.cyan, flexDirection: "row", alignItems: "center", gap: 8 },
  lvText: { fontFamily: fonts.button, fontSize: 16, letterSpacing: 1.5, color: palette.cyan },
  parText: { fontFamily: fonts.label, fontSize: 13, letterSpacing: 1.2, color: palette.textPrimary, fontVariant: ["tabular-nums"] },
  strike: { position: "absolute", left: -1, right: -1, top: 8, height: 2, backgroundColor: palette.textMuted, transform: [{ rotate: "-30deg" }] },
  spacer: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 1.6, color: palette.textSecondary },
  value: { fontFamily: fonts.score, fontSize: 18, color: palette.textPrimary },
  score: { fontFamily: fonts.score, color: palette.textPrimary, fontVariant: ["tabular-nums"] },
  comboSmall: { fontFamily: fonts.display, fontSize: 16, color: palette.gold },
  dangerTrack: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.12)", marginTop: 4, overflow: "hidden" },
  dangerFill: { height: 6, borderRadius: 3 },
  ring: { width: 20, height: 20, borderRadius: 10, borderWidth: 3, marginRight: 6, alignItems: "center", justifyContent: "center" },
  ringFill: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.gold },
  corner: {
    position: "absolute",
    width: DESKTOP_CARD_W,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    gap: 4,
  },
  chip: {
    position: "absolute",
    padding: 10,
    borderRadius: 14,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
  },
  statsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stat: { fontFamily: fonts.label, fontSize: 13, letterSpacing: 1.2, color: palette.textSecondary },
  statGold: { fontFamily: fonts.score, fontSize: 14, color: palette.gold },
  statValue: { fontFamily: fonts.score, fontSize: 14, color: palette.textPrimary },
  nextDotSmall: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)", alignItems: "center", justifyContent: "center",
  },
  legendStrip: {
    position: "absolute",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(11, 4, 32, 0.6)",
    pointerEvents: "none",
  },
  mouseChip: { paddingVertical: 8, gap: 2 },
  powerMini: { width: 26, height: 26, marginRight: 6, alignItems: "center", justifyContent: "center" },
  legendMini: { fontFamily: fonts.label, fontSize: 11, lineHeight: 14, letterSpacing: 0.8, color: palette.textSecondary, marginTop: 6 },
  legendText: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 1.2, color: palette.textSecondary },
  pauseGlyph: { flexDirection: "row", gap: 5 },
  pauseBar: { width: 4, height: 14, borderRadius: 1, backgroundColor: palette.textPrimary },
  feverTrack: {
    height: 10, borderRadius: 5, marginLeft: 6, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,61,203,0.35)",
  },
  feverHot: { borderColor: palette.gold },
  feverFillA: { height: "100%", backgroundColor: "#FF3DCB", alignItems: "flex-end" },
  feverFillB: { height: "100%", backgroundColor: "#FFD23F", opacity: 0.85 },
  feverLabel: { fontFamily: fonts.display, fontSize: 11, letterSpacing: 0.5, color: palette.gold, marginLeft: 6, maxWidth: FEVER_LABEL_W },
  freezePill: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, height: 24, borderRadius: 12,
    backgroundColor: "rgba(11, 4, 32, 0.78)", borderWidth: 1, borderColor: FREEZE_COLOR,
  },
  freezeText: { fontFamily: fonts.score, fontSize: 12, color: FREEZE_COLOR, fontVariant: ["tabular-nums"] },
  bottomRow: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 8, pointerEvents: "none" },
  freezeSlot: { width: 88, alignItems: "flex-end" },
  powerTile: {
    width: 64, height: 64, borderRadius: 14, borderWidth: 2, borderColor: palette.panelBorder, backgroundColor: "rgba(11,4,32,0.6)",
    alignItems: "center", justifyContent: "center",
  },
  empty: { fontFamily: fonts.label, fontSize: 11, letterSpacing: 1.2, color: palette.textMuted },
  rollMini: { width: 30, height: 30, marginLeft: 8, alignItems: "center", justifyContent: "center" },
  bossRow: { position: "absolute", left: 0, alignItems: "center", pointerEvents: "none" },
  bossPanel: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: "rgba(22, 10, 51, 0.78)",
    borderWidth: 1, borderColor: palette.panelBorder,
  },
  bossWrap: { alignItems: "center" },
  bossName: { fontFamily: fonts.button, fontSize: 13, letterSpacing: 1.2, color: palette.textPrimary, marginRight: 8 },
  bossTrack: { borderRadius: 3, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden" },
  bossInvuln: { opacity: 0.55 },
  tick: { position: "absolute", top: 0, width: 2, backgroundColor: "rgba(245,243,255,0.75)" },
  weakChip: { width: 18, height: 18, borderRadius: 9, marginLeft: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#FFFFFF" },
  weakGlyph: { fontSize: 10, lineHeight: 12, color: "rgba(255,255,255,0.9)" },
  weakLabel: { fontFamily: fonts.label, fontSize: 11, letterSpacing: 1, color: palette.textSecondary, marginLeft: 4 },
  pips: { flexDirection: "row", gap: 3, marginTop: 3 },
  pip: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.18)" },
  pipOn: { backgroundColor: palette.cyan },
});
