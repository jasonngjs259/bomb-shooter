// First-run hint, shown once (AsyncStorage "bs.tutorialSeen"): a ghost
// finger (or an arrow cursor on desktop) sweeps an aim arc above the
// launcher; the instruction pill sits beside the launcher, in the empty
// bottom-right corner of the board, clear of the aim path. After the first
// shot a 3s swap hint points at the NEXT socket.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { GameEngineView } from "../game/types";
import { BoardLayout } from "../render/layout";
import { fonts, palette } from "./theme";
import { ownLayer } from "./webSafe";

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

// Pointer glyphs, built from plain views. The hot spot (tip / fingertip) is
// at the glyph's (0, 0); callers position it there.
function ArrowCursor() {
  return (
    <View style={styles.arrow}>
      <View style={[styles.arrowHead, styles.arrowHeadOutline]} />
      <View style={[styles.arrowTail, styles.arrowTailOutline]} />
      <View style={styles.arrowHead} />
      <View style={styles.arrowTail} />
    </View>
  );
}

function Finger() {
  return (
    <View style={styles.fingerWrap}>
      <View style={styles.touch} />
      <View style={styles.finger} />
    </View>
  );
}

const ANGLES = [-35, -17.5, 0, 17.5, 35];
const INPUT = [0, 0.083, 0.25, 0.42, 0.58, 0.667, 0.79, 1];

export const TutorialHint = memo(function TutorialHint({ engine, layout, active, still }: Props) {
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

  // Arc sweep -35deg..+35deg at radius 110u above the pivot (memoised so the
  // animated nodes are not rebuilt on every render).
  const s = layout.scale;
  const sweep = useMemo(() => {
    const R = 110 * s;
    const at = (deg: number) => ({ x: Math.sin((deg * Math.PI) / 180) * R, y: -Math.cos((deg * Math.PI) / 180) * R });
    const xs = [at(-35).x, ...ANGLES.map((a) => at(a).x), at(35).x, at(35).x];
    const ys = [at(-35).y, ...ANGLES.map((a) => at(a).y), at(35).y, at(35).y];
    return {
      rest: at(0),
      tx: loop.interpolate({ inputRange: INPUT, outputRange: xs }),
      ty: loop.interpolate({ inputRange: INPUT, outputRange: ys }),
      opacity: loop.interpolate({ inputRange: [0, 0.083, 0.79, 1], outputRange: [0, 0.9, 0.9, 0] }),
      press: loop.interpolate({ inputRange: [0, 0.667, 0.7, 0.79, 1], outputRange: [1, 1, 0.85, 1, 1] }),
    };
  }, [s, loop]);

  if (!active || stage === "loading" || stage === "done") return null;

  const shooter = engine.getShooter();
  const next = engine.getNextBomb();
  const m = engine.getBoardMetrics();
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

  const motion = still
    ? { opacity: 0.9, transform: [{ translateX: sweep.rest.x }, { translateY: sweep.rest.y }] }
    : {
        opacity: sweep.opacity,
        transform: [...ownLayer, { translateX: sweep.tx }, { translateY: sweep.ty }, { scale: sweep.press }],
      };
  // Pill: right of the launcher (clear of the dome) up to the right wall.
  const pillLeft = (shooter.x + 60) * s + layout.offsetX;
  const pillRight = (m.width - 4) * s + layout.offsetX;
  return (
    <View style={styles.layer}>
      <Animated.View style={[styles.ghost, { left: px, top: py }, motion]}>
        {desktop ? <ArrowCursor /> : <Finger />}
      </Animated.View>
      <View style={[styles.row, { left: pillLeft, width: Math.max(96, pillRight - pillLeft), top: py - 22, alignItems: "flex-start" }]}>
        <View style={[styles.pill, styles.pillSide]}>
          <Text style={[styles.text, styles.textSide, desktop && styles.textSideDesktop, s < 0.7 && styles.textSideNarrow]}>
            {desktop ? "MOVE MOUSE TO AIM\nCLICK TO FIRE" : "DRAG TO AIM\nRELEASE TO FIRE"}
          </Text>
        </View>
      </View>
    </View>
  );
});

const INK = "rgba(11, 4, 32, 0.9)";

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, pointerEvents: "none" },
  ghost: { position: "absolute", width: 0, height: 0, overflow: "visible" },
  // Arrow cursor, tip at (0,0), tilted like a desktop pointer.
  arrow: { position: "absolute", left: -3, top: -2, width: 22, height: 36, transform: [{ rotate: "-25deg" }] },
  arrowHead: {
    position: "absolute",
    left: 1,
    top: 1,
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 24,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: palette.textPrimary,
  },
  arrowHeadOutline: {
    left: -1,
    top: -2,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 28,
    borderBottomColor: INK,
  },
  arrowTail: { position: "absolute", left: 8, top: 21, width: 6, height: 13, backgroundColor: palette.textPrimary },
  arrowTailOutline: { left: 6.5, top: 20, width: 9, height: 16, backgroundColor: INK },
  // Finger: a fingertip with a cyan touch ring around the hot spot.
  fingerWrap: { position: "absolute", left: -9, top: -6, width: 18, height: 44, alignItems: "center" },
  touch: {
    position: "absolute",
    top: -8,
    left: -6,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: palette.cyan,
    backgroundColor: "rgba(34, 242, 255, 0.15)",
  },
  finger: {
    width: 18,
    height: 44,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: "rgba(245, 243, 255, 0.92)",
    borderWidth: 1.5,
    borderColor: INK,
  },
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
  pillSide: { maxWidth: "100%", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12 },
  text: { fontFamily: fonts.label, fontSize: 16, letterSpacing: 1.5, color: palette.textPrimary, textAlign: "center" },
  textSide: { fontSize: 12, lineHeight: 15, letterSpacing: 1, textAlign: "left" },
  textSideDesktop: { fontSize: 14, lineHeight: 18 },
  textSideNarrow: { fontSize: 11, letterSpacing: 0.5 },
});
