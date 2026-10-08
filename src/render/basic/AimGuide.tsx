import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { AimPath, Vec2 } from "../../game/types";
import { Bubble } from "./Bubble";

interface AimGuideProps {
  path: AimPath;
  scale: number;
  radius: number; // tile radius in screen px
  color: string;
}

const DOT_SPACING = 22; // logical units between dots
const SKIP_START = 34; // don't draw dots over the launcher

// Sample evenly spaced points along the polyline.
const sampleDots = (points: Vec2[]): Vec2[] => {
  const dots: Vec2[] = [];
  let carry = SKIP_START;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let d = carry;
    while (d <= len) {
      const t = d / len;
      dots.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += DOT_SPACING;
    }
    carry = d - len;
  }
  return dots;
};

export const AimGuide = memo(function AimGuide({ path, scale, radius, color }: AimGuideProps) {
  const dots = sampleDots(path.points);
  const dotR = Math.max(2, 3 * scale);
  return (
    <>
      {dots.map((p, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            {
              left: p.x * scale - dotR,
              top: p.y * scale - dotR,
              width: dotR * 2,
              height: dotR * 2,
              borderRadius: dotR,
              opacity: Math.max(0.25, 0.9 - i * 0.03),
            },
          ]}
        />
      ))}
      {path.target && (
        <Bubble x={path.target.x * scale} y={path.target.y * scale} radius={radius} color={color} ghost />
      )}
    </>
  );
});

const styles = StyleSheet.create({
  dot: { position: "absolute", backgroundColor: "#ffffff", pointerEvents: "none" },
});
