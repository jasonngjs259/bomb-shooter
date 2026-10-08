// In-game HUD. Phone: a 56pt panel bar (score left, slam pips centre, pause
// right) with BEST underneath. Desktop (>= 900pt): two side panels next to
// the board. The score bumps (1 -> 1.12 -> 1, gold flash) when it changes.

import { memo, useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import { CEILING_EVERY_SHOTS } from "../game/constants";
import { IconButton } from "./Button";
import { BOMB_HEX, fonts, palette, spacing } from "./theme";

const native = Platform.OS !== "web";

export const padScore = (n: number) => {
  const s = String(Math.max(0, Math.floor(n))).padStart(6, "0");
  return `${s.slice(0, 3)},${s.slice(3)}`;
};
export const formatScore = (n: number) => Math.max(0, Math.floor(n)).toLocaleString("en-US");

interface HudProps {
  score: number;
  best: number;
  combo: number;
  shotsUntilCeiling: number;
  nextColorIndex: number;
  onPause: () => void;
}

function useBump(score: number) {
  const bump = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (score === 0) return;
    bump.setValue(0);
    Animated.timing(bump, { toValue: 1, duration: 160, useNativeDriver: native }).start();
  }, [score, bump]);
  return bump;
}

function ScoreText({ score, size }: { score: number; size: number }) {
  const bump = useBump(score);
  const scale = bump.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.12, 1] });
  const flash = bump.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] });
  return (
    <View>
      <Animated.Text style={[styles.score, { fontSize: size, transform: [{ scale }] }]}>{padScore(score)}</Animated.Text>
      <Animated.Text style={[styles.score, styles.scoreFlash, { fontSize: size, opacity: flash, transform: [{ scale }] }]}>
        {padScore(score)}
      </Animated.Text>
    </View>
  );
}

export function SlamPips({ shotsUntilCeiling }: { shotsUntilCeiling: number }) {
  const used = CEILING_EVERY_SHOTS - shotsUntilCeiling;
  const last = shotsUntilCeiling === 1;
  return (
    <View style={styles.pips} accessibilityLabel={`Ceiling drops in ${shotsUntilCeiling} shots`}>
      {Array.from({ length: CEILING_EVERY_SHOTS }, (_, i) => (
        <View key={i} style={[styles.pip, i < used ? styles.pipOn : null, last ? styles.pipDanger : null]} />
      ))}
    </View>
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

export const HudBar = memo(function HudBar({ score, best, combo, shotsUntilCeiling, onPause }: HudProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.barLeft}>
        <Text style={styles.label}>SCORE{combo > 1 ? `  ·  x${Math.min(combo, 5)}` : ""}</Text>
        <ScoreText score={score} size={26} />
      </View>
      <View style={styles.barCentre}>
        <SlamPips shotsUntilCeiling={shotsUntilCeiling} />
        <Text style={styles.best}>
          BEST <Text style={styles.bestValue}>{formatScore(Math.max(best, score))}</Text>
        </Text>
      </View>
      <IconButton label="Pause" onPress={onPause}>
        <PauseGlyph />
      </IconButton>
    </View>
  );
});

export const HudSide = memo(function HudSide({
  score, best, combo, shotsUntilCeiling, nextColorIndex, onPause, side,
}: HudProps & { side: "left" | "right" }) {
  if (side === "left") {
    return (
      <View style={styles.panel}>
        <Text style={styles.label}>SCORE</Text>
        <ScoreText score={score} size={36} />
        <Text style={[styles.label, styles.gap]}>BEST</Text>
        <Text style={styles.bestBig}>{formatScore(Math.max(best, score))}</Text>
        <Text style={[styles.label, styles.gap]}>COMBO</Text>
        <Text style={[styles.comboBig, combo >= 4 && { color: palette.gold }]}>x{Math.max(1, Math.min(combo, 5))}</Text>
      </View>
    );
  }
  return (
    <View style={styles.panel}>
      <View style={styles.rowBetween}>
        <Text style={styles.label}>NEXT</Text>
        <View style={[styles.nextDot, { backgroundColor: BOMB_HEX[nextColorIndex]?.base ?? palette.textMuted }]} />
      </View>
      <Text style={[styles.label, styles.gap]}>SLAM IN</Text>
      <SlamPips shotsUntilCeiling={shotsUntilCeiling} />
      <View style={styles.controls}>
        <Text style={styles.control}>MOUSE · AIM</Text>
        <Text style={styles.control}>CLICK · FIRE</Text>
        <Text style={styles.control}>← → · FINE AIM</Text>
        <Text style={styles.control}>SPACE · FIRE  /  X · SWAP</Text>
      </View>
      <View style={styles.pauseRow}>
        <IconButton label="Pause" onPress={onPause}>
          <PauseGlyph />
        </IconButton>
        <Text style={styles.control}>ESC · PAUSE</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.panel,
    borderBottomWidth: 1.5,
    borderColor: palette.panelBorder,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  barLeft: { flex: 1 },
  barCentre: { flex: 1, alignItems: "center", gap: 4 },
  label: { fontFamily: fonts.label, fontSize: 13, letterSpacing: 2, color: palette.textSecondary },
  score: { fontFamily: fonts.score, color: palette.textPrimary, fontVariant: ["tabular-nums"], minWidth: 132 },
  scoreFlash: { position: "absolute", left: 0, top: 0, color: palette.gold },
  best: { fontFamily: fonts.label, fontSize: 13, letterSpacing: 1.5, color: palette.textSecondary },
  bestValue: { fontFamily: fonts.score, fontSize: 13, color: palette.gold },
  pips: { flexDirection: "row", gap: 6 },
  pip: {
    width: 9,
    height: 9,
    transform: [{ rotate: "45deg" }],
    borderWidth: 1.5,
    borderColor: palette.magenta,
  },
  pipOn: { backgroundColor: palette.magenta },
  pipDanger: { borderColor: palette.danger, backgroundColor: palette.danger },
  pauseGlyph: { flexDirection: "row", gap: 5 },
  pauseBar: { width: 4, height: 14, borderRadius: 1, backgroundColor: palette.textPrimary },
  panel: {
    width: 240,
    padding: spacing.xl,
    borderRadius: 24,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    gap: 6,
  },
  gap: { marginTop: spacing.md },
  bestBig: { fontFamily: fonts.score, fontSize: 22, color: palette.gold },
  comboBig: { fontFamily: fonts.display, fontSize: 28, color: palette.cyan },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nextDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "rgba(255,255,255,0.35)" },
  controls: { marginTop: spacing.lg, gap: 4 },
  control: { fontFamily: fonts.label, fontSize: 14, letterSpacing: 1.2, color: palette.textSecondary },
  pauseRow: { marginTop: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md },
});
