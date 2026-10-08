// Fitting the logical board into the available screen area, and mapping
// screen points back to board units for input.

import { Vec2 } from "../game/types";

export interface BoardLayout {
  scale: number; // screen px per logical unit
  offsetX: number; // board's top-left inside the container (px)
  offsetY: number;
  width: number; // board size on screen (px)
  height: number;
  containerWidth: number;
  containerHeight: number;
}

// Largest uniform scale that fits the board, centred in the container.
export const fitBoard = (
  containerWidth: number,
  containerHeight: number,
  boardWidth: number,
  boardHeight: number,
  padding = 8
): BoardLayout => {
  const availW = Math.max(1, containerWidth - padding * 2);
  const availH = Math.max(1, containerHeight - padding * 2);
  const scale = Math.min(availW / boardWidth, availH / boardHeight);
  const width = boardWidth * scale;
  const height = boardHeight * scale;
  return {
    scale,
    offsetX: (containerWidth - width) / 2,
    offsetY: (containerHeight - height) / 2,
    width,
    height,
    containerWidth,
    containerHeight,
  };
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FitInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// Fit the board plus a decorative frame (insets, logical units) into `rect`
// of a larger container. The returned layout still describes the board rect
// itself; the frame lies around it. `maxScale` caps upscaling on big screens.
export const fitBoardInRect = (
  containerWidth: number,
  containerHeight: number,
  rect: Rect,
  boardWidth: number,
  boardHeight: number,
  insets: FitInsets = { top: 0, right: 0, bottom: 0, left: 0 },
  maxScale = Infinity
): BoardLayout => {
  const totalW = boardWidth + insets.left + insets.right;
  const totalH = boardHeight + insets.top + insets.bottom;
  const fit = Math.min(Math.max(1, rect.width) / totalW, Math.max(1, rect.height) / totalH);
  const scale = Math.max(0.05, Math.min(fit, maxScale));
  return {
    scale,
    offsetX: rect.x + (rect.width - totalW * scale) / 2 + insets.left * scale,
    offsetY: rect.y + (rect.height - totalH * scale) / 2 + insets.top * scale,
    width: boardWidth * scale,
    height: boardHeight * scale,
    containerWidth,
    containerHeight,
  };
};

// Default container-local screen point -> logical board point (orthographic).
export const screenToBoardOrtho = (layout: BoardLayout, x: number, y: number): Vec2 => ({
  x: (x - layout.offsetX) / layout.scale,
  y: (y - layout.offsetY) / layout.scale,
});
