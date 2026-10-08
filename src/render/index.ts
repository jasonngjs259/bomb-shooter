// Single switch point for the board renderer.
import { BoardRenderer } from "./BoardRenderer";
import { screenToBoardOrtho } from "./layout";
import { skiaRenderer } from "./skia";

// Swap to `basicRenderer` (./basic) for the plain RN-View fallback.
export const activeRenderer: BoardRenderer = skiaRenderer;

export const screenToBoard = activeRenderer.screenToBoard ?? screenToBoardOrtho;

export type { BoardRenderer, BoardRendererProps, FrameInsets } from "./BoardRenderer";
export type { BoardLayout } from "./layout";
