// Title mode select (arena spec section 8): ARENA 360 (primary, NEW badge
// until the first Arena game ends) and CLASSIC (secondary). Phone: stacked
// 280x64 / 280x56 buttons + a BEST line; desktop: two 300x132 cards with a
// subtitle and BEST, plus the key hint. The selected mode (last played by
// default) gets the focus ring; Left/Right, 1/2 and Enter are handled by
// GameScreen. HANGAR (fun pass: skins + level select, H key) is a 280x48
// secondary button under the ARENA 360 button / card.

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
  compact?: boolean; // short landscape: ARENA | CLASSIC in a row (56pt), HANGAR under them
  selected: GameMode;
  arenaNew: boolean;
  bestArena: number;
  bestClassic: number;
  still: boolean;
  onPlay: (mode: GameMode) => void;
  onSelect: (mode: GameMode) => void;
  onHangar: () => void;
  stars: number; // Arena stars earned (shown on HANGAR)
}

function HangarButton({ onPress, stars }: { onPress: () => void; stars: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Hangar: skins and level select, ${stars} stars`}
      onPress={() => {
        uiSound("click");
        onPress();
      }}
      onHoverIn={() => uiSound("hover")}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.hangar, hovered && styles.hangarHover, pressed && styles.pressed]}
    >
      <Text style={styles.hangarText}>HANGAR</Text>
      {stars > 0 && <Text style={styles.hangarStars}>★ {stars}</Text>}
    </Pressable>
  );
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

export function ModeButtons({ desktop, compact = false, selected, arenaNew, bestArena, bestClassic, still, onPlay, onSelect, onHangar, stars }: Props) {
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
          desktop ? styles.card : compact ? styles.compactBtn : arena ? styles.primary : styles.secondary,
          !arena && styles.secondaryFill,
          focus && styles.focus,
          pressed && styles.pressed,
        ]}
      >
        {arena && (
          <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: desktop ? 22 : compact ? 28 : 32 }]} />
        )}
        <View style={styles.titleRow}>
          {arena ? <OrbitIcon color={ink} /> : <HexIcon color={palette.cyan} />}
          <Text style={[styles.label, { color: ink, fontSize: desktop ? 26 : compact ? 21 : arena ? 24 : 21 }]}>{arena ? "ARENA 360" : "CLASSIC"}</Text>
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
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {compact ? (
        <>
          <View style={styles.rowCompact}>
            {item("arena")}
            {item("classic")}
          </View>
          <HangarButton onPress={onHangar} stars={stars} />
        </>
      ) : desktop ? (
        <View style={styles.rowDesktop}>
          <View style={styles.colArena}>
            {item("arena")}
            <HangarButton onPress={onHangar} stars={stars} />
          </View>
          {item("classic")}
        </View>
      ) : (
        <View style={styles.colPhone}>
          {item("arena")}
          <HangarButton onPress={onHangar} stars={stars} />
          {item("classic")}
        </View>
      )}
      {desktop ? (
        <Text style={styles.hint}>← / → CHOOSE · ENTER PLAY · 1 / 2 · H HANGAR</Text>
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
  colPhone: { alignItems: "center", gap: 12 },
  wrapCompact: { gap: 10 },
  rowCompact: { flexDirection: "row", gap: 16 },
  compactBtn: { width: 250, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", cursor: "pointer" },
  rowDesktop: { flexDirection: "row", gap: 24, alignItems: "flex-start" },
  colArena: { alignItems: "center", gap: 12 },
  hangar: {
    width: 280, maxWidth: "100%", height: 48, borderRadius: 24, flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(22, 10, 51, 0.88)", borderWidth: 1.5, borderColor: palette.magenta, cursor: "pointer",
  },
  hangarHover: { borderColor: palette.textPrimary },
  hangarText: { fontFamily: fonts.button, fontSize: 18, letterSpacing: 2, color: palette.textPrimary },
  hangarStars: { fontFamily: fonts.score, fontSize: 13, color: palette.gold },
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
  best: { fontFamily: fonts.label, fontSize: 14, lineHeight: 20, letterSpacing: 1.5, color: palette.textSecondary },
  bestValue: { fontFamily: fonts.score, fontSize: 15, color: palette.gold },
});
