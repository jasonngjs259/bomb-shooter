// Game-over / win card (spec 8.4). Waits for the in-canvas finale (bombs
// exploding bottom-up / fireworks), then the backdrop fades to 0.75 and the
// card rises 40pt. Score counts up over 900ms; NEW BEST badge pulses; the
// GAME OVER title glitches with an RGB split every 1.6s.

import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Button } from "./Button";
import { formatScore } from "./Hud";
import { fonts, palette } from "./theme";

interface Props {
  won: boolean;
  score: number;
  best: number;
  isNewBest: boolean;
  maxCombo: number;
  reduced: boolean;
  onRetry: () => void;
  onMenu: () => void;
}

const easeOutCubic = Easing.out(Easing.cubic);

function useCountUp(target: number, delayMs: number, durationMs: number) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now + delayMs;
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delayMs, durationMs]);
  return value;
}

export function GameOverOverlay({ won, score, best, isNewBest, maxCombo, reduced, onRetry, onMenu }: Props) {
  const delay = reduced ? 300 : won ? 1600 : 1500;
  const backdrop = useSharedValue(0);
  const card = useSharedValue(0);
  const glitch = useSharedValue(0);
  const badge = useSharedValue(1);
  const shown = useCountUp(score, delay + 200, 900);
  // The card's buttons only take touches once it is visible
  const [interactive, setInteractive] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setInteractive(true), delay);
    return () => clearTimeout(id);
  }, [delay]);

  useEffect(() => {
    backdrop.value = withDelay(Math.max(0, delay - 400), withTiming(1, { duration: 400 }));
    card.value = withDelay(delay, withTiming(1, { duration: 320, easing: easeOutCubic }));
    if (!won && !reduced) {
      glitch.value = withDelay(
        delay + 600,
        withRepeat(withSequence(withTiming(0, { duration: 1567 }), withTiming(1, { duration: 0 }), withTiming(1, { duration: 33 }), withTiming(0, { duration: 0 })), -1)
      );
    }
    if (isNewBest && !reduced) {
      badge.value = withDelay(delay + 1100, withRepeat(withSequence(withTiming(1.08, { duration: 450 }), withTiming(1, { duration: 450 })), -1));
    }
  }, [delay, won, reduced, isNewBest, backdrop, card, glitch, badge]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value * 0.75 }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: card.value,
    transform: [{ translateY: (1 - card.value) * 40 }],
  }));
  const splitA = useAnimatedStyle(() => ({ opacity: glitch.value, transform: [{ translateX: -3 }] }));
  const splitB = useAnimatedStyle(() => ({ opacity: glitch.value, transform: [{ translateX: 3 }] }));
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));

  const title = won ? "BOARD CLEAR!" : "GAME OVER";
  const titleColor = won ? palette.gold : palette.danger;

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.backdrop, backdropStyle]} />
      <Animated.View style={[styles.card, cardStyle, { pointerEvents: interactive ? "auto" : "none" }]} accessibilityViewIsModal>
        <View style={styles.titleWrap}>
          <Animated.Text style={[styles.title, styles.split, { color: palette.cyan }, splitA]}>{title}</Animated.Text>
          <Animated.Text style={[styles.title, styles.split, { color: palette.magenta }, splitB]}>{title}</Animated.Text>
          <Text style={[styles.title, { color: titleColor }]} accessibilityRole="header">
            {title}
          </Text>
        </View>
        {won && (
          <View style={styles.stars}>
            {[0, 1, 2].map((i) => (
              <Star key={i} index={i} delay={delay + 200} />
            ))}
          </View>
        )}
        <Row label="SCORE" value={formatScore(shown, 1)} big />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>BEST</Text>
          <View style={styles.bestRight}>
            {isNewBest && (
              <Animated.View style={[styles.badge, badgeStyle]}>
                <Text style={styles.badgeText}>NEW BEST</Text>
              </Animated.View>
            )}
            <Text style={[styles.rowValue, { color: palette.gold }]}>{formatScore(Math.max(best, score), 1)}</Text>
          </View>
        </View>
        <Row label="BIGGEST COMBO" value={maxCombo > 1 ? `x${maxCombo}` : "—"} />
        <View style={styles.buttons}>
          <Button label="PLAY AGAIN" onPress={onRetry} style={styles.fullWidth} />
          <Button label="MENU" variant="secondary" onPress={onMenu} style={styles.fullWidth} />
        </View>
        {Platform.OS === "web" && <Text style={styles.hint}>SPACE TO PLAY AGAIN</Text>}
      </Animated.View>
    </View>
  );
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, big && styles.rowValueBig]}>{value}</Text>
    </View>
  );
}

function Star({ index, delay }: { index: number; delay: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay + index * 150, withTiming(1, { duration: 260, easing: Easing.bezier(0.34, 1.56, 0.64, 1) }));
  }, [v, delay, index]);
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + 0.75 * v.value, transform: [{ scale: 0.6 + 0.4 * v.value }] }));
  return <Animated.Text style={[styles.star, style]}>★</Animated.Text>;
}

const styles = StyleSheet.create({
  root: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  backdrop: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: palette.bgFloor },
  card: {
    width: 320,
    maxWidth: "90%",
    padding: 24,
    gap: 12,
    borderRadius: 24,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    boxShadow: "0px 0px 40px rgba(124, 92, 255, 0.35)",
  },
  titleWrap: { alignItems: "center", marginBottom: 4 },
  title: { fontFamily: fonts.display, fontSize: 32, letterSpacing: 1, textAlign: "center" },
  split: { position: "absolute", left: 0, right: 0 },
  stars: { flexDirection: "row", justifyContent: "center", gap: 10 },
  star: { fontSize: 34, color: palette.gold },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLabel: { fontFamily: fonts.label, fontSize: 15, letterSpacing: 2, color: palette.textSecondary },
  rowValue: { fontFamily: fonts.score, fontSize: 20, color: palette.textPrimary, fontVariant: ["tabular-nums"] },
  rowValueBig: { fontSize: 28 },
  bestRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { backgroundColor: palette.gold, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.button, fontSize: 12, color: palette.ink, letterSpacing: 1 },
  buttons: { gap: 12, marginTop: 8 },
  fullWidth: { minWidth: 0, alignSelf: "stretch" },
  hint: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 2, color: palette.textMuted, textAlign: "center" },
});
