import { BoardRenderer } from "../BoardRenderer";
import { screenToBoardOrtho } from "../layout";
import AdaptiveBoard from "./AdaptiveBoard";

// 3D with an automatic 2D fallback (see render/status). Both renderers are
// orthographic on the board plane, so one screenToBoard serves both.
export const adaptiveRenderer: BoardRenderer = {
  name: "adaptive",
  Component: AdaptiveBoard,
  screenToBoard: screenToBoardOrtho,
};
