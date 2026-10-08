// The renderer contract. A renderer draws the engine's read-only state into
// the board rect described by `layout`; it never mutates the engine.
//
// To plug in a new renderer (Skia, three.js, ...): implement BoardRenderer and
// point `activeRenderer` in src/render/index.ts at it. Input, HUD and overlays
// stay untouched.

import type { ComponentType } from "react";
import type { SimClock } from "../game/simClock";
import type { GameEngineView, Vec2 } from "../game/types";
import type { BoardLayout } from "./layout";

export interface BoardRendererProps {
  engine: GameEngineView;
  // Engine revision; changes whenever anything visible changed. Renderers that
  // draw from React props can memo on it; imperative renderers (GL loops) can
  // ignore it and read the engine every frame.
  frame: number;
  // Where the board sits inside the full-size container, in screen px. The
  // component is rendered absolutely filling that container.
  layout: BoardLayout;
  // True while the player is aiming (finger down, mouse hover, keyboard).
  showAimGuide: boolean;
  // Optional: the simulation clock. Self-animated renderers subscribe to
  // clock.onFrame() to draw right after each engine step, and may request
  // hit-stop / slow motion. Renderers that ignore it keep working.
  clock?: SimClock;
}

// Extra room around the logical board that a renderer draws into (frame,
// rails, ceiling slab), in logical units. The layout reserves it.
export interface FrameInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoardRenderer {
  name: string;
  Component: ComponentType<BoardRendererProps>;
  // Container-local screen point -> logical board point. Optional: defaults to
  // the orthographic inverse of `layout`. A perspective renderer should
  // override it (e.g. raycast onto the board plane).
  screenToBoard?: (layout: BoardLayout, x: number, y: number) => Vec2;
  // True if the renderer animates itself every frame (reads the engine in its
  // own loop), so the screen doesn't need a React re-render per engine change.
  selfAnimated?: boolean;
  frameInsets?: FrameInsets;
  // True if the renderer draws its own full-screen background, so the screen
  // should render it filling the whole window behind the HUD.
  fullScreen?: boolean;
}
