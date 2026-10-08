// The single game screen: HUD on top, board filling the rest, and the title /
// end overlays drawn over the board. All screens are driven by engine phase.

import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { attachHaptics } from "../fx/haptics";
import { useGameEngine } from "../game/useGameEngine";
import { useAimInput } from "../input/useAimInput";
import { activeRenderer, screenToBoard } from "../render";
import { fitBoard } from "../render/layout";
import { GameOverOverlay } from "./GameOverOverlay";
import { Hud } from "./Hud";
import { TitleScreen } from "./TitleScreen";
import { colors, spacing } from "./theme";
import { useBestScore } from "./useBestScore";

const HUD_ESTIMATE = 64; // used only until the board area reports its size

export function GameScreen() {
  const { engine, frame } = useGameEngine();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { best, isNewBest } = useBestScore(engine);
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => attachHaptics(engine), [engine]);

  // Fit the logical board into the measured area (window-based guess first)
  const metrics = engine.getBoardMetrics();
  const areaWidth = area?.width ?? window.width - insets.left - insets.right;
  const areaHeight = area?.height ?? window.height - insets.top - insets.bottom - HUD_ESTIMATE;
  const layout = useMemo(
    () => fitBoard(areaWidth, areaHeight, metrics.width, metrics.height),
    [areaWidth, areaHeight, metrics.width, metrics.height]
  );

  const onAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  const startGame = useCallback(() => engine.newGame(), [engine]);
  const { gesture, showAimGuide } = useAimInput({ engine, layout, screenToBoard, onStart: startGame });

  const phase = engine.getPhase();
  const Renderer = activeRenderer.Component;

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      <View style={[styles.hud, { width: Math.max(layout.width, Math.min(360, window.width - 16)) }]}>
        <Hud
          score={engine.getScore()}
          best={best}
          combo={engine.getCombo()}
          nextColorIndex={engine.getNextBomb().colorIndex}
          shotsUntilCeiling={engine.getShotsUntilCeiling()}
          onSwap={() => engine.swapBomb()}
        />
      </View>

      <View style={styles.boardArea} onLayout={onAreaLayout}>
        <GestureDetector gesture={gesture}>
          {/* collapsable={false}: Android must keep this view for the gesture handler */}
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            <Renderer engine={engine} frame={frame} layout={layout} showAimGuide={showAimGuide} />
          </View>
        </GestureDetector>

        {phase === "title" && <TitleScreen layout={layout} best={best} onPlay={startGame} />}
        {(phase === "gameOver" || phase === "won") && (
          <GameOverOverlay
            layout={layout}
            won={phase === "won"}
            score={engine.getScore()}
            best={best}
            isNewBest={isNewBest}
            onRetry={startGame}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  hud: { alignSelf: "center", maxWidth: "100%", paddingHorizontal: spacing.xs },
  boardArea: { flex: 1 },
});
