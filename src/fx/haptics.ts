// expo-haptics mapping from the design spec (section 7). No-op on web and
// when the player turns haptics off; throttled to one call per 60ms; native
// failures (e.g. haptics disabled system-wide) are ignored.

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { GameEngineView } from "../game/types";
import { getSettings } from "../ui/settings";

const supported = Platform.OS !== "web";
const THROTTLE_MS = 60;
let last = 0;

const run = (fn: () => Promise<void>) => {
  if (!supported || !getSettings().haptics) return;
  const now = Date.now();
  if (now - last < THROTTLE_MS) return;
  last = now;
  fn().catch(() => undefined);
};

const impact = (style: Haptics.ImpactFeedbackStyle) => () => run(() => Haptics.impactAsync(style));

export const haptics = {
  selection: () => run(() => Haptics.selectionAsync()),
  light: impact(Haptics.ImpactFeedbackStyle.Light),
  soft: impact(Haptics.ImpactFeedbackStyle.Soft),
  medium: impact(Haptics.ImpactFeedbackStyle.Medium),
  heavy: impact(Haptics.ImpactFeedbackStyle.Heavy),
  rigid: impact(Haptics.ImpactFeedbackStyle.Rigid),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

// Map engine events to haptics. Returns an unsubscribe for useEffect.
export function attachHaptics(engine: GameEngineView): () => void {
  let snapPending = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const offs = [
    engine.on("shoot", haptics.light),
    engine.on("swap", haptics.selection),
    engine.on("snap", () => {
      // "pop" fires synchronously right after "snap" when the shot scores
      snapPending = true;
      void Promise.resolve().then(() => {
        if (snapPending) haptics.soft();
        snapPending = false;
      });
    }),
    engine.on("pop", ({ tiles, combo }) => {
      snapPending = false;
      if (tiles.length >= 6 || combo >= 3) haptics.heavy();
      else haptics.medium();
    }),
    engine.on("drop", () => later(80, haptics.rigid)),
    engine.on("ceilingDrop", haptics.heavy),
    engine.on("gameOver", haptics.error),
    engine.on("won", haptics.success),
  ];
  return () => {
    offs.forEach((off) => off());
    timers.forEach(clearTimeout);
  };
}
