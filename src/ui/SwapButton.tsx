// Touch target over the NEXT socket drawn by the renderer: a real Pressable
// (>= 56pt) so tapping the next bomb always swaps, plus a small swap badge
// as a visible affordance. Positioned from the engine's next-slot position.

import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { GameEngineView } from "../game/types";
import { BoardLayout } from "../render/layout";
import { palette } from "./theme";

export function SwapButton({ engine, layout, onSwap }: { engine: GameEngineView; layout: BoardLayout; onSwap: () => void }) {
  const n = engine.getNextBomb();
  const size = Math.max(56, 2 * engine.config.radius * 1.5 * layout.scale);
  const cx = layout.offsetX + n.x * layout.scale;
  const cy = layout.offsetY + n.y * layout.scale;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Swap bomb"
      accessibilityHint="Swaps the current bomb with the next one"
      onPress={onSwap}
      style={({ pressed }) => [
        styles.target,
        { left: cx - size / 2, top: cy - size / 2, width: size, height: size, borderRadius: size / 2 },
        pressed && styles.pressed,
        Platform.OS === "web" && styles.pointer,
      ]}
    >
      <View style={[styles.badge, { left: size / 2 + size * 0.22, top: size * 0.02 }]}>
        <Text style={styles.badgeText}>⇄</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: { position: "absolute" },
  pressed: { backgroundColor: "rgba(34, 242, 255, 0.18)" },
  pointer: { cursor: "pointer" },
  badge: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.panelSolid,
    borderWidth: 1.5,
    borderColor: palette.cyan,
  },
  badgeText: { color: palette.cyan, fontSize: 12, lineHeight: 14, fontWeight: "700" },
});
