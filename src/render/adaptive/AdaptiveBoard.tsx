// Picks the board renderer from the renderer status: the 3D three.js board
// when WebGL works, otherwise the plain-View 2D board so the game stays
// playable. Both use the same layout and the same orthographic
// screenToBoard, so aiming is identical in either mode. While a lost
// context is being restored the (hidden) 3D canvas stays mounted and the 2D
// board stands in, so play never stops.

import { StyleSheet, View } from "react-native";
import { BoardRendererProps } from "../BoardRenderer";
import BasicBoard from "../basic/BasicBoard";
import { Bubble } from "../basic/Bubble";
import { useRendererStatus } from "../status";
import ThreeBoard from "../three/ThreeBoard";
import { titleLayout } from "../../ui/titleLayout";
import { BOMB_HEX } from "../../ui/theme";

// 2D stand-in for the 3D title scene: just the bomb that is the logo's "O".
function FallbackTitle({ width, height }: { width: number; height: number }) {
  const tl = titleLayout(width, height);
  return (
    <View style={styles.fill}>
      <Bubble x={tl.slotX} y={tl.logoY} radius={tl.slotSize / 2} color={BOMB_HEX[0].base} />
    </View>
  );
}

export default function AdaptiveBoard(props: BoardRendererProps) {
  const status = useRendererStatus();
  if (status.mode === "3d") {
    // fixed slots: ThreeBoard must not remount when the stand-in appears
    return (
      <>
        {status.restoring && props.scene !== "title" ? <BasicBoard {...props} /> : null}
        <ThreeBoard {...props} />
      </>
    );
  }
  if (props.scene === "title") {
    return <FallbackTitle width={props.layout.containerWidth} height={props.layout.containerHeight} />;
  }
  return <BasicBoard {...props} />;
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, pointerEvents: "none" },
});
