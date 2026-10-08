// Game-over / board-clear card: dim overlay fades in, card rises 40pt.
// Score counts up over 900ms, NEW BEST badge pulses, GAME OVER glitches
// (RGB split for 2 frames every 1.6s), BOARD CLEAR fills 3 stars.

import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { formatScore } from "./Hud";
import { fonts, palette, spacing } from "./theme";

const native = Platform.OS !== "web";

interface Props {
  won: boolean;
  score: number;
  best: number;
  isNewBest: boolean;
  biggestCombo: number;
  still: boolean;
  onRetry: () => void;
  onMenu: () => void;
}

function useCountUp(target: number, duration: number) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = Date.now();
    const tick = () => {
      const k = Math.min(1, (Date.now() - t0) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

export function GameOverOverlay({ won, score, best, isNewBest, biggestCombo, still, onRetry, onMenu }: Props) {
  const fade = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;
  const glitch = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const stars = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const shown = useCountUp(score, still ? 1 : 900);

  useEffect(() => {
    const anims: Animated.CompositeAnimation[] = [
      Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: native }),
      Animated.timing(card, { toValue: 1, duration: 320, delay: 80, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
    ];
    if (!still) {
      anims.push(
        Animated.loop(
          Animated.sequence([
            Animated.delay(1600),
            Animated.timing(glitch, { toValue: 1, duration: 0, useNativeDriver: native }),
            Animated.delay(34),
            Animated.timing(glitch, { toValue: 0, duration: 0, useNativeDriver: native }),
          ])
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: native }),
            Animated.timing(pulse, { toValue: 0, duration: 450, useNativeDriver: native }),
          ])
        )
      );
    }
    stars.forEach((v, i) =>
      anims.push(Animated.timing(v, { toValue: 1, duration: 260, delay: 500 + i * 150, easing: Easing.out(Easing.back(1.6)), useNativeDriver: native }))
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [fade, card, glitch, pulse, stars, still]);

  const title = won ? "BOARD CLEAR!" : "GAME OVER";
  const titleColor = won ? palette.gold : palette.danger;
  const rise = card.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  const badgeScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: fade }]}>
      <Animated.View style={[styles.card, { opacity: card, transform: [{ translateY: rise }] }]}>
        <View>
          {!won && (
            <>
              <Animated.Text style={[styles.title, styles.split, { fontSize: 30, color: palette.cyan, opacity: glitch, transform: [{ translateX: -3 }] }]}>
                {title}
              </Animated.Text>
              <Animated.Text style={[styles.title, styles.split, { fontSize: 30, color: palette.magenta, opacity: glitch, transform: [{ translateX: 3 }] }]}>
                {title}
              </Animated.Text>
            </>
          )}
          <Text style={[styles.title, { color: titleColor, textShadowColor: titleColor, fontSize: won ? 24 : 30 }]}>{title}</Text>
        </View>
        {won && (
          <View style={styles.stars}>
            {stars.map((v, i) => (
              <Animated.Text key={i} style={[styles.star, { transform: [{ scale: v }] }]}>
                ★
              </Animated.Text>
            ))}
          </View>
        )}
        <View style={styles.rows}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>SCORE</Text>
            <Text style={styles.rowValue}>{formatScore(shown)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>BEST</Text>
            <Text style={[styles.rowValue, { color: palette.gold }]}>{formatScore(Math.max(best, score))}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>BIGGEST COMBO</Text>
            <Text style={styles.rowValue}>x{Math.max(1, biggestCombo)}</Text>
          </View>
        </View>
        {isNewBest && (
          <Animated.View style={[styles.badge, { transform: [{ scale: badgeScale }] }]}>
            <Text style={styles.badgeText}>NEW BEST</Text>
          </Animated.View>
        )}
        <Button label="Play again" size="lg" onPress={onRetry} />
        <Button label="Menu" size="md" variant="secondary" onPress={onMenu} />
        {Platform.OS === "web" && <Text style={styles.hint}>SPACE · PLAY AGAIN</Text>}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: palette.overlay, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: {
    width: 320,
    maxWidth: "92%",
    padding: spacing.xl,
    borderRadius: 24,
    backgroundColor: palette.panelSolid,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    alignItems: "center",
    gap: spacing.md,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 32,
    textAlign: "center",
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 0 },
  },
  split: { position: "absolute", left: 0, right: 0, textShadowRadius: 0 },
  stars: { flexDirection: "row", gap: 10 },
  star: { fontSize: 34, color: palette.gold, textShadowColor: palette.gold, textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } },
  rows: { alignSelf: "stretch", gap: 6, marginVertical: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  rowLabel: { fontFamily: fonts.label, fontSize: 15, letterSpacing: 1.5, color: palette.textSecondary },
  rowValue: { fontFamily: fonts.score, fontSize: 20, color: palette.textPrimary, fontVariant: ["tabular-nums"] },
  badge: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 999, backgroundColor: palette.gold },
  badgeText: { fontFamily: fonts.button, fontSize: 16, letterSpacing: 2, color: palette.ink },
  hint: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 1.5, color: palette.textMuted },
});
