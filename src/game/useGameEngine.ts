// React binding for the engine: owns one GameEngine (and its SimClock) for the
// component's life and drives it with requestAnimationFrame (native and web).

import { useEffect, useRef, useState } from "react";
import { GameEngine, GameEngineOptions } from "./engine";
import { SimClock } from "./simClock";
import { EngineEventName } from "./types";

// Longest real frame we accept (a background tab must not dump seconds of FX)
const MAX_REAL_DT = 0.25;

// Events that change what the React UI (HUD, overlays) shows
const UI_EVENTS: EngineEventName[] = ["phaseChanged", "scoreChanged", "swap", "ceilingDrop", "pop", "shoot"];

export interface GameEngineHandle {
  engine: GameEngine;
  clock: SimClock;
  // Changes whenever React should re-render. With `reactFrames` (default) it
  // is the engine revision, so it changes on every visible change; without
  // it, only on UI-relevant events (for renderers that animate themselves).
  frame: number;
}

export interface UseGameEngineOptions extends GameEngineOptions {
  reactFrames?: boolean;
}

export function useGameEngine(options?: UseGameEngineOptions): GameEngineHandle {
  const engineRef = useRef<GameEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new GameEngine(options);
  const engine = engineRef.current;
  const clockRef = useRef<SimClock | null>(null);
  if (clockRef.current === null) clockRef.current = new SimClock();
  const clock = clockRef.current;
  const reactFrames = options?.reactFrames ?? true;
  const [frame, setFrame] = useState(() => engine.getRevision());

  useEffect(() => {
    if (reactFrames) return;
    const bump = () => setFrame(engine.getRevision());
    const offs = UI_EVENTS.map((name) => engine.on(name, bump));
    return () => offs.forEach((off) => off());
  }, [engine, reactFrames]);

  useEffect(() => {
    let handle = 0;
    let last: number | null = null;
    let alive = true;

    const tick = (now: number) => {
      if (!alive) return;
      // First frame advances 0; the engine clamps each step itself so a slow
      // frame can't teleport the bomb through tiles.
      const realDt = last === null ? 0 : Math.min(Math.max((now - last) / 1000, 0), MAX_REAL_DT);
      last = now;
      const simDt = clock.advance(realDt);
      engine.update(simDt);
      if (reactFrames) setFrame(engine.getRevision()); // same value -> React bails out
      clock.emitFrame(realDt, simDt);
      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(handle);
    };
  }, [engine, clock, reactFrames]);

  return { engine, clock, frame };
}
