import { Platform, StyleSheet, Text, View } from "react-native";
import { BoardLayout } from "../render/layout";
import { BoardOverlay } from "./BoardOverlay";
import { Button } from "./Button";
import { colors, fontSizes, spacing } from "./theme";

const CONTROLS =
  Platform.OS === "web"
    ? ["Mouse: aim, click to fire", "Arrows / A D: aim, Space: fire", "X or Shift: swap bomb"]
    : ["Drag to aim, release to fire", "Tap the NEXT bomb to swap"];

export function TitleScreen({ layout, best, onPlay }: { layout: BoardLayout; best: number; onPlay: () => void }) {
  return (
    <BoardOverlay layout={layout}>
      <Text style={styles.title}>BOMB{"\n"}SHOOTER</Text>
      <Text style={styles.subtitle}>Match 3 to pop. Don't let them reach the line.</Text>
      <Button label="PLAY" onPress={onPlay} />
      {best > 0 && <Text style={styles.best}>Best {best}</Text>}
      <View style={styles.controls}>
        {CONTROLS.map((line) => (
          <Text key={line} style={styles.control}>
            {line}
          </Text>
        ))}
      </View>
    </BoardOverlay>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: fontSizes.title,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 3,
    lineHeight: fontSizes.title * 1.05,
  },
  subtitle: { color: colors.textMuted, fontSize: fontSizes.sm, textAlign: "center" },
  best: { color: colors.accent, fontSize: fontSizes.md, fontWeight: "700" },
  controls: { marginTop: spacing.md, alignItems: "center", gap: spacing.xs },
  control: { color: colors.textMuted, fontSize: fontSizes.xs },
});
