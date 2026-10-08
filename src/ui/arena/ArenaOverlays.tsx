// Small Arena 360 overlays: off-screen threat arrows (tap to snap-turn),
// the centred banner (READY / GO! / SURGE! / ARENA CLEAR!), the desktop
// "CLICK TO PLAY" pointer-lock prompt, the mobile-web "ROTATE FOR BEST
// VIEW" toast and the lost-WebGL card (Arena has no 2D fallback).

import { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { getFxBus } from "../../fx/bus";
import { haptics } from "../../fx/haptics";
import type { ArenaControls } from "../../arena/ArenaControls";
import type { ArenaEngine } from "../../game/arena";
import type { ArenaWorld, Threat } from "../../render/arena/ArenaWorld";
import { Button } from "../Button";
import { fonts, palette } from "../theme";
import { ownLayer } from "../webSafe";

const native = Platform.OS !== "web";

export const ThreatArrows = memo(function ThreatArrows({ world, engine, controls }: { world: ArenaWorld; engine: ArenaEngine; controls: ArenaControls }) {
  const [list, setList] = useState<Threat[]>([]);
  const t0 = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const n = world.threatCount;
      setList((prev) => {
        if (n === 0 && prev.length === 0) return prev;
        return world.threats.slice(0, n).map((t) => ({ ...t }));
      });
    }, 100);
    return () => clearInterval(id);
  }, [world]);
  const now = (Date.now() - t0.current) / 1000;
  return (
    <>
      {list.map((t, i) => {
        const scale = (1 + 0.3 * t.d) * (t.d > 0.8 ? 1 + 0.08 * Math.sin(now * Math.PI * 8) : 1);
        return (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel="Turn towards threat"
            onPress={() => {
              controls.snapTo(engine.getShooter().yaw, t.angle, 0.28);
              haptics.selection();
            }}
            style={[styles.arrowHit, { left: t.x - 28, top: t.y - 28 }]}
          >
            {/* slim arrow 18 x 32 (head + shaft, bright tip) so the pointing
                end is unambiguous at any rotation; rotates about its centre */}
            <View style={[styles.arrow, { transform: [{ rotate: `${t.rot}deg` }, { scale }] }]}>
              <View style={styles.shaftOutline} />
              <View style={styles.headOutline} />
              <View style={styles.shaft} />
              <View style={styles.head} />
              <View style={styles.tip} />
            </View>
            {/* behind-you marker (unrotated) */}
            {t.behind && <Text style={styles.behind}>!</Text>}
          </Pressable>
        );
      })}
    </>
  );
});

// Centred banner text from the FX bus ("banner") or an explicit `text`.
export const Banner = memo(function Banner({ owner }: { owner: object }) {
  const [b, setB] = useState<{ text: string; color: string; id: number } | null>(null);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(
    () =>
      getFxBus(owner).on("banner", ({ text, color, duration }) => {
        const id = Date.now();
        setB({ text, color, id });
        v.setValue(0);
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(1.6)), useNativeDriver: native }),
          Animated.delay(Math.max(0, duration - 560)),
          Animated.timing(v, { toValue: 2, duration: 300, useNativeDriver: native }),
        ]).start(({ finished }) => finished && setB((cur) => (cur?.id === id ? null : cur)));
      }),
    [owner, v]
  );
  if (!b) return null;
  const scale = v.interpolate({ inputRange: [0, 0.7, 1, 2], outputRange: [0, 1.25, 1, 1] });
  const opacity = v.interpolate({ inputRange: [0, 0.2, 1, 2], outputRange: [0, 1, 1, 0] });
  return (
    <View style={styles.bannerWrap}>
      <Animated.Text style={[styles.banner, { color: b.color, opacity, transform: [...ownLayer, { scale }] }]}>{b.text}</Animated.Text>
    </View>
  );
});

