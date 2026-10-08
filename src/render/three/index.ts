import { BoardRenderer } from "../BoardRenderer";
import { screenToBoardOrtho } from "../layout";
import ThreeBoard from "./ThreeBoard";

// three.js renderer. The gameplay camera is a straight-on perspective camera
// whose z = 0 board plane is fitted exactly to `layout` (see GameWorld), so
// the orthographic inverse is the exact unprojection onto the board plane.
export const threeRenderer: BoardRenderer = {
  name: "three",
  Component: ThreeBoard,
  screenToBoard: screenToBoardOrtho,
};
