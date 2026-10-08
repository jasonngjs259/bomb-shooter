import { useEffect, useRef, useState } from "react";
import { GameEngineView } from "../game/types";
import { loadBestScore, saveBestScore } from "../storage/bestScore";

// Tracks the persisted best score and whether the last game beat it.
export function useBestScore(engine: GameEngineView) {
  const [best, setBest] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const bestRef = useRef(0);

  useEffect(() => {
    let alive = true;
    loadBestScore().then((value) => {
      if (!alive) return;
      bestRef.current = Math.max(bestRef.current, value);
      setBest(bestRef.current);
    });
    const onEnd = ({ score }: { score: number }) => {
      const beat = score > bestRef.current;
      setIsNewBest(beat);
      if (beat) {
        bestRef.current = score;
        setBest(score);
        void saveBestScore(score);
      }
    };
    const offs = [
      engine.on("gameOver", onEnd),
      engine.on("won", onEnd),
      engine.on("phaseChanged", ({ phase }) => phase === "ready" && setIsNewBest(false)),
    ];
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, [engine]);

  return { best, isNewBest };
}
