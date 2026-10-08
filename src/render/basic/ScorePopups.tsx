// "+score" labels that float up from popped clusters. Driven by the engine's
// `pop` event and RN Animated, so they keep animating even when the engine is
// idle (no new frames).

import { useEffect, useRef, useState } from "react";
import { Animated, Platform, StyleSheet } from "react-native";
import { GameEngineView } from "../../game/types";
import { colors } from "../../ui/theme";

interface Popup {
  id: number;
  x: number; // logical units
  y: number;
  text: string;
}

const useNativeDriver = Platform.OS !== "web";

function PopupLabel({ popup, scale, onDone }: { popup: Popup; scale: number; onDone: (id: number) => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, { toValue: 1, duration: 900, useNativeDriver });
    anim.start(() => onDone(popup.id));
    return () => anim.stop();
  }, [progress, popup.id, onDone]);

  const fontSize = Math.max(14, 22 * scale);
  return (
    <Animated.Text
      style={[
        styles.popup,
        {
          left: popup.x * scale - 60,
          top: popup.y * scale - fontSize,
          fontSize,
          opacity: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -50 * scale] }) }],
        },
      ]}
    >
      {popup.text}
    </Animated.Text>
  );
}

export function ScorePopups({ engine, scale }: { engine: GameEngineView; scale: number }) {
  const [popups, setPopups] = useState<Popup[]>([]);
  const nextId = useRef(1);

  useEffect(
    () =>
      engine.on("pop", ({ centre, score, combo }) => {
        const text = combo > 1 ? `+${score}  x${Math.min(combo, 5)}` : `+${score}`;
        setPopups((list) => [...list, { id: nextId.current++, x: centre.x, y: centre.y, text }]);
      }),
    [engine]
  );

  const remove = useRef((id: number) => setPopups((list) => list.filter((p) => p.id !== id))).current;

  return (
    <>
      {popups.map((p) => (
        <PopupLabel key={p.id} popup={p} scale={scale} onDone={remove} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  popup: {
    position: "absolute",
    width: 120,
    textAlign: "center",
    fontWeight: "800",
    color: colors.accent,
    pointerEvents: "none",
  },
});
