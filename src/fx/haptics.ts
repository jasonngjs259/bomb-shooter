// expo-haptics wrapper. Haptics don't exist on web, so every call is a no-op
// there; native failures (e.g. haptics disabled) are ignored. All calls are
// throttled to one per 60ms and respect the Haptics setting.

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { GameEngineView } from "../game/types";
import { settingsStore } from "../storage/settings";

const supported = Platform.OS !== "web";
const THROTTLE_MS = 60;
let lastAt = 0;

const run = (fn: () => Promise<void>) => {
  if (!supported || !settingsStore.get().haptics) return;
  const now = Date.now();
  if (now - lastAt < THROTTLE_MS) return;
  lastAt = now;
  fn().catch(() => undefined);
};

const impact = (style: Haptics.ImpactFeedbackStyle) => () => run(() => Haptics.impactAsync(style));

export const haptics = {
  tap: () => run(() => Haptics.selectionAsync()),
  light: impact(Haptics.ImpactFeedbackStyle.Light),
  soft: impact(Haptics.ImpactFeedbackStyle.Soft),
  medium: impact(Haptics.ImpactFeedbackStyle.Medium),
  heavy: impact(Haptics.ImpactFeedbackStyle.Heavy),
  rigid: impact(Haptics.ImpactFeedbackStyle.Rigid),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

// Map engine events to haptics (design spec section 7). Returns an
// unsubscribe for useEffect.
export function attachHaptics(engine: GameEngineView): () => void {
  if (!supported) return () => undefined;
  // `snap` fires just before `pop` in the same engine step: only a snap that
  // did not pop gets the soft tick.
  let popped = false;
  let dropTimer: ReturnType<typeof setTimeout> | null = null;
  const offs = [
    engine.on("shoot", haptics.light),
    engine.on("swap", haptics.tap),
    engine.on("snap", () => {
      popped = false;
      void Promise.resolve().then(() => {
        if (!popped) haptics.soft();
      });
    }),
    engine.on("pop", ({ tiles, combo }) => {
      popped = true;
      if (tiles.length >= 6 || combo >= 3) haptics.heavy();
      else haptics.medium();
    }),
    engine.on("drop", ({ tiles }) => {
      if (tiles.length === 0) return;
      if (dropTimer) clearTimeout(dropTimer);
      // 80ms after the pop haptic (and clear of the 60ms throttle)
      dropTimer = setTimeout(haptics.rigid, 80);
    }),
    engine.on("ceilingDrop", haptics.heavy),
    engine.on("gameOver", haptics.error),
    engine.on("won", haptics.success),
  ];
  return () => {
    offs.forEach((off) => off());
    if (dropTimer) clearTimeout(dropTimer);
  };
}
