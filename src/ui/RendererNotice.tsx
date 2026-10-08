// Small, unobtrusive notice shown while the board runs on the 2D fallback
// renderer (WebGL unavailable, context lost twice, or the 3D renderer
// crashed), with a "Retry 3D" button. Lives outside the gesture area so a
// tap on it never fires a shot.

import { Pressable, StyleSheet, Text, View } from "react-native";
import { rendererStatus, useRendererStatus } from "../render";
import { fonts, palette } from "./theme";

export function RendererNotice({ bottom }: { bottom: number }) {
  const status = useRendererStatus();
  if (status.mode !== "2d") return null;
  const message = status.retryFailed
    ? "3D still unavailable — running in 2D mode"
    : "3D graphics unavailable — running in 2D mode";
  return (
    <View style={[styles.wrap, { bottom }]}>
      <View style={styles.notice} accessibilityRole="alert">
        <Text style={styles.text} numberOfLines={1}>
          {message}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry 3D graphics"
          hitSlop={8}
          onPress={() => {
            rendererStatus.retry3D();
            // don't keep keyboard focus on the button: Space must fire again
            if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>RETRY 3D</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 8, right: 8, alignItems: "center", pointerEvents: "box-none" },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: "100%",
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(11, 4, 32, 0.88)",
    borderWidth: 1,
    borderColor: palette.panelBorder,
  },
  text: { flexShrink: 1, fontFamily: fonts.label, fontSize: 12, letterSpacing: 0.6, color: palette.textSecondary },
  retry: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.cyan,
    cursor: "pointer",
  },
  pressed: { opacity: 0.7 },
  retryText: { fontFamily: fonts.button, fontSize: 12, letterSpacing: 1.2, color: palette.cyan },
});
