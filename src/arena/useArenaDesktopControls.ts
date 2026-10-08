// Arena 360 desktop controls (web only; spec section 6):
//   WASD move (camera-relative)   Q/E or Left/Right turn   R face threat
//   mouse: pointer-lock mouse-look (yaw only); if the lock is refused or
//   unsupported, cursor-edge turning: only in the outer 15% band of the
//   screen and only while the cursor is over the playfield itself (not over
//   a button / HUD card), up to 180 deg/s at the very edge
//   left click / Space fire   X / Shift / right click swap   Esc / P pause
// Esc while locked is eaten by the browser and releases the lock, which we
// treat as pause. The "click to play" click that takes the lock never fires.

import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import type { ArenaEngine } from "../game/arena";
import type { ArenaWorld } from "../render/arena/ArenaWorld";
import { getSettings } from "../ui/settings";
import { ArenaControls } from "./ArenaControls";
import { biggestThreat } from "./arenaMath";

export type LockState = "none" | "locked" | "fallback";

interface Options {
  enabled: boolean; // desktop web
  engine: ArenaEngine;
  controls: ArenaControls;
  world: ArenaWorld;
  active: boolean; // playing (tutorial or game), not paused / ended
  onPause: () => void; // toggle
  onIdleKey: () => void; // Space / Enter while play isn't live (intro skip, end card)
  rootRef: RefObject<View | null>; // the arena root view = the bare playfield
}

const EDGE_BAND = 0.15;

const onButton = (t: EventTarget | null) =>
  typeof HTMLElement !== "undefined" && t instanceof HTMLElement && t.closest('[role="button"],button,[role="switch"]') !== null;

export function faceBiggestThreat(engine: ArenaEngine, controls: ArenaControls) {
  const s = engine.getShooter();
  const a = biggestThreat(engine.getDangerByAngle(16));
  const target = a === null ? s.yaw + Math.PI : Math.atan2(Math.sin(a) * 6.5 - s.z, Math.cos(a) * 6.5 - s.x);
  controls.snapTo(s.yaw, target, 0.28);
}

export function useArenaDesktopControls(o: Options) {
  const [lock, setLock] = useState<LockState>("none");
  const latest = useRef(o);
  latest.current = o;
  const lockRef = useRef<LockState>("none");
  lockRef.current = lock;

  const requestLock = useCallback(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const el = document.body;
    if (typeof el.requestPointerLock !== "function") {
      setLock("fallback");
      return;
    }
    try {
      const r: unknown = el.requestPointerLock();
      if (r instanceof Promise) r.catch(() => setLock("fallback"));
    } catch {
      setLock("fallback");
    }
  }, []);

  const releaseLock = useCallback(() => {
    if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
  }, []);

  useEffect(() => {
    if (!o.enabled || Platform.OS !== "web" || typeof window === "undefined") return;
    const keyMap: Record<string, keyof ArenaControls["keys"]> = {
      KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right", KeyQ: "turnL", KeyE: "turnR", ArrowLeft: "turnL", ArrowRight: "turnR",
      ArrowUp: "up", ArrowDown: "down",
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { engine, controls, active } = latest.current;
      const k = keyMap[e.code];
      if (k) {
        controls.keys[k] = true;
        e.preventDefault();
        return;
      }
      switch (e.code) {
        case "Space":
        case "Enter":
          if (e.repeat) break;
          if (!active && onButton(e.target)) return; // a focused button handles its own key
          if (!active) latest.current.onIdleKey();
          else if (e.code === "Space") engine.fire();
          break;
        case "KeyX":
        case "ShiftLeft":
        case "ShiftRight":
          if (!e.repeat && active) engine.swapBomb();
          break;
        case "KeyR":
          if (active) faceBiggestThreat(engine, controls);
          break;
        case "Escape":
        case "KeyP":
          if (!e.repeat && engine.getPhase() === "playing") latest.current.onPause();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = keyMap[e.code];
      if (k) latest.current.controls.keys[k] = false;
    };
    const onBlur = () => latest.current.controls.clear();
    // RN-web: a View ref is its DOM element. Overlays that ignore pointer
    // events (texts, canvas) let the root be the event target.
    const onPlayfield = (t: EventTarget | null) => t !== null && t === (latest.current.rootRef.current as unknown as EventTarget | null);
    const onMove = (e: MouseEvent) => {
      const { controls, active } = latest.current;
      if (!active) return;
      if (lockRef.current === "locked") {
        controls.addYaw(e.movementX * getSettings().mouseSensitivity);
      } else if (lockRef.current === "fallback") {
        const half = window.innerWidth / 2;
        const off = (e.clientX - half) / half;
        const edge = Math.abs(off) - (1 - EDGE_BAND);
        controls.cursorTurn = onPlayfield(e.target) && edge > 0 ? Math.sign(off) * Math.min(1, edge / EDGE_BAND) : 0;
      }
    };
    const onDown = (e: MouseEvent) => {
      const { engine, active } = latest.current;
      if (!active || lockRef.current === "none" || (lockRef.current === "fallback" && !onPlayfield(e.target))) return;
      if (e.button === 0) engine.fire();
      else if (e.button === 2) engine.swapBomb();
    };
    const onContext = (e: MouseEvent) => e.preventDefault();
    const onLockChange = () => {
      const locked = document.pointerLockElement !== null;
      if (locked) setLock("locked");
      else if (lockRef.current === "locked") {
        setLock("none");
        if (latest.current.active) latest.current.onPause();
      }
    };
    const onLockError = () => setLock("fallback");
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("contextmenu", onContext);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("pointerlockerror", onLockError);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("contextmenu", onContext);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("pointerlockerror", onLockError);
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, [o.enabled]);

  // stop cursor turning when play stops
  useEffect(() => {
    if (!o.active) o.controls.cursorTurn = 0;
  }, [o.active, o.controls]);

  return { lock, requestLock, releaseLock };
}
