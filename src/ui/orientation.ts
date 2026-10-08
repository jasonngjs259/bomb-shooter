// Screen orientation per mode (native only): title + Classic portrait,
// Arena 360 landscape (both sides). Needs app.json "orientation": "default".
// Web can't lock; Arena shows its portrait fallback layout + a rotate toast.

import * as ScreenOrientation from "expo-screen-orientation";
import { Platform } from "react-native";

export const canLockOrientation = Platform.OS !== "web";

export async function lockPortrait() {
  if (!canLockOrientation) return;
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  } catch {
    // unsupported device / Expo Go limitation: keep whatever is current
  }
}

export async function lockLandscape(): Promise<boolean> {
  if (!canLockOrientation) return false;
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return true;
  } catch {
    return false;
  }
}
