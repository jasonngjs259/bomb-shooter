// Full-screen colour flash requested by the renderer (combo x4+, title
// detonation wipe). Sits above the game, below the cards; never takes input.

import { useEffect, useRef, useState } from "react";
import { Animated, Platform, StyleSheet } from "react-native";
import { getFxBus } from "../fx/bus";
import { GameEngineView } from "../game/types";

export function ScreenFlash({ engine }: { engine: GameEngineView }) {
  const v = useRef(new Animated.Value(0)).current;
  const [tint, setTint] = useState("#FFFFFF");
  useEffect(
    () =>
      getFxBus(engine).on("screenFlash", ({ color, alpha, duration }) => {
        setTint(color);
        v.setValue(alpha);
        Animated.timing(v, { toValue: 0, duration, useNativeDriver: Platform.OS !== "web" }).start();
      }),
    [engine, v]
  );
  return <Animated.View style={[StyleSheet.absoluteFill, styles.flash, { backgroundColor: tint, opacity: v }]} />;
}

const styles = StyleSheet.create({ flash: { pointerEvents: "none" } });
