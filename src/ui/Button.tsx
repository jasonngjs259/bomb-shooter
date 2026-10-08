import { Pressable, StyleSheet, Text } from "react-native";
import { colors, fontSizes, radii, spacing } from "./theme";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost";
}

export function Button({ label, onPress, variant = "primary" }: ButtonProps) {
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.base, primary ? styles.primary : styles.ghost, pressed && styles.pressed]}
    >
      <Text style={[styles.label, { color: primary ? colors.accentText : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: 160,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    alignItems: "center",
  },
  primary: { backgroundColor: colors.accent },
  ghost: { borderWidth: 1, borderColor: colors.boardEdge },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  label: { fontSize: fontSizes.md, fontWeight: "800", letterSpacing: 1 },
});
