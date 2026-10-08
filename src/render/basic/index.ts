import { BoardRenderer } from "../BoardRenderer";
import BasicBoard from "./BasicBoard";

// Plain React Native Views; orthographic, so the default screenToBoard works.
export const basicRenderer: BoardRenderer = {
  name: "basic",
  Component: BasicBoard,
};
