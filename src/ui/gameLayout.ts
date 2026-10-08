// Screen layout for the full-bleed 3D scene: the board rect (renderer
// layout, container coords) plus where the HUD goes. Phone: HUD bar on top,
// board below with 8pt gutters. Desktop (>= 900pt): board ~92% of the
// window height (scale 0.9-1.6) with 240pt side panels 32pt away.

import { BoardMetrics } from "../game/types";
import { BoardLayout } from "../render/layout";

export const HUD_BAR_HEIGHT = 56;
const SLAB = 30; // ceiling slab + margin above the board (board units)
const SIDE = 12; // rails + glow beside the board (board units)
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
  const vw = m.width + SIDE * 2;
  const vh = m.height + SLAB;
  let scale: number;
  let areaTop: number;
  let areaH: number;
  if (desktop) {
    areaH = H * 0.92;
    areaTop = (H - areaH) / 2;
    const maxW = W - 2 * (PANEL_W + PANEL_GAP) - 32;
    // spec clamp 0.9-1.6, but never larger than the window allows
    scale = Math.min(Math.max(areaH / vh, 0.9), 1.6, maxW / vw, (H - 16) / vh);
  } else {
    areaTop = insets.top + 8 + HUD_BAR_HEIGHT + 8;
    areaH = Math.max(100, H - areaTop - insets.bottom - 8);
    const areaW = Math.max(100, W - insets.left - insets.right - 16);
    scale = Math.min(areaW / vw, areaH / vh);
  }
  const width = m.width * scale;
  const height = m.height * scale;
  const offsetX = (W - width) / 2;
  const offsetY = areaTop + (areaH - vh * scale) / 2 + SLAB * scale;
  const board: BoardLayout = { scale, offsetX, offsetY, width, height, containerWidth: W, containerHeight: H };
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
