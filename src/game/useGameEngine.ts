// React binding for the engine: owns one GameEngine for the component's life
// and drives it with requestAnimationFrame (available on native and web).

import { useEffect, useRef, useState } from "react";
import { getSimClock } from "./clock";
import { MAX_DT } from "./constants";
import { GameEngine, GameEngineOptions } from "./engine";

export interface GameEngineHandle {
  engine: GameEngine;
  // Engine revision of the last rendered frame. It only changes when the
  // engine changed, so idle frames don't re-render React.
  frame: number;
}

export function useGameEngine(options?: GameEngineOptions): GameEngineHandle {
  const engineRef = useRef<GameEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new GameEngine(options);
  const engine = engineRef.current;
  const [frame, setFrame] = useState(() => engine.getRevision());

  useEffect(() => {
    let handle = 0;
    let last: number | null = null;
    let alive = true;
    const clock = getSimClock(engine); // hit-stop / slow-mo / pause

    const tick = (now: number) => {
      if (!alive) return;
      // First frame advances 0; later frames are clamped so a background tab
      // or a slow frame can't teleport the bomb through tiles.
      const dt = last === null ? 0 : Math.min(Math.max((now - last) / 1000, 0), MAX_DT);
      last = now;
      engine.update(dt * clock.scale());
      setFrame(engine.getRevision()); // same value -> React bails out
      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(handle);
    };
  }, [engine]);

  return { engine, frame };
}
