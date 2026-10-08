// In-game header: score (+combo), best, next bomb (tap to swap) and the
// countdown to the next ceiling drop.

import { Pressable, StyleSheet, Text, View } from "react-native";
import { BOMB_COLORS, CEILING_EVERY_SHOTS, MAX_COMBO_MULTIPLIER } from "../game/constants";
import { colors, fontSizes, radii, spacing } from "./theme";

interface HudProps {
  score: number;
  best: number;
  combo: number;
  nextColorIndex: number;
  shotsUntilCeiling: number;
  onSwap: () => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export function Hud({ score, best, combo, nextColorIndex, shotsUntilCeiling, onSwap }: HudProps) {
  return (
    <View style={styles.row}>
      <View style={styles.scoreBlock}>
        <Stat label="SCORE" value={String(score)} />
        {combo > 1 && <Text style={styles.combo}>x{Math.min(combo, MAX_COMBO_MULTIPLIER)}</Text>}
      </View>
      <Stat label="BEST" value={String(Math.max(best, score))} />

      <Pressable accessibilityRole="button" accessibilityLabel="Swap bomb" onPress={onSwap} style={styles.stat}>
        <Text style={styles.statLabel}>NEXT</Text>
        <View style={[styles.nextDot, { backgroundColor: BOMB_COLORS[nextColorIndex] ?? colors.textMuted }]} />
      </Pressable>

      <View style={styles.stat}>
        <Text style={styles.statLabel}>CEILING IN</Text>
        <View style={styles.pips}>
          {Array.from({ length: CEILING_EVERY_SHOTS }, (_, i) => (
            <View key={i} style={[styles.pip, i < shotsUntilCeiling ? styles.pipOn : styles.pipOff]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  scoreBlock: { flexDirection: "row", alignItems: "flex-end", gap: spacing.xs },
  stat: { alignItems: "center", minWidth: 56 },
  statLabel: { color: colors.textMuted, fontSize: fontSizes.xs, fontWeight: "700", letterSpacing: 1 },
  statValue: { color: colors.text, fontSize: fontSizes.lg, fontWeight: "800", fontVariant: ["tabular-nums"] },
  combo: { color: colors.accent, fontSize: fontSizes.md, fontWeight: "900", marginBottom: 2 },
  nextDot: { width: 22, height: 22, borderRadius: 11, marginTop: 3, borderWidth: 1, borderColor: "rgba(0,0,0,0.35)" },
  pips: { flexDirection: "row", gap: 3, marginTop: 8 },
  pip: { width: 8, height: 8, borderRadius: 4 },
  pipOn: { backgroundColor: colors.text },
  pipOff: { backgroundColor: colors.boardEdge },
});
