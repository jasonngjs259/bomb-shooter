// Single switch point for the board renderer.
import { BoardRenderer } from "./BoardRenderer";
import { basicRenderer } from "./basic";
import { screenToBoardOrtho } from "./layout";

export const activeRenderer: BoardRenderer = basicRenderer;

export const screenToBoard = activeRenderer.screenToBoard ?? screenToBoardOrtho;

export type { BoardRenderer, BoardRendererProps } from "./BoardRenderer";
export type { BoardLayout } from "./layout";
