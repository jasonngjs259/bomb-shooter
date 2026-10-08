// The renderer contract. A renderer draws the engine's read-only state into
// the board rect described by `layout`; it never mutates the engine.
//
// To plug in a new renderer (Skia, three.js, ...): implement BoardRenderer and
// point `activeRenderer` in src/render/index.ts at it. Input, HUD and overlays
// stay untouched.

import type { ComponentType } from "react";
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
}

export interface BoardRenderer {
  name: string;
  Component: ComponentType<BoardRendererProps>;
  // Container-local screen point -> logical board point. Optional: defaults to
  // the orthographic inverse of `layout`. A perspective renderer should
  // override it (e.g. raycast onto the board plane).
  screenToBoard?: (layout: BoardLayout, x: number, y: number) => Vec2;
}
