import { memo } from "react";
import { StyleSheet, View } from "react-native";

interface BubbleProps {
  x: number; // centre, screen px inside the board view
  y: number;
  radius: number;
  color: string;
  opacity?: number;
  scale?: number;
  ghost?: boolean; // outline only (aim target preview)
}

// A bomb drawn with plain Views: a filled circle plus a small highlight.
export const Bubble = memo(function Bubble({
  x,
  y,
  radius,
  color,
  opacity = 1,
  scale = 1,
  ghost = false,
}: BubbleProps) {
  const size = radius * 2;
  const shine = size * 0.3;
  return (
    <View
      style={[
        styles.bubble,
        {
          left: x - radius,
          top: y - radius,
          width: size,
          height: size,
          borderRadius: radius,
          opacity,
          transform: [{ scale }],
        },
        ghost
          ? { borderColor: color, borderWidth: Math.max(1.5, radius * 0.12), borderStyle: "dashed" }
          : { backgroundColor: color },
      ]}
    >
      {!ghost && (
        <View
          style={[
            styles.shine,
            { width: shine, height: shine, borderRadius: shine / 2, left: size * 0.2, top: size * 0.16 },
          ]}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    pointerEvents: "none",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.35)",
  },
  shine: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.55)",
  },
});
