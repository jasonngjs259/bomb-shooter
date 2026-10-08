// Pointer / touch / keyboard -> engine commands.
//
// Built on react-native-gesture-handler (bundled in Expo Go), which gives
// view-relative coordinates on iOS, Android and web alike:
//   Pan (minDistance 0)  touch/mouse down aims, drag re-aims, release fires.
//                        Pressing on the next-bomb preview (or its NEXT
//                        label) swaps instead; its hit area is at least
//                        30pt in radius on screen (>= 44pt target) however
//                        small the board is drawn.
//   Hover                mouse hover aims on desktop (and iPad pointer).
//   pointermove (web)    plain window mouse moves also aim: RNGH's Hover
//                        drops the first move after a click (it re-activates
//                        only on the next event), which left a stale ghost.
// Screen points are converted with the active renderer's screenToBoard, so a
// perspective renderer only needs to supply its own mapping.

import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { GameEngine } from "../game/engine";
import { Vec2 } from "../game/types";
import { BoardLayout } from "../render/layout";
import { useKeyboardControls } from "./useKeyboardControls";

interface Options {
  engine: GameEngine;
  layout: BoardLayout;
  screenToBoard: (layout: BoardLayout, x: number, y: number) => Vec2;
  onStart: () => void;
  blocked?: () => boolean; // a menu is open: no mouse aiming
}

export function useAimInput({ engine, layout, screenToBoard, onStart, blocked }: Options) {
  const [pointerDown, setPointerDown] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [keyboardAim, setKeyboardAim] = useState(false);
  const [mouseAim, setMouseAim] = useState(false);

  // Gesture objects are created once; they read the latest layout via a ref.
  const latest = useRef({ layout, screenToBoard });
  latest.current = { layout, screenToBoard };

  const gesture = useMemo(() => {
    const toBoard = (x: number, y: number) => latest.current.screenToBoard(latest.current.layout, x, y);
    // Screen-space NEXT hit test: the preview circle (min 30pt radius) plus
    // the NEXT label drawn under it.
    const onNext = (x: number, y: number) => {
      const p = toBoard(x, y);
      if (engine.isPointOnNextBomb(p.x, p.y)) return true;
      const { layout: l } = latest.current;
      const n = engine.getNextBomb();
      const r = engine.getBoardMetrics().radius;
      const cx = n.x * l.scale + l.offsetX;
      const cy = n.y * l.scale + l.offsetY;
      if (Math.hypot(x - cx, y - cy) <= Math.max(30, r * 1.5 * l.scale)) return true;
      const labelTop = (n.y + r + 4) * l.scale + l.offsetY;
      return Math.abs(x - cx) <= 40 && y >= labelTop && y <= labelTop + 22;
    };
    let swapIntent = false;

    const pan = Gesture.Pan()
      .minDistance(0)
      .maxPointers(1)
      .runOnJS(true) // keep callbacks on JS even if Reanimated gets installed later
      .onBegin((e) => {
        const p = toBoard(e.x, e.y);
        const phase = engine.getPhase();
        swapIntent = (phase === "ready" || phase === "shooting" || phase === "resolving") && onNext(e.x, e.y);
        if (swapIntent) return;
        engine.aimAt(p.x, p.y);
        setPointerDown(true);
        setKeyboardAim(false);
      })
      .onUpdate((e) => {
        if (swapIntent) return;
        const p = toBoard(e.x, e.y);
        engine.aimAt(p.x, p.y);
      })
      .onEnd((e, success) => {
        if (swapIntent) {
          if (onNext(e.x, e.y)) engine.swapBomb();
        } else if (success) {
          engine.fire();
        }
      })
      .onFinalize(() => {
        swapIntent = false;
        setPointerDown(false);
      });

    // Aim on every hover event, including the first one of a move that
    // starts the gesture (onBegin), so a single jump of the cursor updates
    // the guide on the same frame
    const hoverAim = (x: number, y: number) => {
      const p = toBoard(x, y);
      // Don't swing the aim while the cursor rests on the swap button
      if (!onNext(x, y)) engine.aimAt(p.x, p.y);
      setKeyboardAim(false);
    };
    const hover = Gesture.Hover()
      .runOnJS(true)
      .onBegin((e) => {
        setHovering(true);
        hoverAim(e.x, e.y);
      })
      .onUpdate((e) => hoverAim(e.x, e.y))
      .onFinalize(() => setHovering(false));

    return Gesture.Simultaneous(pan, hover);
  }, [engine]);

  // Web mouse: aim from window pointermove too (button up only; drags go
  // through Pan), while playing, not over a button or the next-bomb socket.
  // The game view fills the window, so client coordinates are view ones.
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons !== 0) return;
      if (blockedRef.current?.()) return;
      const phase = engine.getPhase();
      if (phase !== "ready" && phase !== "shooting" && phase !== "resolving") return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[role="button"], button, a')) return;
      const { layout: l, screenToBoard: toBoard } = latest.current;
      const p = toBoard(l, e.clientX, e.clientY);
      if (engine.isPointOnNextBomb(p.x, p.y)) return;
      const n = engine.getNextBomb();
      const r = Math.max(engine.getBoardMetrics().radius * 1.5, 30 / Math.max(0.01, l.scale));
      if ((p.x - n.x) ** 2 + (p.y - n.y) ** 2 <= r * r) return; // resting on the socket
      engine.aimAt(p.x, p.y);
      setMouseAim(true);
      setKeyboardAim(false);
    };
    const onLeave = () => setMouseAim(false);
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [engine]);

  useKeyboardControls({ engine, onStart, onAimKey: () => setKeyboardAim(true) });

  return { gesture, showAimGuide: pointerDown || hovering || keyboardAim || mouseAim };
}
