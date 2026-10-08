// Arena 360 game-over / arena-clear card. Landscape: 2 columns 560x260
// (stats left, buttons right); portrait: stacked. Buttons (and Space/Enter,
// handled by the screen) arm 1.5 s after the card appears so a held fire
// key or a stray tap can't skip it.

import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { Button } from "../Button";
import { formatScore } from "../Hud";
import { fonts, palette } from "../theme";
import { textGlow } from "../webSafe";

const native = Platform.OS !== "web";
export const ARM_MS = 1500;

interface Props {
  won: boolean;
  score: number;
  best: number;
  isNewBest: boolean;
  level: number;
  time: number;
  combo: number;
  landscape: boolean;
  armed: boolean;
  onAgain: () => void;
  onNext: () => void;
  onMenu: () => void;
}

export function ArenaEndCard({ won, score, best, isNewBest, level, time, combo, landscape, armed, onAgain, onNext, onMenu }: Props) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [fade]);
  const rise = fade.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  const title = won ? "ARENA CLEAR!" : "GAME OVER";
  const titleColor = won ? palette.gold : palette.danger;
  const row = (label: string, value: string, gold = false) => (
    <View style={styles.row} key={label}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, gold && { color: palette.gold }]}>{value}</Text>
    </View>
  );
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: fade }]}>
      <Animated.View style={[styles.card, landscape ? styles.cardWide : styles.cardTall, { transform: [{ translateY: rise }] }]}>
        <View style={landscape ? styles.colStats : styles.colFull}>
          <Text style={[styles.title, { color: titleColor }, textGlow(titleColor, 14)]}>{title}</Text>
          {row("SCORE", formatScore(score))}
          {row("BEST", formatScore(Math.max(best, score)), true)}
          {row("LEVEL", String(level))}
          {row("TIME", `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`)}
          {row("BIGGEST COMBO", `x${Math.max(1, combo)}`)}
          {isNewBest && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>NEW BEST</Text>
            </View>
          )}
        </View>
        <View style={[landscape ? styles.colButtons : styles.colFull, !armed && styles.disarmed]}>
          {won ? (
            <Button label="Next level" size="md" onPress={onNext} />
          ) : (
            <Button label="Play again" size="md" onPress={onAgain} />
          )}
          {won && <Button label="Replay level 1" size="md" variant="secondary" onPress={onAgain} />}
          <Button label="Menu" size="md" variant="secondary" onPress={onMenu} />
          {Platform.OS === "web" && <Text style={styles.hint}>{won ? "SPACE · NEXT LEVEL" : "SPACE · PLAY AGAIN"}</Text>}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: palette.overlay, alignItems: "center", justifyContent: "center", padding: 12 },
  card: { padding: 22, borderRadius: 24, backgroundColor: palette.panelSolid, borderWidth: 1.5, borderColor: palette.panelBorder, gap: 14 },
  cardWide: { width: 560, maxWidth: "96%", minHeight: 260, flexDirection: "row", alignItems: "center" },
  cardTall: { width: 330, maxWidth: "94%", alignItems: "stretch" },
  colStats: { flex: 1, gap: 6 },
  colButtons: { width: 250, alignItems: "center", gap: 10 },
  colFull: { alignItems: "center", gap: 8, alignSelf: "stretch" },
  disarmed: { opacity: 0.45, pointerEvents: "none" },
  title: { fontFamily: fonts.display, fontSize: 28, textAlign: "center", marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", alignSelf: "stretch" },
  rowLabel: { fontFamily: fonts.label, fontSize: 14, letterSpacing: 1.5, color: palette.textSecondary },
  rowValue: { fontFamily: fonts.score, fontSize: 18, color: palette.textPrimary, fontVariant: ["tabular-nums"] },
  badge: { alignSelf: "center", paddingHorizontal: 14, paddingVertical: 4, borderRadius: 999, backgroundColor: palette.gold, marginTop: 4 },
  badgeText: { fontFamily: fonts.button, fontSize: 15, letterSpacing: 2, color: palette.ink },
  hint: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 1.5, color: palette.textMuted },
});
