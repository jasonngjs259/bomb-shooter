// Best score persistence. AsyncStorage works on iOS, Android and web
// (localStorage); failures are swallowed so the game never depends on it.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "bomb-shooter/best-score";
export const ARENA_BEST_KEY = "bomb-shooter/arena-best-score";

// `key` selects the mode (Classic by default, ARENA_BEST_KEY for Arena 360).
export async function loadBestScore(key = KEY): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const value = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export async function saveBestScore(score: number, key = KEY): Promise<void> {
  try {
    await AsyncStorage.setItem(key, String(Math.max(0, Math.floor(score))));
  } catch {
    // Storage unavailable (private mode etc.) - keep the in-memory best only
  }
}
