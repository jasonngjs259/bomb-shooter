// Neon buttons. primary = cyan->magenta gradient with dark ink label (6.4:1),
// secondary = panel fill with a cyan stroke. Pressed: scale 0.96 + dim;
// hover (web): white wash / brighter stroke; keyboard focus: 2pt cyan ring.
// Blurred glows are native-only (see webSafe.ts).

import { LinearGradient } from "expo-linear-gradient";
import { ReactNode, useState } from "react";
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { fonts, gradients, palette } from "./theme";
import { boxGlow, IS_WEB } from "./webSafe";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  size?: "hero" | "lg" | "md";
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  children?: ReactNode;
}

const SIZES = {
  hero: { width: 280, height: 64, font: 28 },
  lg: { width: 260, height: 56, font: 22 },
  md: { width: 260, height: 48, font: 20 },
} as const;

export function Button({ label, onPress, variant = "primary", size = "lg", style, accessibilityHint }: ButtonProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const dims = SIZES[size];
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={({ pressed }) => [
        styles.base,
        { width: dims.width, maxWidth: "100%", height: dims.height, borderRadius: dims.height / 2 },
        primary ? styles.primaryGlow : styles.secondary,
        hover && (primary ? styles.primaryHover : styles.secondaryHover),
        focus && styles.focus,
        pressed && styles.pressed,
        style,
      ]}
    >
      {primary && (
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: dims.height / 2 }]}
        />
      )}
      {hover && <View style={[StyleSheet.absoluteFill, styles.hoverWash, { borderRadius: dims.height / 2 }]} />}
      <Text style={[styles.label, { fontSize: dims.font, color: primary ? palette.ink : palette.textPrimary }]}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

// Round 44pt icon button (pause, settings).
export function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center", overflow: "visible", cursor: "pointer" },
  primaryGlow: boxGlow(palette.magenta, 6, 0.6, 8),
  primaryHover: boxGlow(palette.magenta, 12, 0.9, 8),
  secondary: { backgroundColor: palette.panelSolid, borderWidth: 2, borderColor: palette.cyan },
  secondaryHover: IS_WEB ? { borderColor: palette.textPrimary } : boxGlow(palette.cyan, 12, 0.6),
  hoverWash: { backgroundColor: "rgba(255,255,255,0.12)" },
  focus: { outlineColor: palette.cyan, outlineWidth: 2, outlineStyle: "solid", outlineOffset: 3 },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  label: { fontFamily: fonts.button, letterSpacing: 1.5 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.panel,
    borderWidth: 1.5,
    borderColor: palette.panelBorder,
    cursor: "pointer",
  },
});
