// Best score persistence. AsyncStorage works on iOS, Android and web
// (localStorage); failures are swallowed so the game never depends on it.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "bomb-shooter/best-score";

export async function loadBestScore(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const value = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export async function saveBestScore(score: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(Math.max(0, Math.floor(score))));
  } catch {
    // Storage unavailable (private mode etc.) - keep the in-memory best only
  }
}
