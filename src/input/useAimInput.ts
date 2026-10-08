// Pointer / touch / keyboard -> engine commands.
//
// Built on react-native-gesture-handler (bundled in Expo Go), which gives
// view-relative coordinates on iOS, Android and web alike:
//   Pan (minDistance 0)  touch/mouse down aims, drag re-aims, release fires.
//                        Pressing on the next-bomb preview swaps instead.
//   Hover                mouse hover aims on desktop (and iPad pointer).
// Screen points are converted with the active renderer's screenToBoard, so a
// perspective renderer only needs to supply its own mapping.

import { useMemo, useRef, useState } from "react";
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
  onPause?: () => void;
  blocked?: () => boolean;
}

export function useAimInput({ engine, layout, screenToBoard, onStart, onPause, blocked }: Options) {
  const [pointerDown, setPointerDown] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [keyboardAim, setKeyboardAim] = useState(false);

  // Gesture objects are created once; they read the latest layout via a ref.
  const latest = useRef({ layout, screenToBoard });
  latest.current = { layout, screenToBoard };

  const gesture = useMemo(() => {
    const toBoard = (x: number, y: number) => latest.current.screenToBoard(latest.current.layout, x, y);
    // Tap target around the next-bomb socket: at least 30pt radius (60pt
    // target) whatever the board scale, never smaller than 1.5 bomb radii.
    const onNext = (p: Vec2) => {
      if (engine.getPhase() !== "ready") return false;
      const n = engine.getNextBomb();
      const r = Math.max(engine.config.radius * 1.5, 30 / Math.max(0.01, latest.current.layout.scale));
      return (p.x - n.x) ** 2 + (p.y - n.y) ** 2 <= r * r;
    };
    // The swap/fire decision is made on RELEASE from the release point, so it
    // doesn't depend on callback order or on the press-point coordinates.
    let pressOnNext = false;

    const pan = Gesture.Pan()
      .minDistance(0)
      .maxPointers(1)
      .runOnJS(true) // keep callbacks on JS even if Reanimated gets installed later
      .onBegin((e) => {
        const p = toBoard(e.x, e.y);
        pressOnNext = onNext(p);
        if (pressOnNext) return;
        engine.aimAt(p.x, p.y);
        setPointerDown(true);
        setKeyboardAim(false);
      })
      .onUpdate((e) => {
        const p = toBoard(e.x, e.y);
        // Pressing on the socket: don't swing the aim toward it
        if (onNext(p)) return;
        pressOnNext = false;
        engine.aimAt(p.x, p.y);
        setPointerDown(true);
        setKeyboardAim(false);
      })
      .onEnd((e, success) => {
        const p = toBoard(e.x, e.y);
        if (onNext(p) || (pressOnNext && engine.getPhase() === "ready")) engine.swapBomb();
        else if (success) engine.fire();
        pressOnNext = false;
      })
      .onFinalize(() => {
        setPointerDown(false);
      });

    const hover = Gesture.Hover()
      .runOnJS(true)
      .onBegin(() => setHovering(true))
      .onUpdate((e) => {
        const p = toBoard(e.x, e.y);
        // Don't swing the aim while the cursor rests on the swap button
        if (!onNext(p)) engine.aimAt(p.x, p.y);
        setKeyboardAim(false);
      })
      .onFinalize(() => setHovering(false));

    return Gesture.Simultaneous(pan, hover);
  }, [engine]);

  useKeyboardControls({ engine, onStart, onPause, blocked, onAimKey: () => setKeyboardAim(true) });

  return { gesture, showAimGuide: pointerDown || hovering || keyboardAim };
}
