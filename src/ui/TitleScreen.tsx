// Title screen overlay (the first impression). The 3D scene behind it draws
// the lit-fuse bomb that stands in for the logo's "O" and the bomb pile; this
// view draws the neon logo text (sign-tube ignite flicker), the mode buttons
// (ARENA 360 / CLASSIC, scale in after the ignite) and BEST. Tap anywhere
// to skip the intro: that layer is a plain responder view, not a focusable
// button, so keyboard focus never lands on it and Enter keeps working.

import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { IconButton } from "./Button";
import { GameMode, ModeButtons } from "./ModeButtons";
import { fonts, palette } from "./theme";
import { titleLayout } from "./titleLayout";
import { textGlow } from "./webSafe";

const native = Platform.OS !== "web";
const TAGLINE = "MATCH 3 · CHAIN THE BLAST · DON'T CROSS THE LINE";
// Two balanced lines where the single line (~440pt with its backing) won't
// fit (titleLayout decides; it also reserves the height).
const TAGLINE_2 = "MATCH 3 · CHAIN THE BLAST\nDON'T CROSS THE LINE";

interface Props {
  width: number;
  height: number;
  best: number; // Classic
  bestArena: number;
  arenaNew: boolean;
  selected: GameMode;
  onSelect: (mode: GameMode) => void;
  still: boolean; // reduced motion
  detonating: boolean;
  topInset: number;
  onPlay: (mode: GameMode) => void;
  onSettings: () => void;
  onHangar: () => void;
  stars: number;
}

function GearGlyph() {
  return (
    <View style={styles.gear}>
      {[0, 45, 90, 135].map((r) => (
        <View key={r} style={[styles.gearTooth, { transform: [{ rotate: `${r}deg` }] }]} />
      ))}
      <View style={styles.gearRing} />
    </View>
  );
}

export function TitleScreen({
  width, height, best, bestArena, arenaNew, selected, onSelect, still, detonating, topInset, onPlay, onSettings, onHangar, stars,
}: Props) {
  const tl = titleLayout(width, height);
  const logo = useRef(new Animated.Value(0)).current;
  const play = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(0)).current;

  const intro = useMemo(() => {
    if (still) {
      return Animated.parallel([
        Animated.timing(logo, { toValue: 1, duration: 300, useNativeDriver: native }),
        Animated.timing(play, { toValue: 1, duration: 300, delay: 150, useNativeDriver: native }),
      ]);
    }
    // neon ignite: 0,1,0,1,0.3,1 at 0/80/140/260/320/420ms, starting at 900ms
    const step = (v: number, d: number) => Animated.timing(logo, { toValue: v, duration: d, easing: Easing.step0, useNativeDriver: native });
    return Animated.parallel([
      Animated.sequence([Animated.delay(900), step(1, 1), step(0, 80), step(1, 60), step(0, 120), step(0.3, 60), step(1, 100)]),
      Animated.timing(play, { toValue: 1, duration: 320, delay: 1700, easing: Easing.out(Easing.back(1.6)), useNativeDriver: native }),
    ]);
  }, [still, logo, play]);

  useEffect(() => {
    intro.start();
    return () => intro.stop();
  }, [intro]);

  useEffect(() => {
    if (detonating) Animated.timing(out, { toValue: 1, duration: 260, useNativeDriver: native }).start();
  }, [detonating, out]);

  const skip = () => {
    intro.stop();
    logo.setValue(1);
    play.setValue(1);
  };

  const fs = tl.fontSize;
  const half = tl.slotSize / 2;
  const logoStyle = [styles.logo, { fontSize: fs, lineHeight: fs * 1.15, top: tl.logoY - fs * 0.6 }];
  const fadeOut = out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const blast = out.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });

  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} onResponderRelease={skip} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.none, { opacity: Animated.multiply(logo, fadeOut), transform: [{ scale: blast }] }]}>
        <Text style={[logoStyle, { right: width - (tl.slotX - half) + fs * 0.04, textAlign: "right" }]}>B</Text>
        <Text style={[logoStyle, { left: tl.slotX + half + fs * 0.04 }]}>MB</Text>
        <Text style={[styles.sub, { fontSize: fs * 0.6, top: tl.subY - fs * 0.38, letterSpacing: fs * 0.12 }]}>SHOOTER</Text>
        <View style={[styles.tagRow, { top: tl.tagY }]}>
          <Text style={styles.tag}>{tl.tagLines === 2 ? TAGLINE_2 : TAGLINE}</Text>
        </View>
      </Animated.View>

      <Animated.View
        style={[
          styles.playWrap,
          {
            top: tl.playY - (tl.desktop ? 66 : 68),
            opacity: Animated.multiply(play, fadeOut),
            transform: [{ scale: still ? 1 : play }],
            pointerEvents: detonating ? "none" : "box-none",
          },
        ]}
      >
        <ModeButtons
          desktop={tl.desktop} selected={selected} arenaNew={arenaNew} bestArena={bestArena} bestClassic={best} still={still}
          onPlay={onPlay} onSelect={onSelect} onHangar={onHangar} stars={stars}
        />
      </Animated.View>

      <View style={[styles.topRight, { top: topInset + 8 }]}>
        <IconButton label="Settings" onPress={onSettings}>
          <GearGlyph />
        </IconButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  none: { pointerEvents: "none" },
  logo: {
    position: "absolute",
    fontFamily: fonts.display,
    color: palette.textPrimary,
    letterSpacing: 2,
    ...textGlow(palette.magenta, 14, 3),
  },
  sub: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: fonts.display,
    color: palette.cyan,
    ...textGlow(palette.cyan, 12, 2),
  },
  // Dark translucent backing: the tagline sits over the bright sun.
  tagRow: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  tag: {
    textAlign: "center",
    fontFamily: fonts.label,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 2,
    color: palette.textPrimary,
    backgroundColor: "rgba(11, 4, 32, 0.72)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: "hidden",
  },
  playWrap: { position: "absolute", left: 16, right: 16, alignItems: "center", gap: 14 },
  topRight: { position: "absolute", right: 16 },
  gear: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  gearTooth: { position: "absolute", width: 4, height: 22, borderRadius: 1, backgroundColor: palette.textPrimary },
  gearRing: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 3.5,
    borderColor: palette.textPrimary,
    backgroundColor: palette.panelSolid,
  },
});
