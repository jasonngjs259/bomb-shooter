// Neon buttons (spec section 1.1 + 8): primary = cyan->magenta gradient pill
// with dark label, secondary = dark fill with cyan stroke. Pressed: scale
// 0.96 + dim. Web hover brightens and grows the glow. Targets >= 44pt.

import { LinearGradient } from "expo-linear-gradient";
import { ReactNode, useState } from "react";
import { Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { fonts, palette } from "./theme";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  size?: "lg" | "md";
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function Button({ label, onPress, variant = "primary", size = "md", style, accessibilityHint }: ButtonProps) {
  const [hover, setHover] = useState(false);
  const primary = variant === "primary";
  const height = size === "lg" ? 64 : primary ? 56 : 48;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={({ pressed }) => [
        styles.base,
        { height, borderRadius: height / 2 },
        primary ? styles.primaryShadow : styles.secondary,
        hover && (primary ? styles.primaryHover : styles.secondaryHover),
        pressed && styles.pressed,
        Platform.OS === "web" && styles.webCursor,
        style,
      ]}
    >
      {primary && (
        <LinearGradient
          colors={[palette.cyan, palette.magenta]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: height / 2 }]}
        />
      )}
      <Text
        style={[
          styles.label,
          { fontSize: size === "lg" ? 28 : 22, color: primary ? palette.ink : palette.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface IconButtonProps {
  label: string; // accessibility label
  onPress: () => void;
  children: ReactNode;
}

// 44pt round icon button with hitSlop 10
export function IconButton({ label, onPress, children }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed, Platform.OS === "web" && styles.webCursor]}
    >
      <View style={styles.iconInner}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: 200,
    paddingHorizontal: 28,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  primaryShadow: { boxShadow: "0px 0px 14px rgba(255, 61, 203, 0.6)" },
  primaryHover: { boxShadow: "0px 0px 26px rgba(255, 61, 203, 0.95)", transform: [{ scale: 1.03 }] },
  secondary: {
    backgroundColor: palette.panelSolid,
    borderWidth: 2,
    borderColor: palette.cyan,
  },
  secondaryHover: { backgroundColor: "#22164A", boxShadow: "0px 0px 12px rgba(34, 242, 255, 0.6)" },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  webCursor: { cursor: "pointer" },
  iconInner: { pointerEvents: "none" },
  label: { fontFamily: fonts.button, letterSpacing: 1.5, textTransform: "uppercase" },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(22, 10, 51, 0.6)",
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
  },
});
