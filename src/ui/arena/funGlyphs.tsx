// Small View-built glyphs for the Arena fun-pass HUD, end card and HANGAR
// (no icon font, no SVG): lock, star, flame, snowflake, power icons, the
// roll "tumble" glyph and a segmented cooldown ring. All are static views:
// callers re-render them only when their (rounded) inputs change.

import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PowerKind } from "../../game/arena";
import { BOMB_HEX, fonts, palette } from "../theme";

export const POWER_COLOR: Record<PowerKind, string> = { rainbow: "#FF3DCB", mega: "#FFD23F", lightning: "#FFF36B" };
export const POWER_LABEL: Record<PowerKind, string> = { rainbow: "RAINBOW", mega: "MEGA", lightning: "LIGHTNING" };
export const FREEZE_COLOR = "#CFF4FF";
// colour-assist glyphs per bomb colour (design spec 1.2)
export const BOMB_GLYPH = ["▲", "●", "■", "✚", "◆", "★"] as const;

export function LockGlyph({ size = 16, color = palette.textPrimary }: { size?: number; color?: string }) {
  const w = size * 0.75;
  return (
    <View style={{ width: size, height: size, alignItems: "center" }}>
      <View
        style={{
          width: w * 0.66, height: size * 0.5, borderTopLeftRadius: w, borderTopRightRadius: w, borderWidth: Math.max(1.5, size * 0.12),
          borderBottomWidth: 0, borderColor: color,
        }}
      />
      <View style={{ width: w, height: size * 0.5, borderRadius: size * 0.1, backgroundColor: color, marginTop: -1 }} />
    </View>
  );
}

// Filled / outline star (text glyph; Orbitron has none, the system font does).
export function StarGlyph({ size = 16, on, color = palette.gold, off = palette.textMuted }: { size?: number; on: boolean; color?: string; off?: string }) {
  return <Text style={{ fontSize: size, lineHeight: size * 1.15, color: on ? color : off }}>{on ? "★" : "☆"}</Text>;
}

export function FlameGlyph({ size = 16 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }}>
      <View
        style={{
          position: "absolute", bottom: size * 0.05, width: size * 0.62, height: size * 0.62, backgroundColor: "#FF3DCB",
          borderTopLeftRadius: size * 0.31, borderBottomLeftRadius: size * 0.31, borderBottomRightRadius: size * 0.31, transform: [{ rotate: "-45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute", bottom: size * 0.1, width: size * 0.32, height: size * 0.32, backgroundColor: "#FFD23F",
          borderTopLeftRadius: size * 0.16, borderBottomLeftRadius: size * 0.16, borderBottomRightRadius: size * 0.16, transform: [{ rotate: "-45deg" }],
        }}
      />
    </View>
  );
}

export function SnowGlyph({ size = 16, color = FREEZE_COLOR }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {[0, 60, 120].map((r) => (
        <View key={r} style={{ position: "absolute", width: 2, height: size, borderRadius: 1, backgroundColor: color, transform: [{ rotate: `${r}deg` }] }} />
      ))}
    </View>
  );
}

export function BoltGlyph({ size = 16, color = POWER_COLOR.lightning }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: "absolute", left: size * 0.38, top: 0, width: size * 0.22, height: size * 0.58, backgroundColor: color, transform: [{ skewX: "-20deg" }, { rotate: "18deg" }] }} />
      <View style={{ position: "absolute", left: size * 0.32, top: size * 0.42, width: size * 0.22, height: size * 0.58, backgroundColor: color, transform: [{ skewX: "-20deg" }, { rotate: "18deg" }] }} />
      <View style={{ position: "absolute", left: size * 0.22, top: size * 0.4, width: size * 0.56, height: size * 0.16, backgroundColor: color }} />
    </View>
  );
}

function RainbowGlyph({ size }: { size: number }) {
  const cols = [BOMB_HEX[0].base, BOMB_HEX[1].base, BOMB_HEX[3].base, BOMB_HEX[2].base];
  return (
    <View style={{ width: size, height: size * 0.6, alignItems: "center", justifyContent: "flex-end", overflow: "hidden" }}>
      {cols.map((c, i) => {
        const d = size - i * size * 0.2;
        return (
          <View
            key={c}
            style={{ position: "absolute", top: i * size * 0.1, width: d, height: d, borderRadius: d / 2, borderWidth: size * 0.1, borderColor: c }}
          />
        );
      })}
    </View>
  );
}

function MegaGlyph({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }}>
      <View style={{ position: "absolute", top: 0, right: size * 0.18, width: size * 0.12, height: size * 0.32, backgroundColor: color, transform: [{ rotate: "35deg" }] }} />
      <View style={{ width: size * 0.78, height: size * 0.78, borderRadius: size * 0.39, backgroundColor: color }} />
    </View>
  );
}

export function PowerIcon({ kind, size = 24, color }: { kind: PowerKind; size?: number; color?: string }) {
  if (kind === "rainbow") return <RainbowGlyph size={size} />;
  if (kind === "mega") return <MegaGlyph size={size} color={color ?? POWER_COLOR.mega} />;
  return <BoltGlyph size={size} color={color ?? POWER_COLOR.lightning} />;
}

// Roll "tumble" glyph: a circle with a motion arc.
export function TumbleGlyph({ size = 26, color = palette.textPrimary }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute", width: size, height: size, borderRadius: size / 2, borderWidth: 2.5, borderColor: color,
          borderLeftColor: "transparent", borderBottomColor: "transparent", transform: [{ rotate: "-20deg" }],
        }}
      />
      <View style={{ width: size * 0.42, height: size * 0.42, borderRadius: size * 0.21, backgroundColor: color }} />
      <View style={{ position: "absolute", left: 0, bottom: size * 0.2, width: size * 0.3, height: 2.5, borderRadius: 1, backgroundColor: color, opacity: 0.6 }} />
    </View>
  );
}

// Segmented ring: `fill` 0..1 of the segments lit, clockwise from 12 o'clock.
export const SegmentRing = memo(function SegmentRing({
  size, fill, color, track = "rgba(255,255,255,0.18)", segments = 24, thickness = 3,
}: { size: number; fill: number; color: string; track?: string; segments?: number; thickness?: number }) {
  const lit = Math.round(Math.max(0, Math.min(1, fill)) * segments);
  const len = Math.max(2, ((Math.PI * size) / segments) * 0.62);
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", pointerEvents: "none" }]}>
      {Array.from({ length: segments }, (_, i) => (
        <View
          key={i}
          style={{
            position: "absolute", width: thickness, height: len, borderRadius: thickness / 2,
            backgroundColor: i < lit ? color : track,
            transform: [{ rotate: `${(i + 0.5) * (360 / segments)}deg` }, { translateY: -(size / 2 - len / 2) }],
          }}
        />
      ))}
    </View>
  );
});

export function Keycap({ label }: { label: string }) {
  return (
    <View style={styles.keycap}>
      <Text style={styles.keycapText}>{label}</Text>
    </View>
  );
}

export const fmtClock = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

const styles = StyleSheet.create({
  keycap: {
    minWidth: 30, height: 20, paddingHorizontal: 5, borderRadius: 4, borderWidth: 1, borderColor: palette.textMuted,
    borderBottomWidth: 2.5, alignItems: "center", justifyContent: "center",
  },
  keycapText: { fontFamily: fonts.button, fontSize: 11, letterSpacing: 1, color: palette.textPrimary },
});
