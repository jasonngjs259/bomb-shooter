// Single switch point for the board renderer. The adaptive renderer runs the
// three.js board and falls back to the basic 2D board when WebGL is
// unavailable or keeps losing its context.
import { BoardRenderer } from "./BoardRenderer";
import { screenToBoardOrtho } from "./layout";
import { adaptiveRenderer } from "./adaptive";

export const activeRenderer: BoardRenderer = adaptiveRenderer;

export const screenToBoard = activeRenderer.screenToBoard ?? screenToBoardOrtho;

export type { BoardRenderer, BoardRendererProps } from "./BoardRenderer";
export type { BoardLayout } from "./layout";
export { rendererStatus, useRendererStatus } from "./status";
