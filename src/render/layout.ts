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

// Default container-local screen point -> logical board point (orthographic).
export const screenToBoardOrtho = (layout: BoardLayout, x: number, y: number): Vec2 => ({
  x: (x - layout.offsetX) / layout.scale,
  y: (y - layout.offsetY) / layout.scale,
});