export function ClickToPlay({ onPress, fallbackHint }: { onPress: () => void; fallbackHint: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Click to play" onPress={onPress} style={styles.click}>
      <View style={styles.clickCard}>
        <Text style={styles.clickTitle}>CLICK TO PLAY</Text>
        <Text style={styles.clickSub}>
          {fallbackHint ? "MOUSE NEAR THE EDGE TURNS · CLICK FIRES" : "MOUSE TURNS · WASD MOVES · ESC PAUSES"}
        </Text>
      </View>
    </Pressable>
  );
}

export function RotateToast() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setShow(false), 2500);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <View style={styles.toastWrap}>
      <Text style={styles.toast}>ROTATE FOR BEST VIEW</Text>
    </View>
  );
}

export function LostCard({ onRetry, onClassic }: { onRetry: () => void; onClassic: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>3D PAUSED</Text>
        <Text style={styles.cardBody}>3D graphics unavailable. Arena 360 needs 3D; your game is paused.</Text>
        <Button label="Retry 3D" size="md" onPress={onRetry} />
        <Button label="Play Classic" size="md" variant="secondary" onPress={onClassic} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  arrowHit: { position: "absolute", width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  behind: {
    position: "absolute", right: 0, top: 0, minWidth: 16, height: 16, borderRadius: 8, overflow: "hidden",
    backgroundColor: "#FF2D55", color: "#FFFFFF", fontFamily: fonts.display, fontSize: 11, lineHeight: 16, textAlign: "center",
  },
  arrow: { width: 18, height: 32 },
  headOutline: {
    position: "absolute", left: -2, top: -3, width: 0, height: 0,
    borderLeftWidth: 11, borderRightWidth: 11, borderBottomWidth: 19,
    borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: palette.ink,
  },
  head: {
    position: "absolute", left: 0, top: 0, width: 0, height: 0,
    borderLeftWidth: 9, borderRightWidth: 9, borderBottomWidth: 15,
    borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: palette.danger,
  },
  tip: {
    position: "absolute", left: 5, top: 1, width: 0, height: 0,
    borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 7,
    borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: "#FFE3E9",
  },
  shaftOutline: { position: "absolute", left: 4, top: 12, width: 10, height: 21, borderRadius: 2, backgroundColor: palette.ink },
  shaft: { position: "absolute", left: 6, top: 13, width: 6, height: 18, borderRadius: 1, backgroundColor: palette.danger },
  bannerWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "flex-start", paddingTop: "18%", pointerEvents: "none" },
  banner: { fontFamily: fonts.display, fontSize: 44, letterSpacing: 3, textAlign: "center" },
  click: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7, 2, 15, 0.45)", cursor: "pointer" },
  clickCard: {
    paddingVertical: 18, paddingHorizontal: 28, borderRadius: 20, backgroundColor: palette.panelSolid,
    borderWidth: 2, borderColor: palette.cyan, alignItems: "center", gap: 6,
  },
  clickTitle: { fontFamily: fonts.display, fontSize: 30, letterSpacing: 2, color: palette.textPrimary },
  clickSub: { fontFamily: fonts.label, fontSize: 14, letterSpacing: 1.5, color: palette.textSecondary },
  toastWrap: { position: "absolute", left: 0, right: 0, bottom: 120, alignItems: "center", pointerEvents: "none" },
  toast: {
    fontFamily: fonts.button, fontSize: 15, letterSpacing: 2, color: palette.textPrimary, paddingVertical: 8,
    paddingHorizontal: 16, borderRadius: 999, backgroundColor: "rgba(11, 4, 32, 0.88)", borderWidth: 1, borderColor: palette.cyan,
    overflow: "hidden",
  },
  overlay: { backgroundColor: palette.overlay, alignItems: "center", justifyContent: "center", padding: 16 },
  card: {
    width: 340, maxWidth: "92%", padding: 24, borderRadius: 24, backgroundColor: palette.panelSolid,
    borderWidth: 1.5, borderColor: palette.panelBorder, alignItems: "center", gap: 12,
  },
  cardTitle: { fontFamily: fonts.title, fontSize: 26, color: palette.textPrimary },
  cardBody: { fontFamily: fonts.body, fontSize: 16, color: palette.textSecondary, textAlign: "center" },
});
