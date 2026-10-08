// Arena 360 session bookkeeping: end-of-game result, the end card timing
// (card at 2.6 s after the lose/win sequence starts, buttons armed 1.5 s
// later), best score (its own storage key), biggest combo and the
// "bs.arenaPlayed" flag that hides the title's NEW badge.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArenaEngine } from "../../game/arena";
import { ARENA_BEST_KEY, loadBestScore, saveBestScore } from "../../storage/bestScore";
import { ARM_MS } from "./ArenaEndCard";

export const ARENA_PLAYED_KEY = "bs.arenaPlayed";

export interface ArenaResult { won: boolean; score: number; level: number; time: number; combo: number }

export function useArenaSession(engine: ArenaEngine, still: boolean) {
  const [result, setResult] = useState<ArenaResult | null>(null);
  const [visible, setVisible] = useState(false);
  const [armed, setArmed] = useState(false);
  const [best, setBest] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const bestRef = useRef(0);
  const combo = useRef(0);

  useEffect(() => {
    let alive = true;
    loadBestScore(ARENA_BEST_KEY).then((v) => {
      if (!alive) return;
      bestRef.current = Math.max(bestRef.current, v);
      setBest(bestRef.current);
    });
    const end = (won: boolean) => {
      const score = engine.getScore();
      const beat = score > bestRef.current;
      setIsNewBest(beat);
      if (beat) {
        bestRef.current = score;
        setBest(score);
        void saveBestScore(score, ARENA_BEST_KEY);
      }
      AsyncStorage.setItem(ARENA_PLAYED_KEY, "1").catch(() => undefined);
      setResult({ won, score, level: engine.getLevel(), time: engine.getTime(), combo: combo.current });
    };
    const offs = [
      engine.on("pop", ({ combo: c }) => (combo.current = Math.max(combo.current, c))),
      engine.on("gameOver", () => end(false)),
      engine.on("won", () => end(true)),
    ];
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, [engine]);

  useEffect(() => {
    if (!result) return;
    const show = setTimeout(() => setVisible(true), still ? 800 : 2600);
    const arm = setTimeout(() => setArmed(true), (still ? 800 : 2600) + ARM_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(arm);
    };
  }, [result, still]);

  const reset = useCallback((keepCombo = false) => {
    setResult(null);
    setVisible(false);
    setArmed(false);
    setIsNewBest(false);
    if (!keepCombo) combo.current = 0;
  }, []);

  return { result, visible, armed, best, isNewBest, reset };
}
