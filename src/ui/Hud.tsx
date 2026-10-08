// In-game HUD (spec 8.2 / 8.3). Phone: one 56pt panel bar (score, ceiling
// pips, best, pause). Wide web (>= 1100pt): two side panels next to the
// board. Plain RN views above the canvas, so the HUD never shakes.

import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { CEILING_EVERY_SHOTS, MAX_COMBO_MULTIPLIER } from "../game/constants";
import { BoardLayout } from "../render/layout";
import { IconButton } from "./Button";
import { bombStyle, fonts, palette } from "./theme";

export const HUD_BAR_HEIGHT = 56;

export const formatScore = (n: number, pad = 6) => {
  const s = String(Math.max(0, Math.floor(n))).padStart(pad, "0");
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export interface HudData {
  score: number;
  best: number;
  combo: number;
  shotsUntilCeiling: number;
  nextColorIndex: number;
}

// Advance widths in em, measured from the Orbitron 800 TTF: "000,000" = 5.27,
// digit = 0.84, comma = 0.24. Used to size the HUD numbers to their boxes.
const SCORE_EM = 5.27;
const numberEm = (text: string) => {
  let em = 0;
  for (const ch of text) em += ch === "," ? 0.24 : 0.84;
  return em;
};

const BAR_PAD_L = 14;
const BAR_PAD_R = 6;
const BAR_GAP = 8;
const PAUSE = 44;

// Phone HUD bar layout from the bar width: fixed SLAM column, the rest split
// 60/40 between SCORE and BEST, fonts sized so "000,000" always fits.
export function hudBarMetrics(width: number, bestText: string) {
  const compact = width < 340;
  const pip = compact ? 8 : 10;
  const pipGap = compact ? 4 : 6;
  const slamW = 5 * pip + 4 * pipGap + 8; // + rotated-diamond overhang
  const rest = width - BAR_PAD_L - BAR_PAD_R - 3 * BAR_GAP - slamW - PAUSE;
  const scoreW = Math.floor(rest * 0.6);
  const bestW = rest - scoreW;
  const scoreSize = Math.max(10, Math.min(24, Math.floor((scoreW * 0.95) / SCORE_EM)));
  const bestSize = Math.max(9, Math.min(16, Math.floor((bestW * 0.95) / numberEm(bestText))));
  return { pip, pipGap, slamW, scoreW, bestW, scoreSize, bestSize };
}

const fitProps = Platform.OS === "web" ? {} : { adjustsFontSizeToFit: true, minimumFontScale: 0.6 };

// Score with the 160ms bump + gold flash on change
function ScoreValue({ score, size, reduced }: { score: number; size: number; reduced: boolean }) {
  const bump = useSharedValue(0);
  useEffect(() => {
    if (score === 0) return;
    bump.value = withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 80 }));
  }, [score, bump]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: reduced ? 1 : 1 + 0.12 * bump.value }],
    color: interpolateColor(bump.value, [0, 1], [palette.textPrimary, palette.gold]),
  }));
  return (
    <Animated.Text style={[styles.score, { fontSize: size, lineHeight: size * 1.15 }, style]} numberOfLines={1} {...fitProps}>
      {formatScore(score)}
    </Animated.Text>
  );
}

// Five diamonds that fill as shots are fired; all blink red on the last one
export function CeilingPips({ shotsUntilCeiling, size = 10, gap = 6 }: { shotsUntilCeiling: number; size?: number; gap?: number }) {
  const fired = CEILING_EVERY_SHOTS - shotsUntilCeiling;
  const last = shotsUntilCeiling === 1;
  const blink = useSharedValue(1);
  useEffect(() => {
    if (last) blink.value = withRepeat(withSequence(withTiming(0.25, { duration: 125 }), withTiming(1, { duration: 125 })), -1);
    else {
      cancelAnimation(blink);
      blink.value = 1;
    }
  }, [last, blink]);
  const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value }));
  return (
    <Animated.View style={[styles.pips, { gap }, last && blinkStyle]} accessibilityLabel={`${shotsUntilCeiling} shots until the ceiling drops`}>
      {Array.from({ length: CEILING_EVERY_SHOTS }, (_, i) => (
        <View
          key={i}
          style={[
            styles.pip,
            { width: size, height: size },
            last ? styles.pipDanger : i < fired ? styles.pipOn : styles.pipOff,
          ]}
        />
      ))}
    </Animated.View>
  );
}

function PauseGlyph() {
  return (
    <View style={styles.pauseGlyph}>
      <View style={styles.pauseBar} />
      <View style={styles.pauseBar} />
    </View>
  );
}

export function HudBar({ data, onPause, reduced, width }: { data: HudData; onPause: () => void; reduced: boolean; width: number }) {
  const bestText = formatScore(Math.max(data.best, data.score), 1);
  const m = hudBarMetrics(width, bestText);
  return (
    <View style={[styles.bar, { width }]}>
      <View style={[styles.col, { width: m.scoreW }]}>
        <Text style={styles.label} numberOfLines={1}>SCORE</Text>
        <ScoreValue score={data.score} size={m.scoreSize} reduced={reduced} />
      </View>
      <View style={[styles.col, styles.centre, { width: m.slamW }]}>
        <Text style={styles.label} numberOfLines={1}>SLAM</Text>
        <CeilingPips shotsUntilCeiling={data.shotsUntilCeiling} size={m.pip} gap={m.pipGap} />
      </View>
      <View style={[styles.col, styles.right, { width: m.bestW }]}>
        <Text style={styles.label} numberOfLines={1}>BEST</Text>
        <Text style={[styles.best, { fontSize: m.bestSize }]} numberOfLines={1} {...fitProps}>
          {bestText}
        </Text>
      </View>
      <IconButton label="Pause" onPress={onPause}>
        <PauseGlyph />
      </IconButton>
    </View>
  );
}

