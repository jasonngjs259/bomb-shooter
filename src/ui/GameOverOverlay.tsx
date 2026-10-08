import { Platform, StyleSheet, Text } from "react-native";
import { BoardLayout } from "../render/layout";
import { BoardOverlay } from "./BoardOverlay";
import { Button } from "./Button";
import { colors, fontSizes } from "./theme";

interface Props {
  layout: BoardLayout;
  won: boolean;
  score: number;
  best: number;
  isNewBest: boolean;
  onRetry: () => void;
}

// End-of-game panel for both outcomes: lost (tile hit the line) or won (board cleared).
export function GameOverOverlay({ layout, won, score, best, isNewBest, onRetry }: Props) {
  return (
    <BoardOverlay layout={layout}>
      <Text style={[styles.heading, { color: won ? colors.success : colors.danger }]}>
        {won ? "Board cleared!" : "Game over"}
      </Text>
      <Text style={styles.score}>{score}</Text>
      {isNewBest ? <Text style={styles.newBest}>New best!</Text> : <Text style={styles.best}>Best {best}</Text>}
      <Button label={won ? "PLAY AGAIN" : "RETRY"} onPress={onRetry} />
      {Platform.OS === "web" && <Text style={styles.hint}>or press Space</Text>}
    </BoardOverlay>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: fontSizes.xl, fontWeight: "900", textAlign: "center" },
  score: { color: colors.text, fontSize: 56, fontWeight: "900", fontVariant: ["tabular-nums"] },
  best: { color: colors.textMuted, fontSize: fontSizes.md },
  newBest: { color: colors.accent, fontSize: fontSizes.md, fontWeight: "800" },
  hint: { color: colors.textMuted, fontSize: fontSizes.xs },
});
