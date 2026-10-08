// Arena 360 desktop controls (web only; spec section 6):
//   WASD move (camera-relative)   Q/E or Left/Right turn   R face threat
//   mouse: pointer-lock mouse-look (yaw only); if the lock is refused or
//   unsupported, cursor-edge turning: only in the outer 15% band of the
//   screen and only while the cursor is over the playfield itself (not over
//   a button / HUD card), up to 180 deg/s at the very edge
//   left click / F fire (held: fever auto-fire via setFireHeld)
//   Space: ROLL from L5 (roll unlocked), FIRE before (keyMap.ts); setting
//   rollKey "shift" keeps Space = FIRE and makes Shift = ROLL
//   X / Shift / right click swap (a denied swap blips)   Esc / P pause
// Esc while locked is eaten by the browser and releases the lock, which we
// treat as pause. The "click to play" click that takes the lock never fires.

import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import type { ArenaEngine } from "../game/arena";
import type { ArenaWorld, Box } from "../render/arena/ArenaWorld";
import { audio, swapOrDeny } from "../audio";
import { getSettings } from "../ui/settings";
import { ArenaControls } from "./ArenaControls";
import { biggestThreat } from "./arenaMath";
import { ArenaAction, keyAction, mouseAction } from "./keyMap";

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
  // UI drawn without its own hit-testable view (GL radar, pass-through
  // legend) plus HUD cards, in container px: never turn or fire over these
  uiBoxes: Box[];
}

const EDGE_BAND = 0.15;
const UI_PAD = 16; // margin around UI boxes that still counts as UI

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
    // FIRE sources currently held (Space / F / left mouse): fever auto-fire
    // runs while any is down.
    const held = new Set<string>();
    const setHeld = (src: string, down: boolean) => {
      if (down) held.add(src);
      else held.delete(src);
      latest.current.engine.setFireHeld(held.size > 0);
    };
    const act = (a: ArenaAction, src: string) => {
      const { engine, controls } = latest.current;
      switch (a) {
        case "fire":
          engine.fire();
          setHeld(src, true);
          break;
        case "roll":
          engine.roll(0, 0); // engine: move input, else backward
          break;
        case "swap":
          swapOrDeny(engine, audio);
          break;
        case "face":
          faceBiggestThreat(engine, controls);
          break;
        case "pause":
          break;
      }
    };
    const ctx = () => ({ rollUnlocked: latest.current.engine.getLevelDef().roll, rollKey: getSettings().rollKey });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { engine, controls, active } = latest.current;
      const k = keyMap[e.code];
      if (k) {
        controls.keys[k] = true;
        e.preventDefault();
        return;
      }
      if (e.code === "Space" || e.code === "Enter") {
        if (!active && onButton(e.target)) return; // a focused button handles its own key
        if (!active) {
          if (!e.repeat) latest.current.onIdleKey();
          e.preventDefault();
          return;
        }
        if (e.code === "Enter") {
          e.preventDefault();
          return;
        }
      }
      const a = keyAction(e.code, ctx());
      if (!a) return;
      e.preventDefault();
      if (a === "pause") {
        if (!e.repeat && engine.getPhase() === "playing") latest.current.onPause();
        return;
      }
      if (!active || (e.repeat && a !== "face")) return;
      act(a, e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = keyMap[e.code];
      if (k) latest.current.controls.keys[k] = false;
      if (held.has(e.code)) setHeld(e.code, false);
    };
    const onBlur = () => {
      latest.current.controls.clear();
      held.clear();
      latest.current.engine.setFireHeld(false);
    };
    // RN-web: a View ref is its DOM element. Overlays that ignore pointer
    // events (texts, canvas) let the root be the event target.
    const onPlayfield = (e: MouseEvent) => {
      const root = latest.current.rootRef.current as unknown as HTMLElement | null;
      if (!root || e.target !== root) return false;
      const r = root.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const pad = UI_PAD;
      return !latest.current.uiBoxes.some((b) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad);
    };
    const onMove = (e: MouseEvent) => {
      const { controls, active } = latest.current;
      if (!active) return;
      if (lockRef.current === "locked") {
        controls.addYaw(e.movementX * getSettings().mouseSensitivity);
      } else if (lockRef.current === "fallback") {
        const half = window.innerWidth / 2;
        const off = (e.clientX - half) / half;
        const edge = Math.abs(off) - (1 - EDGE_BAND);
        controls.cursorTurn = onPlayfield(e) && edge > 0 ? Math.sign(off) * Math.min(1, edge / EDGE_BAND) : 0;
      }
    };
    const onDown = (e: MouseEvent) => {
      const { active } = latest.current;
      if (!active || lockRef.current === "none" || (lockRef.current === "fallback" && !onPlayfield(e))) return;
      const a = mouseAction(e.button);
      if (a) act(a, `mouse${e.button}`);
    };
    const onUp = (e: MouseEvent) => {
      if (held.has(`mouse${e.button}`)) setHeld(`mouse${e.button}`, false);
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
    window.addEventListener("mouseup", onUp);
    window.addEventListener("contextmenu", onContext);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("pointerlockerror", onLockError);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      latest.current.engine.setFireHeld(false);
      window.removeEventListener("contextmenu", onContext);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("pointerlockerror", onLockError);
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, [o.enabled]);

  // stop cursor turning (and fever auto-fire) when play stops
  useEffect(() => {
    if (!o.active) {
      o.controls.cursorTurn = 0;
      o.engine.setFireHeld(false);
    }
  }, [o.active, o.controls, o.engine]);

  return { lock, requestLock, releaseLock };
}
