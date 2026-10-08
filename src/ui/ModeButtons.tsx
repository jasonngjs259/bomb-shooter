// Title mode select (arena spec section 8): ARENA 360 (primary, NEW badge
// until the first Arena game ends) and CLASSIC (secondary). Phone: stacked
// 280x64 / 280x56 buttons + a BEST line; desktop: two 300x132 cards with a
// subtitle and BEST, plus the key hint. The selected mode (last played by
// default) gets the focus ring; Left/Right, 1/2 and Enter are handled by
// GameScreen.

import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { uiSound } from "../audio";
import { formatScore } from "./Hud";
import { fonts, gradients, palette } from "./theme";

export type GameMode = "arena" | "classic";
const native = Platform.OS !== "web";

interface Props {
  desktop: boolean;
  selected: GameMode;
  arenaNew: boolean;
  bestArena: number;
  bestClassic: number;
  still: boolean;
  onPlay: (mode: GameMode) => void;
  onSelect: (mode: GameMode) => void;
}

function OrbitIcon({ color }: { color: string }) {
  return (
    <View style={[styles.orbit, { borderColor: color }]}>
      <View style={[styles.orbitDot, { backgroundColor: color }]} />
    </View>
  );
}

function HexIcon({ color }: { color: string }) {
  return <View style={[styles.hex, { borderColor: color }]} />;
}

function NewBadge({ still }: { still: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 450, useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: 450, useNativeDriver: native }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, still]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  return (
    <Animated.View style={[styles.badge, { transform: [{ rotate: "8deg" }, { scale }] }]}>
      <Text style={styles.badgeText}>NEW</Text>
    </Animated.View>
  );
}

export function ModeButtons({ desktop, selected, arenaNew, bestArena, bestClassic, still, onPlay, onSelect }: Props) {
  const item = (mode: GameMode) => {
    const arena = mode === "arena";
    const focus = selected === mode;
    const ink = arena ? palette.ink : palette.textPrimary;
    return (
      <Pressable
        key={mode}
        accessibilityRole="button"
        accessibilityLabel={arena ? "Play Arena 360" : "Play Classic"}
        onPress={() => {
          uiSound("click");
          onPlay(mode);
        }}
        onHoverIn={() => {
          if (selected !== mode) uiSound("hover");
          onSelect(mode);
        }}
        style={({ pressed }) => [
          desktop ? styles.card : arena ? styles.primary : styles.secondary,
          !arena && styles.secondaryFill,
          focus && styles.focus,
          pressed && styles.pressed,
        ]}
      >
        {arena && (
          <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: desktop ? 22 : 32 }]} />
        )}
        <View style={styles.titleRow}>
          {arena ? <OrbitIcon color={ink} /> : <HexIcon color={palette.cyan} />}
          <Text style={[styles.label, { color: ink, fontSize: desktop ? 26 : arena ? 24 : 21 }]}>{arena ? "ARENA 360" : "CLASSIC"}</Text>
        </View>
        {desktop && <Text style={[styles.sub, { color: arena ? palette.ink : palette.textSecondary }]}>{arena ? "MOVE · AIM · 360" : "AIM · MATCH 3"}</Text>}
        {desktop && (
          <Text style={[styles.sub, { color: arena ? palette.ink : palette.textSecondary }]}>
            BEST {formatScore(arena ? bestArena : bestClassic)}
          </Text>
        )}
        {arena && arenaNew && <NewBadge still={still} />}
      </Pressable>
    );
  };
  return (
    <View style={styles.wrap}>
      <View style={desktop ? styles.rowDesktop : styles.colPhone}>
        {item("arena")}
        {item("classic")}
      </View>
      {desktop ? (
        <Text style={styles.hint}>← / → CHOOSE · ENTER PLAY · 1 / 2</Text>
      ) : (
        (bestArena > 0 || bestClassic > 0) && (
          <Text style={styles.best}>
            BEST  ARENA <Text style={styles.bestValue}>{formatScore(bestArena)}</Text>  ·  CL <Text style={styles.bestValue}>{formatScore(bestClassic)}</Text>
          </Text>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 12 },
  colPhone: { alignItems: "center", gap: 16 },
  rowDesktop: { flexDirection: "row", gap: 24 },
  primary: { width: 280, maxWidth: "100%", height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", cursor: "pointer" },
  secondary: { width: 280, maxWidth: "100%", height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", cursor: "pointer" },
  secondaryFill: { backgroundColor: palette.panelSolid, borderWidth: 2, borderColor: palette.cyan },
  card: { width: 300, height: 132, borderRadius: 22, padding: 18, justifyContent: "center", gap: 6, cursor: "pointer" },
  focus: { outlineColor: palette.textPrimary, outlineWidth: 2, outlineStyle: "solid", outlineOffset: 4, borderColor: palette.textPrimary },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { fontFamily: fonts.button, letterSpacing: 1.6 },
  sub: { fontFamily: fonts.label, fontSize: 14, letterSpacing: 1.4 },
  orbit: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, alignItems: "flex-end", justifyContent: "flex-start" },
  orbitDot: { width: 7, height: 7, borderRadius: 4, marginTop: -2, marginRight: -2 },
  hex: { width: 18, height: 18, borderWidth: 2.5, borderRadius: 4, transform: [{ rotate: "45deg" }] },
  badge: {
    position: "absolute", top: -8, right: -6, width: 40, height: 20, borderRadius: 4, backgroundColor: palette.gold,
    alignItems: "center", justifyContent: "center",
  },
  badgeText: { fontFamily: fonts.button, fontSize: 12, letterSpacing: 1, color: palette.ink },
  hint: { fontFamily: fonts.label, fontSize: 13, letterSpacing: 1.6, color: palette.textMuted },
  best: { fontFamily: fonts.label, fontSize: 14, letterSpacing: 1.5, color: palette.textSecondary },
  bestValue: { fontFamily: fonts.score, fontSize: 15, color: palette.gold },
});
