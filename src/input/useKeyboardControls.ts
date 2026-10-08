// Desktop-web keyboard controls. No-op on native (no window / keyboard).
//   Left/Right or A/D  rotate aim (hold for continuous turn)
//   Space              fire (or start/restart from title / end screens)
//   Enter              start/restart
//   X or Shift         swap current and next bomb (right-click too)
//   Escape or P        pause / resume

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { GameEngine } from "../game/engine";

const TURN_SPEED = 110; // degrees per second while a key is held

interface Options {
  engine: GameEngine;
  onStart: () => void; // start / restart when not playing
  onAimKey: () => void; // keyboard took over aiming (show the guide)
  onPause?: () => void; // toggle pause
  blocked?: () => boolean; // true while a modal (pause menu) is open
}

export function useKeyboardControls({ engine, onStart, onAimKey, onPause, blocked }: Options) {
  // Keep callbacks fresh without re-binding listeners
  const cbs = useRef({ onStart, onAimKey, onPause, blocked });
  cbs.current = { onStart, onAimKey, onPause, blocked };

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const held = { left: false, right: false };
    let raf = 0;
    let last: number | null = null;

    const turnLoop = (now: number) => {
      const dt = last === null ? 0 : Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const dir = (held.left ? 1 : 0) - (held.right ? 1 : 0);
      if (dir !== 0) engine.nudgeAngle(dir * TURN_SPEED * dt);
      if (held.left || held.right) raf = requestAnimationFrame(turnLoop);
      else {
        raf = 0;
        last = null;
      }
    };

    const setHeld = (key: "left" | "right", down: boolean) => {
      held[key] = down;
      if (down && !raf) {
        cbs.current.onAimKey();
        engine.nudgeAngle(key === "left" ? 1 : -1); // immediate feedback on tap
        raf = requestAnimationFrame(turnLoop);
      }
    };

    const isPlaying = () => {
      const p = engine.getPhase();
      return p === "ready" || p === "shooting" || p === "resolving";
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Escape" || e.code === "KeyP") {
        if (!e.repeat && (isPlaying() || cbs.current.blocked?.())) cbs.current.onPause?.();
        return;
      }
      if (cbs.current.blocked?.()) return;
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          setHeld("left", true);
          break;
        case "ArrowRight":
        case "KeyD":
          setHeld("right", true);
          break;
        case "Space":
          if (!e.repeat) {
            if (isPlaying()) engine.fire();
            else cbs.current.onStart();
          }
          break;
        case "Enter":
          if (!isPlaying()) cbs.current.onStart();
          break;
        case "KeyX":
        case "ShiftLeft":
        case "ShiftRight":
          if (!e.repeat) engine.swapBomb();
          break;
        default:
          return;
      }
      e.preventDefault(); // stop Space / arrows from scrolling the page
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") held.left = false;
      if (e.code === "ArrowRight" || e.code === "KeyD") held.right = false;
    };

    const onBlur = () => {
      held.left = held.right = false;
    };

    // Right-click swaps (and never opens the browser menu over the game)
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (!cbs.current.blocked?.() && isPlaying()) engine.swapBomb();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("contextmenu", onContextMenu);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [engine]);
}
