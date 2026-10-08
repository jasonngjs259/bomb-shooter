// L5 roll mini-tutorial (fun-pass spec section 2.5), once ever (introsSeen
// "roll"), skippable, off with Settings "Tips". The screen pauses the creep
// while it runs (onHold), per the engine notes:
//   1. "SPACE IS NOW ROLL · CLICK OR F TO FIRE" / "TAP ROLL TO DODGE": done after 1 roll
//   2. a scripted roller (debugLaunchRoller(undefined, 0.7), in front of the
//      player) with a "ROLL!" prompt once it is within 3.0 w; done when it is
//      gone (shot, dodged, hit or expired; 12 s safety)
//   3. "SHOOT ROLLERS OR ROLL AWAY" for 2.5 s, then GO.

import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ArenaEngine } from "../../game/arena";
import { getFxBus } from "../../fx/bus";
import { markIntroSeen } from "../../storage/arenaProgress";
import { getProgress, updateProgress } from "../../storage/progressStore";
import { getSettings, useSettings } from "../settings";
import { fonts, palette } from "../theme";

export const ROLL_TUTORIAL_ID = "roll";
const PROMPT_DIST = 3.0;
const ROLLER_TIMEOUT_MS = 12000;

// Should the L5 lesson run for this level? (pure, for the screen)
export const wantsRollTutorial = (engine: ArenaEngine) =>
  engine.getLevelDef().introduces.includes("roll") && getSettings().tips && !getProgress().introsSeen.includes(ROLL_TUTORIAL_ID);

type Step = "roll" | "incoming" | "dodge" | "outro";

interface Props {
  engine: ArenaEngine;
  desktop: boolean;
  active: boolean; // the screen decided to run it (play live, not paused)
  bottom: number;
  onDone: () => void;
}

export function RollTutorial({ engine, desktop, active, bottom, onDone }: Props) {
  const settings = useSettings();
  const [step, setStep] = useState<Step>("roll");
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    updateProgress((p) => markIntroSeen(markIntroSeen(p, ROLL_TUTORIAL_ID), "roller"));
    getFxBus(engine).emit("banner", { text: "GO!", color: palette.gold, duration: 900 });
    doneRef.current();
  };

  useEffect(() => {
    if (!active) return;
    finished.current = false;
    setStep("roll");
  }, [active]);

  // step 1 -> 2: first roll, then launch the scripted roller
  useEffect(() => {
    if (!active || step !== "roll") return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = engine.on("rollStart", () => {
      t = setTimeout(() => {
        const id = engine.debugLaunchRoller(undefined, 0.7);
        if (id < 0) setStep("outro");
        else setStep("incoming");
      }, 700);
    });
    return () => {
      off();
      if (t) clearTimeout(t);
    };
  }, [active, step, engine]);

  // step 2: watch the roller; "ROLL!" inside 3.0 w; next when it is gone
  useEffect(() => {
    if (!active || (step !== "incoming" && step !== "dodge")) return;
    const start = Date.now();
    let launched = engine.getRollers().length > 0;
    const id = setInterval(() => {
      const rollers = engine.getRollers();
      if (rollers.length > 0) launched = true;
      const s = engine.getShooter();
      let near = Infinity;
      for (const r of rollers) near = Math.min(near, Math.hypot(r.x - s.x, r.z - s.z));
      if (near <= PROMPT_DIST) setStep("dodge");
      if ((launched && rollers.length === 0) || Date.now() - start > ROLLER_TIMEOUT_MS) setStep("outro");
    }, 100);
    return () => clearInterval(id);
  }, [active, step, engine]);

  // step 3 -> done
  useEffect(() => {
    if (!active || step !== "outro") return;
    const t = setTimeout(finish, 2500);
    return () => clearTimeout(t);
    // finish only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step]);

  if (!active) return null;
  const rollWord = settings.rollKey === "shift" ? "SHIFT" : "SPACE";
  const copy =
    step === "roll"
      ? desktop
        ? settings.rollKey === "shift"
          ? "PRESS SHIFT TO ROLL · DODGE"
          : "SPACE IS NOW ROLL · CLICK OR F TO FIRE"
        : "TAP ROLL TO DODGE"
      : step === "incoming"
        ? "ROLLER INCOMING!"
        : step === "dodge"
          ? desktop ? `ROLL! (${rollWord})` : "ROLL!"
          : "SHOOT ROLLERS OR ROLL AWAY";
  const hot = step === "dodge";
  return (
    <View style={[styles.wrap, { bottom }]}>
      <View style={[styles.pill, hot && styles.hot]}>
        <Text style={styles.pips}>ROLL</Text>
        <Text style={[styles.text, hot && styles.hotText]}>{copy}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Skip roll tutorial" hitSlop={8} onPress={finish} style={styles.skip}>
          <Text style={styles.skipText}>SKIP</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", pointerEvents: "box-none" },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingLeft: 18, paddingRight: 6, borderRadius: 999,
    backgroundColor: palette.panel, borderWidth: 1.5, borderColor: palette.cyan, maxWidth: "92%",
  },
  hot: { borderColor: palette.gold },
  pips: { fontFamily: fonts.label, fontSize: 13, color: palette.cyan, letterSpacing: 1 },
  text: { fontFamily: fonts.label, fontSize: 18, letterSpacing: 1.4, color: palette.textPrimary, flexShrink: 1, paddingVertical: 8 },
  hotText: { fontFamily: fonts.display, fontSize: 22, color: palette.gold },
  skip: { minWidth: 56, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.textMuted },
  skipText: { fontFamily: fonts.button, fontSize: 13, letterSpacing: 1.5, color: palette.textSecondary },
});
