// Single switch point for the board renderer.
import { BoardRenderer } from "./BoardRenderer";
import { screenToBoardOrtho } from "./layout";
import { threeRenderer } from "./three";

export const activeRenderer: BoardRenderer = threeRenderer;

export const screenToBoard = activeRenderer.screenToBoard ?? screenToBoardOrtho;

export type { BoardRenderer, BoardRendererProps } from "./BoardRenderer";
export type { BoardLayout } from "./layout";
