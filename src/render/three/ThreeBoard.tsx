// The 3D renderer component: a full-container GL canvas (background + board
// + FX) with RN text overlays on top. It ignores `frame`: the world reads the
// engine every GL frame, so React never re-renders during play.

import { memo, useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BoardRendererProps } from "../BoardRenderer";
import { fonts, palette } from "../../ui/theme";
import { FxTextOverlay } from "./FxTextOverlay";
import { GameCanvas } from "./GameCanvas";
import { SceneRoot } from "./SceneRoot";
import { GameWorld } from "./world/GameWorld";

function ThreeBoard({ engine, layout, showAimGuide, scene = "game" }: BoardRendererProps) {
  const worldRef = useRef<GameWorld | null>(null);
  if (worldRef.current === null) worldRef.current = new GameWorld(engine);
  const world = worldRef.current;

  useEffect(() => {
    world.setLayout(layout);
    world.showAimGuide = showAimGuide;
    world.setTitleMode(scene === "title");
  }, [world, layout, showAimGuide, scene]);

  useEffect(() => () => world.dispose(), [world]);

  const next = engine.getNextBomb();
  const m = engine.getBoardMetrics();
  const s = layout.scale;
  return (
    <View style={styles.fill}>
      <GameCanvas>
        <SceneRoot world={world} />
      </GameCanvas>
      {scene === "game" && (
        <Text
          style={[
            styles.next,
            { left: next.x * s + layout.offsetX - 40, top: (next.y + m.radius + 8) * s + layout.offsetY },
          ]}
        >
          NEXT
        </Text>
      )}
      <FxTextOverlay engine={engine} layout={layout} />
    </View>
  );
}

export default memo(
  ThreeBoard,
  (a, b) => a.engine === b.engine && a.layout === b.layout && a.showAimGuide === b.showAimGuide && a.scene === b.scene
);

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, pointerEvents: "none" },
  next: {
    position: "absolute",
    width: 80,
    textAlign: "center",
    fontFamily: fonts.label,
    fontSize: 11,
    letterSpacing: 2,
    color: palette.textSecondary,
  },
});
