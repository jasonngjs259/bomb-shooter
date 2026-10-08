// Title screen (spec 8.1): the first impression. Skia canvas for the neon
// logo + bomb pile (TitleCanvas), RN for the one big CTA (PLAY), best score
// and the settings button. Tap anywhere to skip the intro.

import { useEffect, useState } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, IconButton } from "./Button";
import { formatScore } from "./Hud";
import { fonts, palette } from "./theme";
import { TitleCanvas } from "./title/TitleCanvas";

interface Props {
  best: number;
  exiting: boolean;
  reduced: boolean;
  onPlay: () => void;
  onSettings: () => void;
}

const PLAY_AT = 1700;
const back = Easing.bezier(0.34, 1.56, 0.64, 1); // easeOutBack-ish

// Three slider lines: a simple "settings" glyph without an icon font
function SettingsGlyph() {
  return (
    <View style={styles.sliders}>
      {[10, 4, 8].map((knob, i) => (
        <View key={i} style={styles.sliderLine}>
          <View style={[styles.sliderKnob, { left: knob }]} />
        </View>
      ))}
    </View>
  );
}

export function TitleScreen({ best, exiting, reduced, onPlay, onSettings }: Props) {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [skip, setSkip] = useState(0);
  const play = useSharedValue(0);
  const breathe = useSharedValue(1);
  const out = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      play.value = withTiming(1, { duration: 300 });
      return;
    }
    play.value = withDelay(PLAY_AT, withTiming(1, { duration: 320, easing: back }));
    breathe.value = withDelay(
      PLAY_AT + 320,
      withRepeat(withSequence(withTiming(0.6, { duration: 900 }), withTiming(1, { duration: 900 })), -1)
    );
  }, [reduced, play, breathe]);

  useEffect(() => {
    if (skip > 0) play.value = withTiming(1, { duration: 200 });
  }, [skip, play]);

  useEffect(() => {
    if (exiting) out.value = withTiming(0, { duration: 180 });
  }, [exiting, out]);

  const playStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, play.value * 1.5) * out.value,
    transform: [{ scale: play.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: breathe.value * play.value * out.value }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, play.value * 1.5) * out.value }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
  };

  const wide = size.w >= 900;
  const web = Platform.OS === "web";

  return (
    <View style={styles.root} onLayout={onLayout}>
      {/* Tap anywhere skips the intro. A plain responder View, not a
          focusable button, so keyboard focus never lands on it and Enter
          always reaches the global "start" key handler. */}
      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => true}
        onResponderRelease={() => setSkip((n) => n + 1)}
      />
      <TitleCanvas width={size.w} height={size.h} exiting={exiting} skip={skip} reduced={reduced} />

      <Animated.View style={[styles.topBar, { top: insets.top + 12, left: insets.left + 16 }, fadeStyle]}>
        <IconButton label="Settings" onPress={onSettings}>
          <SettingsGlyph />
        </IconButton>
      </Animated.View>

      <View style={[styles.bottom, { bottom: insets.bottom + (wide ? 90 : 56) }]}>
        {size.w < 480 ? (
          <View>
            <Text style={styles.tagline}>MATCH 3 · CHAIN THE BLAST</Text>
            <Text style={styles.tagline}>DON'T CROSS THE LINE</Text>
          </View>
        ) : (
          <Text style={[styles.tagline, wide && styles.taglineWide]}>MATCH 3 · CHAIN THE BLAST · DON'T CROSS THE LINE</Text>
        )}
        <Animated.View style={playStyle}>
          <Animated.View style={[styles.playGlow, glowStyle]} />
          <Button label="PLAY" size="lg" onPress={onPlay} style={styles.play} accessibilityHint="Starts a new game" />
        </Animated.View>
        <Animated.View style={[styles.bestRow, fadeStyle]}>
          {best > 0 && (
            <>
              <Text style={styles.bestLabel}>BEST</Text>
              <Text style={styles.bestValue}>{formatScore(best, 1)}</Text>
            </>
          )}
        </Animated.View>
        {web && <Animated.Text style={[styles.hint, fadeStyle]}>SPACE / ENTER TO PLAY</Animated.Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  topBar: { position: "absolute" },
  bottom: { position: "absolute", left: 0, right: 0, alignItems: "center", gap: 18, pointerEvents: "box-none" },
  tagline: {
    fontFamily: fonts.label,
    fontSize: 13,
    letterSpacing: 2,
    color: palette.textSecondary,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  taglineWide: { fontSize: 16 },
  play: { width: 280 },
  playGlow: {
    position: "absolute",
    left: -8,
    right: -8,
    top: -8,
    bottom: -8,
    borderRadius: 40,
    boxShadow: "0px 0px 36px rgba(34, 242, 255, 0.85)",
  },
  bestRow: { flexDirection: "row", alignItems: "baseline", gap: 10, minHeight: 28 },
  bestLabel: { fontFamily: fonts.label, fontSize: 16, letterSpacing: 2, color: palette.textSecondary },
  bestValue: { fontFamily: fonts.score, fontSize: 22, color: palette.gold },
  hint: { fontFamily: fonts.label, fontSize: 13, letterSpacing: 2, color: palette.textMuted },
  sliders: { width: 20, gap: 4 },
  sliderLine: { height: 2, borderRadius: 1, backgroundColor: palette.textPrimary },
  sliderKnob: { position: "absolute", top: -2, width: 6, height: 6, borderRadius: 3, backgroundColor: palette.cyan },
});