const CONTROLS_WEB = [
  ["MOUSE", "aim"],
  ["CLICK", "fire"],
  ["← / →", "fine aim"],
  ["SPACE", "fire"],
  ["X / RIGHT-CLICK", "swap"],
  ["ESC", "pause"],
];

export function SidePanels({
  data,
  layout,
  onPause,
  onSwap,
  reduced,
}: {
  data: HudData;
  layout: BoardLayout;
  onPause: () => void;
  onSwap: () => void;
  reduced: boolean;
}) {
  const left = Math.max(16, layout.offsetX - 32 - 240);
  const right = Math.min(layout.containerWidth - 16 - 240, layout.offsetX + layout.width + 32);
  const top = layout.offsetY + layout.height / 2 - 150;
  const combo = Math.min(data.combo, MAX_COMBO_MULTIPLIER);
  const next = bombStyle(data.nextColorIndex);
  return (
    <>
      <View style={[styles.panel, { left, top }]}>
        <Text style={styles.label}>SCORE</Text>
        <ScoreValue score={data.score} size={36} reduced={reduced} />
        <Text style={[styles.label, styles.gap]}>BEST</Text>
        <Text style={[styles.best, styles.bestLarge]}>{formatScore(Math.max(data.best, data.score), 1)}</Text>
        <Text style={[styles.label, styles.gap]}>COMBO</Text>
        <View style={styles.meter}>
          {Array.from({ length: MAX_COMBO_MULTIPLIER }, (_, i) => (
            <View key={i} style={[styles.meterCell, i < combo && { backgroundColor: i >= 3 ? palette.gold : i === 2 ? palette.magenta : palette.cyan }]} />
          ))}
        </View>
        <Text style={styles.comboText}>{combo > 1 ? `x${combo}` : "—"}</Text>
      </View>
      <View style={[styles.panel, { left: right, top }]}>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>NEXT</Text>
          <IconButton label="Pause" onPress={onPause}>
            <PauseGlyph />
          </IconButton>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next bomb, activate to swap"
          onPress={onSwap}
          style={[styles.nextSwatch, { backgroundColor: next.base, boxShadow: `0px 0px 16px ${next.glow}` }, Platform.OS === "web" && styles.pointer]}
        />
        <Text style={[styles.label, styles.gap]}>SLAM IN</Text>
        <CeilingPips shotsUntilCeiling={data.shotsUntilCeiling} size={12} />
        <View style={styles.controls}>
          {CONTROLS_WEB.map(([key, action]) => (
            <View key={key} style={styles.rowBetween}>
              <Text style={styles.key}>{key}</Text>
              <Text style={styles.action}>{action}</Text>
            </View>
          ))}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: HUD_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    paddingLeft: BAR_PAD_L,
    paddingRight: BAR_PAD_R,
    gap: BAR_GAP,
    backgroundColor: palette.panel,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
  },
  col: { justifyContent: "center" },
  centre: { alignItems: "center" },
  right: { alignItems: "flex-end" },
  label: { fontFamily: fonts.label, fontSize: 13, letterSpacing: 2, color: palette.textSecondary },
  score: { fontFamily: fonts.score, color: palette.textPrimary, fontVariant: ["tabular-nums"] },
  best: { fontFamily: fonts.score, fontSize: 16, color: palette.gold, fontVariant: ["tabular-nums"] },
  bestLarge: { fontSize: 22 },
  pips: { flexDirection: "row", gap: 6, marginTop: 4 },
  pip: { transform: [{ rotate: "45deg" }], borderWidth: 1, borderColor: "rgba(255, 61, 203, 0.6)" },
  pipOn: { backgroundColor: palette.magenta },
  pipOff: { backgroundColor: "transparent" },
  pipDanger: { backgroundColor: palette.danger, borderColor: palette.danger },
  pauseGlyph: { flexDirection: "row", gap: 4 },
  pauseBar: { width: 4, height: 14, borderRadius: 1, backgroundColor: palette.textPrimary },
  panel: {
    position: "absolute",
    width: 240,
    padding: 20,
    backgroundColor: palette.panel,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
  },
  gap: { marginTop: 16 },
  meter: { flexDirection: "row", gap: 6, marginTop: 8 },
  meterCell: { flex: 1, height: 10, borderRadius: 3, backgroundColor: "rgba(124, 92, 255, 0.25)" },
  comboText: { fontFamily: fonts.title, fontSize: 22, color: palette.textPrimary, marginTop: 6 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nextSwatch: { width: 44, height: 44, borderRadius: 22, marginTop: 6, borderWidth: 2, borderColor: "rgba(255,255,255,0.35)" },
  pointer: { cursor: "pointer" },
  controls: { marginTop: 18, gap: 4 },
  key: { fontFamily: fonts.label, fontSize: 14, color: palette.cyan, letterSpacing: 1 },
  action: { fontFamily: fonts.body, fontSize: 15, color: palette.textSecondary },
});
