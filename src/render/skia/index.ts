// 2.5D neon-arcade renderer on @shopify/react-native-skia. Orthographic, so
// the default screenToBoard works; it animates itself (no React frames) and
// draws its own full-screen synthwave background.

import { BoardRenderer } from "../BoardRenderer";
import { RAIL_X, SLAB_H } from "./boardFrame";
import SkiaBoard from "./SkiaBoard";

export const skiaRenderer: BoardRenderer = {
  name: "skia-neon",
  Component: SkiaBoard,
  selfAnimated: true,
  fullScreen: true,
  frameInsets: { top: SLAB_H + 6, right: RAIL_X + 10, bottom: 6, left: RAIL_X + 10 },
};
