// In-world text as RN views over the GL canvas (no troika/drei text on
// native): "+score" floats, "+20" drop bonuses and the "xN COMBO!" label.
// Spawned from the FX bus; animated with the native driver.

import { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet } from "react-native";
import { FxBusEvents, getFxBus } from "../../fx/bus";
import { GameEngineView } from "../../game/types";
import { BoardLayout } from "../layout";
import { fonts, palette } from "../../ui/theme";

type FloatText = FxBusEvents["floatText"] & { id: number };

const native = Platform.OS !== "web";
const MAX_ITEMS = 12;

function comboColor(combo: number) {
  if (combo >= 4) return palette.gold;
  if (combo === 3) return palette.magenta;
  return palette.cyan;
}

function FloatLabel({ item, layout, onDone }: { item: FloatText; layout: BoardLayout; onDone: (id: number) => void }) {
  const p = useRef(new Animated.Value(0)).current;
  const s = layout.scale;
  const isCombo = item.kind === "combo";
  const duration = isCombo ? 1060 : 700;
  useEffect(() => {
    const anim = Animated.timing(p, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: native });
    anim.start(() => onDone(item.id));
    return () => anim.stop();
  }, [p, duration, item.id, onDone]);

  const desktop = layout.containerWidth >= 900;
  const big = (item.combo ?? 0) >= 4;
  const fontSize = isCombo ? (big ? (desktop ? 54 : 42) : desktop ? 44 : 34) : item.kind === "drop" ? (desktop ? 18 : 16) : desktop ? 24 : 20;
  const width = isCombo ? 360 : 120;
  const left = item.x * s + layout.offsetX - width / 2;
  const top = item.y * s + layout.offsetY - fontSize * 0.7;
  const tint = isCombo ? comboColor(item.combo ?? 2) : palette.gold;

  // score: rise 48u easeOutCubic, hold 400 then fade 300
  // combo: scale 0 -> 1.3 -> 1 in 260, hold 500, rise 24u + fade 300
  const rise = isCombo
    ? p.interpolate({ inputRange: [0, 0.717, 1], outputRange: [0, 0, -24 * s] })
    : p.interpolate({ inputRange: [0, 0.25, 0.5, 1], outputRange: [0, -28 * s, -40 * s, -48 * s] });
  const opacity = isCombo
    ? p.interpolate({ inputRange: [0, 0.05, 0.717, 1], outputRange: [0, 1, 1, 0] })
    : p.interpolate({ inputRange: [0, 0.571, 1], outputRange: [1, 1, 0] });
  const scale = isCombo
    ? p.interpolate({ inputRange: [0, 0.16, 0.245, 1], outputRange: [0, 1.3, 1, 1] })
    : p.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0.6, 1.08, 1] });

  return (
    <Animated.Text
      style={[
        isCombo ? styles.combo : styles.score,
        {
          left, top, width, fontSize, color: tint, textShadowColor: tint,
          opacity, transform: [{ translateY: rise }, { scale }],
        },
      ]}
    >
      {item.text}
    </Animated.Text>
  );
}

export const FxTextOverlay = memo(function FxTextOverlay({ engine, layout }: { engine: GameEngineView; layout: BoardLayout }) {
  const [items, setItems] = useState<FloatText[]>([]);
  const nextId = useRef(1);
  useEffect(
    () =>
      getFxBus(engine).on("floatText", (e) => {
        const item = { ...e, id: nextId.current++ };
        setItems((list) => [...list.slice(-(MAX_ITEMS - 1)), item]);
      }),
    [engine]
  );
  const remove = useRef((id: number) => setItems((list) => list.filter((i) => i.id !== id))).current;
  return (
    <>
      {items.map((item) => (
        <FloatLabel key={item.id} item={item} layout={layout} onDone={remove} />
      ))}
    </>
  );
});

const styles = StyleSheet.create({
  score: {
    position: "absolute",
    textAlign: "center",
    fontFamily: fonts.button,
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 },
    pointerEvents: "none",
  },
  combo: {
    position: "absolute",
    textAlign: "center",
    fontFamily: fonts.display,
    letterSpacing: 1,
    textShadowRadius: 16,
    textShadowOffset: { width: 0, height: 0 },
    pointerEvents: "none",
  },
});
