// Arena 360 first-run tutorial (spec section 10; "bs.arenaTutorialSeen"),
// run after the intro sweep with the creep paused: 1 MOVE (walk 1.5 w),
// 2 AIM (turn 90 deg total), 3 FIRE (first pop or 3 shots). Each step ticks
// a check, then the next starts after 300 ms. SKIP ends it. After that,
// on the 2nd shot of the game, a 3 s swap hint.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ArenaControls } from "../../arena/ArenaControls";
import type { ArenaEngine } from "../../game/arena";
import { fonts, palette } from "../theme";

export const TUTORIAL_KEY = "bs.arenaTutorialSeen";

const COPY = {
  touch: ["DRAG LEFT THUMB TO MOVE", "DRAG RIGHT SIDE TO TURN", "TAP FIRE · MATCH 3 COLOURS"],
  desktop: ["WASD TO MOVE", "MOVE MOUSE TO TURN", "CLICK TO FIRE · MATCH 3 COLOURS"],
};

interface Props {
  engine: ArenaEngine;
  controls: ArenaControls;
  desktop: boolean;
  active: boolean; // tutorial stage running
  bottom: number;
  onDone: () => void;
  onLaserWide: (wide: number) => void;
}

export function ArenaTutorial({ engine, controls, desktop, active, bottom, onDone, onLaserWide }: Props) {
  const [step, setStep] = useState(0);
  const [ticked, setTicked] = useState(false);
  const [swapHint, setSwapHint] = useState(false);
  const progress = useRef({ walked: 0, x: 0, z: 0, turned0: 0, shots: 0, popped: false });

  useEffect(() => {
    if (!active) return;
    const s = engine.getShooter();
    progress.current = { walked: 0, x: s.x, z: s.z, turned0: controls.turnedTotal, shots: 0, popped: false };
    setStep(0);
    setTicked(false);
    const offs = [
      engine.on("shoot", () => progress.current.shots++),
      engine.on("pop", () => (progress.current.popped = true)),
    ];
    return () => offs.forEach((off) => off());
  }, [active, engine, controls]);

  useEffect(() => {
    onLaserWide(active && step === 1 ? 1.5 : 1);
  }, [active, step, onLaserWide]);

  useEffect(() => {
    if (!active || ticked) return;
    const id = setInterval(() => {
      const p = progress.current;
      const s = engine.getShooter();
      p.walked += Math.hypot(s.x - p.x, s.z - p.z);
      p.x = s.x;
      p.z = s.z;
      const done =
        step === 0 ? p.walked >= 1.5 : step === 1 ? controls.turnedTotal - p.turned0 >= Math.PI / 2 : p.popped || p.shots >= 3;
      if (done) setTicked(true);
    }, 100);
    return () => clearInterval(id);
  }, [active, ticked, step, engine, controls]);

  useEffect(() => {
    if (!ticked) return;
    const id = setTimeout(() => {
      setTicked(false);
      if (step >= 2) finish();
      else {
        if (step === 1) progress.current.shots = 0;
        setStep(step + 1);
      }
    }, 500);
    return () => clearTimeout(id);
    // finish is stable for the life of the tutorial
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticked, step]);

  // swap hint on the 2nd shot of the game (after the tutorial)
  useEffect(() => {
    if (active) return;
    let shots = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = engine.on("shoot", () => {
      shots++;
      if (shots === 2) {
        setSwapHint(true);
        timer = setTimeout(() => setSwapHint(false), 3000);
      }
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [active, engine]);

  function finish() {
    AsyncStorage.setItem(TUTORIAL_KEY, "1").catch(() => undefined);
    onDone();
  }

  if (!active) {
    if (!swapHint) return null;
    return (
      <View style={[styles.wrap, { bottom }]} pointerEvents="none">
        <View style={styles.pill}>
          <Text style={styles.text}>{desktop ? "X TO SWAP" : "TAP NEXT TO SWAP"}</Text>
        </View>
      </View>
    );
  }
  const copy = (desktop ? COPY.desktop : COPY.touch)[step];
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <View style={styles.pill}>
        <Text style={styles.pips}>{step + 1}/3</Text>
        <Text style={styles.text}>{copy}</Text>
        {ticked && <Text style={styles.tick}>✓</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Skip tutorial" hitSlop={8} onPress={finish} style={styles.skip}>
          <Text style={styles.skipText}>SKIP</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingLeft: 18, paddingRight: 6, borderRadius: 999,
    backgroundColor: palette.panel, borderWidth: 1.5, borderColor: palette.panelBorder, maxWidth: "92%",
  },
  pips: { fontFamily: fonts.label, fontSize: 13, color: palette.cyan, letterSpacing: 1 },
  text: { fontFamily: fonts.label, fontSize: 18, letterSpacing: 1.4, color: palette.textPrimary, flexShrink: 1, paddingVertical: 8 },
  tick: { fontSize: 22, color: "#7CFF4F" },
  skip: { minWidth: 56, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.textMuted },
  skipText: { fontFamily: fonts.button, fontSize: 13, letterSpacing: 1.5, color: palette.textSecondary },
});
