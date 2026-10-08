import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { BoardLayout } from "../render/layout";
import { colors, radii, spacing } from "./theme";

// Dimmed panel covering exactly the board rect. Being on top, it also keeps
// taps from reaching the board's gesture handler.
export function BoardOverlay({ layout, children }: { layout: BoardLayout; children: ReactNode }) {
  return (
    <View
      style={[
        styles.overlay,
        { left: layout.offsetX, top: layout.offsetY, width: layout.width, height: layout.height },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: colors.overlay,
  },
});
