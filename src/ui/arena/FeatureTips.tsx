// One-time feature tips (fun-pass spec section 1, "Feature intros"): a pill
// top-centre (under the HUD row, lower on boss levels), max one on screen,
// 1.5 s between tips, slides down 220 ms, holds 2.8 s, fades 200 ms. Tap /
// click / Esc dismisses. Driven by the engine's featureIntro event (plus
// feverStart and the first boss shield pop for the follow-up tips), filtered
// by the persisted introsSeen and the Settings "Tips" toggle. Never shown
// during the intro sweep, a boss phase shift or the end sequence (the
// screen passes `allowed`). The L5 roll lesson is RollTutorial below.

import { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { audio, uiFunSounds } from "../../audio";
import type { ArenaEngine, FeatureId } from "../../game/arena";
import { markIntroSeen } from "../../storage/arenaProgress";
import { getProgress, updateProgress } from "../../storage/progressStore";
import { getSettings, useSettings } from "../settings";
import { fonts, palette } from "../theme";
import { ownLayer } from "../webSafe";

const native = Platform.OS !== "web";
const HOLD_MS = 2800;
const GAP_MS = 1500;
const PHASE_SHIFT_HOLD_MS = 1600;

export type TipId = Exclude<FeatureId, "roll"> | "feverStart" | "bossWeak";

// <= 6 words each.
export const TIP_COPY: Record<TipId, string> = {
  pickups: "POWER-UP! RUN OVER IT",
  rainbow: "RAINBOW: MATCHES ANY COLOUR",
  freeze: "FREEZE! WALL STOPPED",
  mega: "MEGA: BIG BLAST",
  lightning: "LIGHTNING: CHAINS ONE COLOUR",
  armored: "ARMORED BOMBS NEED 2 MATCHES",
  fever: "COMBOS FILL FEVER",
  feverStart: "FEVER! RAPID FIRE · ANY COLOUR",
  boss: "BREAK THE SHIELD · HIT THE CORE",
  bossWeak: "GLOW COLOUR = DOUBLE DAMAGE",
  ticking: "DEFUSE TICKING BOMBS BEFORE 0",
  rotation: "THE WALL IS SPINNING",
  roller: "SHOOT ROLLERS OR ROLL AWAY",
  doubleRing: "TWO RINGS: AIM THROUGH THE GAPS",
};

const TIP_ACCENT: Partial<Record<TipId, string>> = {
  fever: palette.magenta, feverStart: palette.gold, boss: palette.danger, bossWeak: palette.gold, ticking: palette.danger,
  freeze: "#CFF4FF", mega: palette.gold, lightning: "#FFF36B",
};

const wantTip = (id: string) => getSettings().tips && !getProgress().introsSeen.includes(id);

interface Props {
  engine: ArenaEngine;
  allowed: boolean; // play is live (not intro / paused / ended / roll lesson)
  top: number;
}

export const FeatureTips = memo(function FeatureTips({ engine, allowed, top }: Props) {
  const settings = useSettings();
  const [tip, setTip] = useState<{ id: TipId; key: number } | null>(null);
  const queue = useRef<TipId[]>([]);
  const nextAt = useRef(0);
  const holdUntil = useRef(0);
  const v = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const latest = useRef({ allowed });
  latest.current.allowed = allowed;

  // engine events -> queue
  useEffect(() => {
    let shieldSeen = false;
    const push = (id: TipId) => {
      if (!wantTip(id) || queue.current.includes(id)) return;
      queue.current.push(id);
    };
    const offs = [
      engine.on("featureIntro", ({ feature }) => {
        if (feature !== "roll") push(feature);
      }),
      engine.on("feverStart", () => push("feverStart")),
      engine.on("bossShieldPop", () => {
        if (shieldSeen) return;
        shieldSeen = true;
        push("bossWeak");
      }),
      engine.on("bossPhase", () => (holdUntil.current = Date.now() + PHASE_SHIFT_HOLD_MS)),
      engine.on("phaseChanged", ({ phase, previous }) => {
        if (phase === "playing" && previous !== "playing") shieldSeen = false;
        // new level or the end sequence: drop what is queued / showing
        queue.current = [];
        anim.current?.stop();
        setTip(null);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [engine]);

  // queue -> pill (polled: the queue is a ref, tips are rare)
  useEffect(() => {
    if (!allowed || !settings.tips) return;
    const id = setInterval(() => {
      if (!latest.current.allowed || tip) return;
      const now = Date.now();
      if (now < nextAt.current || now < holdUntil.current) return;
      let next: TipId | undefined;
      while ((next = queue.current.shift()) !== undefined && !wantTip(next));
      if (!next) return;
      const shown = next;
      updateProgress((p) => markIntroSeen(p, shown));
      uiFunSounds.tip(audio);
      setTip({ id: shown, key: now });
    }, 150);
    return () => clearInterval(id);
  }, [allowed, settings.tips, tip]);

  const dismiss = () => {
    anim.current?.stop();
    Animated.timing(v, { toValue: 2, duration: 200, useNativeDriver: native }).start(() => {
      setTip(null);
      nextAt.current = Date.now() + GAP_MS;
    });
  };

  useEffect(() => {
    if (!tip) return;
    v.setValue(0);
    const a = Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 220, easing: Easing.out(Easing.back(1.4)), useNativeDriver: native }),
      Animated.delay(HOLD_MS),
      Animated.timing(v, { toValue: 2, duration: 200, useNativeDriver: native }),
    ]);
    anim.current = a;
    a.start(({ finished }) => {
      if (!finished) return;
      setTip(null);
      nextAt.current = Date.now() + GAP_MS;
    });
    // Esc dismisses (and still pauses, handled by the controls)
    if (Platform.OS !== "web" || typeof window === "undefined") return () => a.stop();
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      a.stop();
      window.removeEventListener("keydown", onKey);
    };
    // dismiss is stable enough (refs + Animated value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip, v]);

  // hidden while not allowed (pause, end): drop the current pill
  useEffect(() => {
    if (!allowed && tip) {
      anim.current?.stop();
      setTip(null);
    }
  }, [allowed, tip]);

  if (!tip) return null;
  const ty = v.interpolate({ inputRange: [0, 1, 2], outputRange: [-24, 0, 0] });
  const opacity = v.interpolate({ inputRange: [0, 0.4, 1, 2], outputRange: [0, 1, 1, 0] });
  const accent = TIP_ACCENT[tip.id] ?? palette.cyan;
  return (
    <View style={[styles.wrap, { top }]}>
      <Animated.View style={{ opacity, transform: [...ownLayer, { translateY: ty }] }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${TIP_COPY[tip.id]}. Dismiss tip`} onPress={dismiss} style={[styles.pill, { borderColor: accent }]}>
          <View style={[styles.dot, { backgroundColor: accent }]} />
          <Text style={styles.text}>{TIP_COPY[tip.id]}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", pointerEvents: "box-none" },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, maxWidth: 420, paddingHorizontal: 18, borderRadius: 999,
    backgroundColor: "rgba(22, 10, 51, 0.9)", borderWidth: 1.5, cursor: "pointer",
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { fontFamily: fonts.button, fontSize: 18, letterSpacing: 1.4, color: palette.textPrimary, flexShrink: 1, paddingVertical: 8 },
});
