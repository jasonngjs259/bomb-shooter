// First-run tutorial (spec section 9): a ghost hand (or mouse cursor on
// desktop web) sweeps an aim arc above the cannon with a banner, until the
// first shot. Then "TAP TO SWAP" points at the next socket for 3s. Shown
// once: persisted as AsyncStorage "bs.tutorialSeen". Never blocks touches.

import { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { GameEngineView, GamePhase } from "../game/types";
import { BoardLayout } from "../render/layout";
import { loadTutorialSeen, saveTutorialSeen } from "../storage/settings";
import { fonts, palette } from "./theme";

// Lucide "pointer" (hand) and "mouse-pointer-2" outlines, 24x24 viewBox
const HAND =
  "M22 14a8 8 0 0 1-8 8 M18 11v-1a2 2 0 0 0-4 0 M14 10V9a2 2 0 0 0-4 0v1 M10 9.5V4a2 2 0 0 0-4 0v10 M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15";
const CURSOR =
  "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z";

const isFinePointer = () => {
  if (Platform.OS !== "web" || typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: fine)").matches;
};

const LOOP = 2.4;
const ARC_R = 90; // board units above the pivot

interface Props {
  engine: GameEngineView;
  phase: GamePhase;
  layout: BoardLayout;
  reduced: boolean;
}

export function FirstRunHint({ engine, phase, layout, reduced }: Props) {
  const [seen, setSeen] = useState<boolean | null>(null);
  const [swapHintUntil, setSwapHintUntil] = useState(0);
  const desktop = useMemo(isFinePointer, []);
  const t = useSharedValue(0);

  useEffect(() => {
    let alive = true;
    loadTutorialSeen().then((v) => alive && setSeen(v));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (seen !== false) return;
    return engine.on("shoot", () => {
      setSeen(true);
      saveTutorialSeen();
      setSwapHintUntil(Date.now() + 3000);
    });
  }, [engine, seen]);

  useEffect(() => {
    if (swapHintUntil === 0) return;
    const id = setTimeout(() => setSwapHintUntil(0), Math.max(0, swapHintUntil - Date.now()));
    return () => clearTimeout(id);
  }, [swapHintUntil]);

  useEffect(() => {
    if (reduced) {
      t.value = 0.9;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(LOOP, { duration: LOOP * 1000, easing: Easing.linear }), -1);
  }, [reduced, t]);

  const s = layout.scale;
  const shooter = engine.getShooter();
  const next = engine.getNextBomb();
  const px = layout.offsetX + shooter.x * s;
  const py = layout.offsetY + shooter.y * s;
  const r = ARC_R * s;
  const still = reduced;

  const handStyle = useAnimatedStyle(() => {
    const k = t.value;
    let angle = -35;
    if (k > 0.2 && k < 1.6) {
      const u = (k - 0.2) / 1.4;
      angle = -35 + 70 * (-(Math.cos(Math.PI * u) - 1) / 2);
    } else if (k >= 1.6) angle = 35;
    const a = (angle * Math.PI) / 180;
    let opacity = 1;
    if (k < 0.2) opacity = k / 0.2;
    else if (k > 1.9) opacity = Math.max(0, 1 - (k - 1.9) / 0.5);
    const press = k > 1.6 && k < 1.9 ? 0.9 + 0.1 * ((k - 1.6) / 0.3) : 1;
    return {
      opacity: still ? 1 : opacity,
      transform: [
        { translateX: still ? 0 : Math.sin(a) * r },
        { translateY: still ? -r : -Math.cos(a) * r },
        { scale: press },
      ],
    };
  });

  const icon = useMemo(() => Skia.Path.MakeFromSVGString(desktop ? CURSOR : HAND), [desktop]);

  const showMain = seen === false && phase === "ready";
  const showSwap = swapHintUntil > 0 && (phase === "ready" || phase === "shooting" || phase === "resolving");
  if (!showMain && !showSwap) return null;

  const bannerTop = py - (ARC_R + 70) * s;
  // Swap hint sits clear above the socket's tap target (same size formula
  // as SwapButton) so it never covers the NEXT bomb or its swap badge
  const swapCx = layout.offsetX + next.x * s;
  const targetHalf = Math.max(56, 2 * engine.config.radius * 1.5 * s) / 2;
  const swapTop = layout.offsetY + next.y * s - targetHalf - 50;
  return (
    <View style={styles.root}>
      {showMain && (
        <>
          <Animated.View style={[styles.hand, { left: px - (desktop ? 8 : 16), top: py - (desktop ? 8 : 4) }, handStyle]}>
            {icon && (
              <Canvas style={styles.handCanvas}>
                <Path path={icon} color={palette.cyan} style="stroke" strokeWidth={4} strokeJoin="round" strokeCap="round" opacity={0.45} transform={[{ scale: 2 }]} />
                <Path path={icon} color="rgba(255,255,255,0.85)" style="stroke" strokeWidth={2} strokeJoin="round" strokeCap="round" transform={[{ scale: 2 }]} />
              </Canvas>
            )}
          </Animated.View>
          <View style={[styles.banner, { top: bannerTop }]}>
            <Text style={styles.bannerText}>
              {desktop ? "MOVE MOUSE TO AIM · CLICK TO FIRE · ←/→ · SPACE" : "DRAG TO AIM · RELEASE TO FIRE"}
            </Text>
          </View>
        </>
      )}
      {showSwap && (
        <View style={[styles.swap, { left: Math.max(8, swapCx - 130), top: swapTop }]}>
          <Text style={styles.swapText}>{desktop ? "CLICK NEXT · X · RIGHT-CLICK TO SWAP" : "TAP NEXT TO SWAP"}</Text>
          <Text style={styles.arrow}>▼</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, pointerEvents: "none" },
  hand: { position: "absolute", width: 48, height: 48 },
  handCanvas: { width: 48, height: 48 },
  banner: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  bannerText: {
    fontFamily: fonts.label,
    fontSize: 16,
    letterSpacing: 1.5,
    color: palette.textPrimary,
    backgroundColor: palette.panel,
    borderColor: palette.panelBorder,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
    overflow: "hidden",
    textAlign: "center",
  },
  swap: { position: "absolute", width: 260, alignItems: "center" },
  swapText: {
    fontFamily: fonts.label,
    fontSize: 14,
    letterSpacing: 1.5,
    color: palette.ink,
    backgroundColor: palette.cyan,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    overflow: "hidden",
  },
  arrow: { color: palette.cyan, fontSize: 12, marginTop: 2 },
});
