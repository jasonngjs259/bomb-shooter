// Zero-dependency renderer: every bomb is an absolutely positioned View.
// It reads the engine each time `frame` changes; the board is scaled from
// logical units by layout.scale.

import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BoardRendererProps } from "../BoardRenderer";
import { BOMB_HEX, colors } from "../../ui/theme";
import { AimGuide } from "./AimGuide";
import { Bubble } from "./Bubble";
import { ScorePopups } from "./ScorePopups";

// Same bomb colours as the 3D board and the HUD NEXT dot.
const colorOf = (index: number): string => BOMB_HEX[index]?.base ?? "#888888";

function BasicBoard({ engine, layout, showAimGuide }: BoardRendererProps) {
  const s = layout.scale;
  const m = engine.getBoardMetrics();
  const r = m.radius * s;
  const phase = engine.getPhase();
  const shooter = engine.getShooter();
  const bomb = engine.getBomb();
  const next = engine.getNextBomb();
  const ceiling = engine.getCeilingRows();
  const danger = engine.getDangerLevel();

  // Launcher pointer: a bar twice the length, centred on the launcher and
  // rotated around its centre, with only the right half visible.
  const pointerLen = 1.6 * m.tileSize * s;
  const sx = shooter.x * s;
  const sy = shooter.y * s;

  return (
    <View
      style={[
        styles.board,
        { left: layout.offsetX, top: layout.offsetY, width: layout.width, height: layout.height, borderRadius: 10 * s },
      ]}
    >
      {/* Shooter strip below the grid */}
      <View style={[styles.shooterArea, { top: m.gridHeight * s }]} />

      {/* Deadline: brightens as tiles get close */}
      <View
        style={[
          styles.deadline,
          { top: m.deadlineY * s, height: Math.max(1, 2 * s), opacity: 0.2 + 0.8 * danger },
        ]}
      />

      {ceiling.map((c) => (
        <View
          key={`ceil-${c.row}`}
          style={[styles.ceiling, { top: c.top * s, height: (c.bottom - c.top) * s }]}
        />
      ))}

      {engine.getTiles().map((t) => (
        <Bubble
          key={t.id}
          x={t.x * s}
          y={(t.y + t.dropOffset) * s}
          radius={r * 0.95}
          color={colorOf(t.colorIndex)}
          opacity={t.alpha}
          scale={t.state === "popping" ? 1 + (1 - t.alpha) * 0.5 : 1}
        />
      ))}

      {showAimGuide && phase === "ready" && (
        <AimGuide path={engine.getAimPath()} scale={s} radius={r * 0.95} color={colorOf(bomb.colorIndex)} />
      )}

      {/* Launcher */}
      <View
        style={[
          styles.launcher,
          { left: sx - r - 12 * s, top: sy - r - 12 * s, width: 2 * (r + 12 * s), height: 2 * (r + 12 * s), borderRadius: r + 12 * s },
        ]}
      />
      <View
        style={[
          styles.pointerTrack,
          { left: sx - pointerLen, top: sy - 2 * s, width: pointerLen * 2, height: 4 * s, transform: [{ rotate: `${-shooter.angle}deg` }] },
        ]}
      >
        <View style={[styles.pointer, { marginLeft: pointerLen, width: pointerLen, borderRadius: 2 * s }]} />
      </View>

      {/* Next bomb preview (tap to swap) */}
      <Bubble x={next.x * s} y={next.y * s} radius={r * 0.8} color={colorOf(next.colorIndex)} />
      {/* label above the preview: below it is clipped by the board's bottom edge */}
      <Text style={[styles.label, { left: next.x * s - 40, top: (next.y - m.radius * 0.8) * s - Math.max(9, 11 * s) - 6, fontSize: Math.max(9, 11 * s) }]}>
        NEXT
      </Text>

      {bomb.visible && <Bubble x={bomb.x * s} y={bomb.y * s} radius={r * 0.95} color={colorOf(bomb.colorIndex)} />}

      <ScorePopups engine={engine} scale={s} />
    </View>
  );
}

export default memo(BasicBoard);

const styles = StyleSheet.create({
  board: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: colors.board,
    borderWidth: 1,
    borderColor: colors.boardEdge,
    pointerEvents: "none",
  },
  shooterArea: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.shooterArea },
  deadline: { position: "absolute", left: 0, right: 0, backgroundColor: colors.danger },
  ceiling: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: colors.ceiling,
    borderBottomWidth: 2,
    borderBottomColor: colors.ceilingEdge,
  },
  launcher: {
    position: "absolute",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 2,
    borderColor: colors.boardEdge,
  },
  pointerTrack: { position: "absolute", flexDirection: "row" },
  pointer: { height: "100%", backgroundColor: colors.aim, opacity: 0.85 },
  label: { position: "absolute", width: 80, textAlign: "center", color: colors.textMuted, fontWeight: "700", letterSpacing: 1 },
});
