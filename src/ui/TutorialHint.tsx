// First-run hint, shown once (AsyncStorage "bs.tutorialSeen"): a ghost
// finger (or cursor on desktop) sweeps an aim arc above the launcher with a
// banner; after the first shot a 3s swap hint points at the NEXT socket.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { GameEngineView } from "../game/types";
import { BoardLayout } from "../render/layout";
import { fonts, palette } from "./theme";

const KEY = "bs.tutorialSeen";
const native = Platform.OS !== "web";

const finePointer = () =>
  Platform.OS === "web" && typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: fine)").matches
    : false;

type Stage = "loading" | "aim" | "swap" | "done";

interface Props {
  engine: GameEngineView;
  layout: BoardLayout;
  active: boolean; // game screen showing and a shot is ready
  still: boolean;
}

export function TutorialHint({ engine, layout, active, still }: Props) {
  const [stage, setStage] = useState<Stage>("loading");
  const loop = useRef(new Animated.Value(0)).current;
  const desktop = useRef(finePointer()).current;

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((v) => alive && setStage(v ? "done" : "aim"))
      .catch(() => alive && setStage("aim"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (stage !== "aim") return;
    return engine.on("shoot", () => {
      AsyncStorage.setItem(KEY, "1").catch(() => undefined);
      setStage("swap");
    });
  }, [engine, stage]);

  useEffect(() => {
    if (stage !== "swap") return;
    const id = setTimeout(() => setStage("done"), 3000);
    return () => clearTimeout(id);
  }, [stage]);

  useEffect(() => {
    if (stage !== "aim" || still) return;
    const anim = Animated.loop(Animated.timing(loop, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: native }));
    anim.start();
    return () => anim.stop();
  }, [stage, still, loop]);

  if (!active || stage === "loading" || stage === "done") return null;

  const s = layout.scale;
  const shooter = engine.getShooter();
  const next = engine.getNextBomb();
  const px = shooter.x * s + layout.offsetX;
  const py = shooter.y * s + layout.offsetY;

  if (stage === "swap") {
    const nx = next.x * s + layout.offsetX;
    const ny = next.y * s + layout.offsetY;
    return (
      <View style={[styles.row, { left: Math.max(8, nx - 60 * s - 60), width: 240, top: ny - 64 * s - 36, alignItems: "flex-start" }]}>
        <View style={styles.pill}>
          <Text style={styles.text}>{desktop ? "CLICK NEXT · X TO SWAP" : "TAP NEXT TO SWAP"}</Text>
        </View>
      </View>
    );
  }

  // Arc sweep -35deg..+35deg at radius 110u above the pivot
  const R = 110 * s;
  const angles = [-35, -17.5, 0, 17.5, 35];
  const at = (deg: number) => ({ x: Math.sin((deg * Math.PI) / 180) * R, y: -Math.cos((deg * Math.PI) / 180) * R });
  const input = [0, 0.083, 0.25, 0.42, 0.58, 0.667, 0.79, 1];
  const xs = [at(-35).x, ...angles.map((a) => at(a).x), at(35).x, at(35).x];
  const ys = [at(-35).y, ...angles.map((a) => at(a).y), at(35).y, at(35).y];
  const tx = still ? at(0).x : loop.interpolate({ inputRange: input, outputRange: xs });
  const ty = still ? at(0).y : loop.interpolate({ inputRange: input, outputRange: ys });
  const opacity = still ? 0.85 : loop.interpolate({ inputRange: [0, 0.083, 0.79, 1], outputRange: [0, 0.85, 0.85, 0] });
  const press = still ? 1 : loop.interpolate({ inputRange: [0, 0.667, 0.7, 0.79, 1], outputRange: [1, 1, 0.9, 1, 1] });
  const ripple = loop.interpolate({ inputRange: [0, 0.667, 0.79, 1], outputRange: [0, 0, 1, 1] });
  const rippleOpacity = loop.interpolate({ inputRange: [0, 0.667, 0.68, 0.79, 1], outputRange: [0, 0, 0.8, 0, 0] });

  return (
    <View style={styles.layer}>
      <Animated.View
        style={[
          desktop ? styles.cursor : styles.finger,
          { left: px - 24, top: py - 24, opacity, transform: [{ translateX: tx }, { translateY: ty }, { scale: press }] },
        ]}
      >
        {desktop && !still && (
          <Animated.View style={[styles.ripple, { opacity: rippleOpacity, transform: [{ scale: ripple }] }]} />
        )}
      </Animated.View>
      <View style={[styles.row, { left: 0, right: 0, top: py - 170 * s - 24 }]}>
        <View style={styles.pill}>
          <Text style={styles.text}>{desktop ? "MOVE MOUSE TO AIM · CLICK TO FIRE" : "DRAG TO AIM · RELEASE TO FIRE"}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, pointerEvents: "none" },
  finger: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.8)",
    borderWidth: 3,
    borderColor: palette.cyan,
    shadowColor: palette.cyan,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  cursor: {
    position: "absolute",
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.8)",
    shadowColor: palette.cyan,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  ripple: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: palette.cyan },
  row: { position: "absolute", alignItems: "center", pointerEvents: "none" },
  pill: {
    maxWidth: 340,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    alignItems: "center",
    pointerEvents: "none",
  },
  text: { fontFamily: fonts.label, fontSize: 16, letterSpacing: 1.5, color: palette.textPrimary, textAlign: "center" },
});
