// Arena 360 touch controls (spec section 6, mobile): a floating left
// joystick (move, camera-relative), right-side drag to turn (0.45 deg/pt,
// x1.6 on flicks, optional soft aim assist on release), and the thumb
// cluster: FIRE (fires on touch-down), NEXT chip (swap) and TURN 180.
// Input goes straight into ArenaControls refs; the joystick visual moves
// with Animated values, so nothing re-renders per touch move.

import { memo, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { ArenaEngine } from "../game/arena";
import { haptics } from "../fx/haptics";
import { getSettings } from "../ui/settings";
import { BOMB_HEX, fonts, palette } from "../ui/theme";
import { ArenaControls } from "./ArenaControls";
import { DEG, stickCurve } from "./arenaMath";

const BASE = 120;
const KNOB = 52;
const TRAVEL = 60;
const EDGE = 20; // keep clear of system edge gestures
const BOTTOM_EDGE = 16;

interface Props {
  engine: ArenaEngine;
  controls: ArenaControls;
  width: number;
  height: number;
  insets: { top: number; bottom: number; left: number; right: number };
  portrait: boolean;
  currentColor: number;
  nextColor: number;
}

export const TouchControls = memo(function TouchControls({
  engine, controls, width, height, insets, portrait, currentColor, nextColor,
}: Props) {
  const zoneW = width * (portrait ? 0.5 : 0.4) - insets.left - EDGE;
  const zoneH = height * (portrait ? 0.4 : 0.7) - insets.bottom - BOTTOM_EDGE;
  const restX = 84;
  const restY = zoneH - 84 + BOTTOM_EDGE; // = H - insetB - 84 on screen
  const base = useRef(new Animated.ValueXY({ x: restX, y: restY })).current;
  const knob = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const baseOpacity = useRef(new Animated.Value(0.25)).current;
  const latest = useRef({ restX, restY });
  latest.current = { restX, restY };

  const gestures = useMemo(() => {
    let bx = 0;
    let by = 0;
    const stick = Gesture.Pan()
      .minDistance(0)
      .maxPointers(1)
      .runOnJS(true)
      .onBegin((e) => {
        bx = e.x;
        by = e.y;
        base.setValue({ x: bx, y: by });
        knob.setValue({ x: 0, y: 0 });
        baseOpacity.setValue(1);
      })
      .onUpdate((e) => {
        let dx = e.x - bx;
        let dy = e.y - by;
        const d = Math.hypot(dx, dy);
        if (d > TRAVEL * 1.3) {
          // base follows the thumb when dragged far past the ring
          const k = (d - TRAVEL * 1.3) / d;
          bx += dx * k;
          by += dy * k;
          dx = e.x - bx;
          dy = e.y - by;
          base.setValue({ x: bx, y: by });
        }
        const m = Math.min(1, TRAVEL / Math.max(1e-3, Math.hypot(dx, dy)));
        knob.setValue({ x: dx * m, y: dy * m });
        const out = stickCurve(dx, dy, TRAVEL);
        controls.stick.strafe = out.strafe;
        controls.stick.forward = out.forward;
      })
      .onFinalize(() => {
        controls.stick.strafe = controls.stick.forward = 0;
        base.setValue({ x: latest.current.restX, y: latest.current.restY });
        knob.setValue({ x: 0, y: 0 });
        baseOpacity.setValue(0.25);
      });
    const turn = Gesture.Pan()
      .minDistance(0)
      .maxPointers(1)
      .runOnJS(true)
      .onChange((e) => {
        const flick = Math.abs(e.velocityX) > 600 ? 1.6 : 1;
        controls.addYaw(e.changeX * 0.45 * DEG * flick);
      })
      .onEnd(() => {
        if (getSettings().aimAssist) controls.startAssist(engine);
      });
    return { stick, turn };
  }, [engine, controls, base, knob, baseOpacity]);

  const right = insets.right;
  const bottom = insets.bottom;
  const fireRing = BOMB_HEX[currentColor]?.glow ?? palette.cyan;
  return (
    <View style={styles.fill} pointerEvents="box-none">
      <GestureDetector gesture={gestures.turn}>
        <View
          collapsable={false}
          style={[styles.abs, { left: width * (portrait ? 0.5 : 0.4), right: right + EDGE, top: insets.top + 64, bottom: bottom + BOTTOM_EDGE }]}
        />
      </GestureDetector>
      <GestureDetector gesture={gestures.stick}>
        <View collapsable={false} style={[styles.abs, { left: insets.left + EDGE, bottom: bottom + BOTTOM_EDGE, width: zoneW, height: zoneH }]}>
          <Animated.View
            pointerEvents="none"
            style={[styles.base, { opacity: baseOpacity, transform: [{ translateX: base.x }, { translateY: base.y }] }]}
          >
            <Animated.View style={[styles.knob, { transform: [{ translateX: knob.x }, { translateY: knob.y }] }]} />
          </Animated.View>
        </View>
      </GestureDetector>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fire"
        hitSlop={12}
        onPressIn={() => engine.fire()}
        style={[styles.fire, { right: right + 64 - 40, bottom: bottom + 64 - 40, borderColor: fireRing }]}
      >
        <View style={styles.crossH} />
        <View style={styles.crossV} />
        <View style={styles.crossDot} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Swap with next bomb"
        hitSlop={8}
        onPress={() => engine.swapBomb()}
        style={[styles.next, { right: right + 168 - 28, bottom: bottom + 52 - 28 }]}
      >
        <View style={[styles.nextDot, { backgroundColor: BOMB_HEX[nextColor]?.base ?? palette.textMuted }]} />
        <Text style={styles.nextLabel}>NEXT</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Turn around"
        hitSlop={8}
        onPress={() => {
          const yaw = engine.getShooter().yaw;
          controls.snapTo(yaw, yaw + Math.PI, 0.25);
          haptics.selection();
        }}
        style={[styles.turn, { right: right + 64 - 24, bottom: bottom + 172 - 24 }]}
      >
        <Text style={styles.turnText}>↻</Text>
        <Text style={styles.turnLabel}>180</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill },
  abs: { position: "absolute" },
  base: {
    position: "absolute",
    left: -BASE / 2,
    top: -BASE / 2,
    width: BASE,
    height: BASE,
    borderRadius: BASE / 2,
    borderWidth: 2,
    borderColor: palette.cyan,
    backgroundColor: "rgba(22, 10, 51, 0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: palette.magenta,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  fire: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    backgroundColor: palette.cyan,
    alignItems: "center",
    justifyContent: "center",
  },
  crossH: { position: "absolute", width: 34, height: 3, backgroundColor: palette.ink },
  crossV: { position: "absolute", width: 3, height: 34, backgroundColor: palette.ink },
  crossDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: palette.ink },
  next: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  nextDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.4)" },
  nextLabel: { fontFamily: fonts.label, fontSize: 11, letterSpacing: 1, color: palette.textSecondary },
  turn: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.cyan,
    alignItems: "center",
    justifyContent: "center",
  },
  turnText: { fontSize: 20, lineHeight: 22, color: palette.textPrimary },
  turnLabel: { fontFamily: fonts.label, fontSize: 9, letterSpacing: 1, color: palette.textSecondary, marginTop: -3 },
});
