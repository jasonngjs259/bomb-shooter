// Arena 360 session bookkeeping: end-of-game result, the end card timing
// (card at 2.6 s after the lose/win sequence starts, buttons armed 1.5 s
// later), best score (its own storage key), biggest combo, the
// "bs.arenaPlayed" flag that hides the title's NEW badge, and the level
// progress: levelStars -> stars / bests / unlocks (bs.arena.progress).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArenaEngine } from "../../game/arena";
import { SkinItem, skinItem } from "../../game/arena/skins";
import { applyLevelStars, reachLevel } from "../../storage/arenaProgress";
import { ARENA_BEST_KEY, loadBestScore, saveBestScore } from "../../storage/bestScore";
import { getProgress, setProgress } from "../../storage/progressStore";
import { ARM_MS, EndStars } from "./ArenaEndCard";

export const ARENA_PLAYED_KEY = "bs.arenaPlayed";

export interface ArenaResult { won: boolean; score: number; level: number; time: number; combo: number }

export function useArenaSession(engine: ArenaEngine, still: boolean) {
  const [result, setResult] = useState<ArenaResult | null>(null);
  const [stars, setStars] = useState<EndStars | null>(null);
  const [unlocks, setUnlocks] = useState<SkinItem[]>([]);
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
      if (!won) setProgress(reachLevel(getProgress(), engine.getLevel()));
      setResult({ won, score, level: engine.getLevel(), time: engine.getTime(), combo: Math.max(combo.current, engine.getBestCombo()) });
    };
    const offs = [
      engine.on("pop", ({ combo: c }) => (combo.current = Math.max(combo.current, c))),
      engine.on("gameOver", () => end(false)),
      engine.on("won", () => end(true)),
      engine.on("levelStars", (ev) => {
        const r = applyLevelStars(getProgress(), ev, engine.getScore());
        setProgress(r.progress);
        // newBest from the stored record (robust even if the engine's `best` was missing)
        setStars({ clear: ev.clear, fast: ev.fast, flawless: ev.flawless, time: ev.time, par: ev.par, bestCombo: ev.bestCombo, newBest: r.newBest });
        setUnlocks(r.newlyUnlocked.map(skinItem).filter((x): x is SkinItem => !!x));
      }),
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
    setStars(null);
    setUnlocks([]);
    setVisible(false);
    setArmed(false);
    setIsNewBest(false);
    if (!keepCombo) combo.current = 0;
  }, []);

  return { result, stars, unlocks, visible, armed, best, isNewBest, reset };
}
