// expo-haptics wrapper. Haptics don't exist on web, so every call is a no-op
// there; native failures (e.g. haptics disabled) are ignored.

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { GameEngineView } from "../game/types";

const enabled = Platform.OS !== "web";

const run = (fn: () => Promise<void>) => {
  if (!enabled) return;
  fn().catch(() => undefined);
};

export const haptics = {
  tap: () => run(() => Haptics.selectionAsync()),
  light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavy: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

// Map engine events to haptics. Returns an unsubscribe for useEffect.
export function attachHaptics(engine: GameEngineView): () => void {
  const offs = [
    engine.on("shoot", haptics.light),
    engine.on("swap", haptics.tap),
    engine.on("pop", ({ combo }) => (combo > 1 ? haptics.heavy() : haptics.medium())),
    engine.on("ceilingDrop", haptics.heavy),
    engine.on("gameOver", haptics.error),
    engine.on("won", haptics.success),
  ];
  return () => offs.forEach((off) => off());
}
