// Screen layout for the full-bleed 3D scene: the board rect (renderer
// layout, container coords) plus where the HUD goes.
// Phone: HUD bar on top; the board is as wide as the screen allows (4pt
// gutters, slim rail margin) and sits low, over a short floor, so it is
// within thumb reach and the remaining height becomes one open sky above it
// (the 3D backdrop puts the sun there, see render/three/world/sky.ts).
// Desktop (>= 900pt): board ~92% of the window height (scale 0.9-1.6) with
// 240pt side panels 32pt away.
// Aiming stays exact: input maps through the same BoardLayout the renderer
// fits its camera to.

import { BoardMetrics } from "../game/types";
import { BoardLayout } from "../render/layout";

export const HUD_BAR_HEIGHT = 56;
const SLAB = 30; // ceiling slab + margin above the board (board units)
const SIDE = 12; // rails + glow beside the board (board units), desktop
const SIDE_PHONE = 8; // frame + rails; their outer glow may bleed off-screen
const GUTTER_PHONE = 4;
const FLOOR_MAX = 48; // floor shown under the board on tall phones (pt)
const PANEL_W = 240;
const PANEL_GAP = 32;

export interface Insets { top: number; bottom: number; left: number; right: number }

export interface GameLayout {
  board: BoardLayout;
  desktop: boolean;
  bar: { left: number; top: number; width: number };
  leftPanel: { left: number; top: number };
  rightPanel: { left: number; top: number };
}

export function computeGameLayout(W: number, H: number, insets: Insets, m: BoardMetrics): GameLayout {
  const desktop = W >= 900;
  const vh = m.height + SLAB;
  let scale: number;
  let blockTop: number; // top of the slab margin (board block = vh units tall)
  let skyTop: number;
  if (desktop) {
    const vw = m.width + SIDE * 2;
    const areaH = H * 0.92;
    const areaTop = (H - areaH) / 2;
    const maxW = W - 2 * (PANEL_W + PANEL_GAP) - 32;
    // spec clamp 0.9-1.6, but never larger than the window allows
    scale = Math.min(Math.max(areaH / vh, 0.9), 1.6, maxW / vw, (H - 16) / vh);
    blockTop = areaTop + (areaH - vh * scale) / 2;
    skyTop = 0;
  } else {
    const vw = m.width + SIDE_PHONE * 2;
    skyTop = insets.top + 8 + HUD_BAR_HEIGHT;
    const areaTop = skyTop + 8;
    const areaH = Math.max(100, H - areaTop - insets.bottom - 8);
    const areaW = Math.max(100, W - insets.left - insets.right - GUTTER_PHONE * 2);
    scale = Math.min(areaW / vw, areaH / vh);
    const free = Math.max(0, areaH - vh * scale);
    blockTop = areaTop + free - Math.min(FLOOR_MAX, free * 0.2);
  }
  const width = m.width * scale;
  const height = m.height * scale;
  const offsetX = (W - width) / 2;
  const offsetY = blockTop + SLAB * scale;
  const board: BoardLayout = { scale, offsetX, offsetY, width, height, containerWidth: W, containerHeight: H, skyTop };
  const barWidth = Math.min(W - 16 - insets.left - insets.right, 520);
  const panelTop = H / 2 - 170;
  return {
    board,
    desktop,
    bar: { left: (W - barWidth) / 2, top: insets.top + 8, width: barWidth },
    leftPanel: { left: offsetX - SIDE * scale - PANEL_GAP - PANEL_W, top: panelTop },
    rightPanel: { left: offsetX + width + SIDE * scale + PANEL_GAP, top: panelTop },
  };
}
